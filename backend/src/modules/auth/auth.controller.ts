import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { config } from "../../config/index.js";
import { sendSuccess } from "../../core/response.js";
import { UnauthorizedError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { validated } from "../../middleware/validate.js";
import * as authService from "./auth.service.js";
import type {
  ChangePasswordInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
} from "./auth.validation.js";

/**
 * Auth HTTP layer.
 *
 * Controllers do three things only: pull validated input, call the service,
 * shape the response. No policy, no database access — that keeps the security
 * logic in `auth.service.ts` unit-testable without an HTTP server.
 *
 * TOKEN PLACEMENT
 * ---------------
 * The access token is returned in the response body. The client holds it in
 * memory and sends `Authorization: Bearer`. It is deliberately not a cookie,
 * so no state-changing request is authenticated by ambient credentials — which
 * removes CSRF as a concern entirely.
 *
 * The refresh token is set as an httpOnly cookie, so XSS cannot read it, and
 * scoped to the auth path so it is not attached to every API call.
 */

function refreshCookieOptions(expiresAt?: Date): CookieOptions {
  return {
    httpOnly: config.auth.cookie.httpOnly,
    secure: config.auth.cookie.secure,
    sameSite: config.auth.cookie.sameSite,
    path: config.auth.cookie.path,
    domain: config.auth.cookie.domain,
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

function sessionContext(req: Request): authService.SessionContext {
  return {
    userAgent: req.get("user-agent")?.slice(0, 512),
    ipAddress: req.ip,
  };
}

/** Reads the refresh token from the cookie, falling back to the body. */
function readRefreshToken(req: Request, bodyToken?: string): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[config.auth.cookie.name] ?? bodyToken;
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(config.auth.cookie.name, token, refreshCookieOptions(expiresAt));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(config.auth.cookie.name, refreshCookieOptions());
}

/* -------------------------------------------------------------------------- */

/** POST /api/v1/auth/login */
export const login: RequestHandler = async (req, res) => {
  const { body } = validated<LoginInput>(req);

  const result = await authService.login(
    { email: body.email, password: body.password },
    sessionContext(req),
  );

  setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

  sendSuccess(res, {
    admin: result.admin,
    accessToken: result.accessToken,
    tokenType: "Bearer",
    expiresIn: result.expiresIn,
  });
};

/**
 * POST /api/v1/auth/refresh
 *
 * Public by design — the expired access token cannot authenticate the call
 * that would replace it. The refresh token itself is the credential.
 */
export const refresh: RequestHandler = async (req, res) => {
  const { body } = validated<RefreshInput>(req);
  const token = readRefreshToken(req, body.refreshToken);

  if (!token) {
    throw new UnauthorizedError(
      "No refresh token supplied.",
      ErrorCode.TOKEN_INVALID,
    );
  }

  try {
    const result = await authService.refresh(token, sessionContext(req));

    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

    sendSuccess(res, {
      admin: result.admin,
      accessToken: result.accessToken,
      tokenType: "Bearer",
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    /* Any refresh failure means this cookie is now worthless. Clearing it
       stops the client retrying in a loop with a dead token. */
    clearRefreshCookie(res);
    throw error;
  }
};

/**
 * POST /api/v1/auth/logout
 *
 * Requires a valid access token so `allDevices` cannot be triggered by an
 * unauthenticated caller holding only a stolen cookie.
 */
export const logout: RequestHandler = async (req, res) => {
  const { body } = validated<LogoutInput>(req);
  const token = readRefreshToken(req, body.refreshToken);

  if (body.allDevices && req.auth) {
    await authService.logoutAll(req.auth.adminId);
  } else {
    await authService.logout(token);
  }

  clearRefreshCookie(res);

  sendSuccess(res, { message: "Signed out successfully." });
};

/** GET /api/v1/auth/me */
export const me: RequestHandler = async (req, res) => {
  /* `authenticate` guarantees this, but asserting keeps the type honest. */
  if (!req.auth) throw new UnauthorizedError();

  const admin = await authService.getCurrentAdmin(req.auth.adminId);
  sendSuccess(res, { admin });
};

/**
 * POST /api/v1/auth/change-password
 *
 * Any authenticated role, not just an owner — this changes only the caller's
 * own credential. Revokes every session including this one, so the refresh
 * cookie is worthless from here on; the client signs in again with the new
 * password.
 */
export const changePassword: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const { body } = validated<ChangePasswordInput>(req);

  await authService.changePassword(req.auth.adminId, body);
  clearRefreshCookie(res);

  sendSuccess(res, { message: "Password changed. Please sign in again." });
};
