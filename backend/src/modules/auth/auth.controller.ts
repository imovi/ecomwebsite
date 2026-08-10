import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { config } from "../../config/index.js";
import { sendSuccess } from "../../core/response.js";
import { UnauthorizedError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { validated } from "../../middleware/validate.js";
import * as authService from "./auth.service.js";
import { isDeliveryConfigured } from "./reset-code.delivery.js";
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
  ResetPasswordInput,
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

/**
 * POST /auth/forgot-password
 *
 * Answers the same way for every address: one that exists, one that never did,
 * one that was disabled last week. Anything else is an account-enumeration
 * oracle on an admin panel, which is a list of exactly whom to phish.
 *
 * That includes the timing of the answer: the service burns a dummy Argon2 hash
 * on the paths where there is nothing real to do, and delivery is not awaited
 * at all, so no branch is distinguishable by how long it takes.
 *
 * THE ONE THING THIS DOES REPORT
 * ------------------------------
 * Whether this SERVER can send anything at all. That is not an account fact —
 * the answer is identical for a real admin address, an invented one, and an
 * empty string, because it depends only on configuration — so saying it leaks
 * nothing, and it is checked BEFORE the account is even looked up so no timing
 * difference is introduced either.
 *
 * It has to be said, because the alternative is silence in the one case that
 * matters most: Telegram is configured from the panel the owner is locked out
 * of, so a shop with neither channel set up would otherwise answer "a code is
 * on its way" forever, about a code that cannot exist.
 *
 * The message says "if" on purpose, and names both channels, so the owner knows
 * to check Telegram when the email does not arrive.
 */
export const forgotPassword: RequestHandler = async (req, res) => {
  const { body } = validated<ForgotPasswordInput>(req);

  if (!(await isDeliveryConfigured())) {
    /* `canDeliver` is read by the client, which must NOT move on to the
       code-entry screen and ask for something that can never arrive. Safe to
       send: it describes the server, not the account, so it is identical for
       every address — including ones that do not exist. */
    sendSuccess(res, {
      canDeliver: false,
      message:
        "Password reset is not set up on this server — no email or Telegram delivery is configured. Ask whoever administers it to set one up.",
    });
    return;
  }

  await authService.requestPasswordReset(body.email, sessionContext(req));

  sendSuccess(res, {
    canDeliver: true,
    message:
      "If that email belongs to an admin account, a 6-digit code is on its way — check your inbox, your spam folder, and Telegram.",
  });
};

/**
 * POST /auth/reset-password
 *
 * Takes the code and the new password together. There is deliberately no
 * "check my code" endpoint: that would let an attacker test codes for free,
 * while here every guess costs a full submission and one of five attempts.
 */
export const resetPassword: RequestHandler = async (req, res) => {
  const { body } = validated<ResetPasswordInput>(req);

  await authService.resetPasswordWithCode(body);

  /* Every session for this account was just revoked, including — if the reset
     was done from a browser that still held one — this one. Clearing the cookie
     stops the client from presenting a token that is already dead. */
  clearRefreshCookie(res);

  sendSuccess(res, { message: "Password updated. You can sign in now." });
};
