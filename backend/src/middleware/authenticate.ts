import type { RequestHandler } from "express";
import { ErrorCode } from "../core/http-status.js";
import { ForbiddenError, UnauthorizedError } from "../core/errors.js";
import { extractBearerToken, verifyAccessToken } from "../lib/security/tokens.js";
import { findAdminById } from "../modules/admins/admin.repository.js";
import { ROLE_RANK, type AdminRole } from "../db/schema/enums.js";

/**
 * Access token authentication.
 *
 * Verifies the signature, issuer and audience, then attaches `req.auth`.
 *
 * The token's claims alone are NOT treated as authorisation: `requireRole`
 * re-reads the admin's current role from the database. A 15-minute token
 * issued before a demotion would otherwise keep its old privileges until it
 * expired, which is exactly the window an attacker wants.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = extractBearerToken(req.get("authorization"));

  if (!token) {
    next(
      new UnauthorizedError(
        "Authentication required. Provide a bearer access token.",
        ErrorCode.UNAUTHORIZED,
      ),
    );
    return;
  }

  const claims = await verifyAccessToken(token);

  req.auth = {
    adminId: claims.sub,
    email: claims.email,
    role: claims.role,
    tokenId: claims.jti,
  };

  next();
};

/**
 * Optional authentication.
 *
 * Populates `req.auth` when a valid token is present and does nothing when it
 * is absent or invalid. For endpoints whose response varies by identity but
 * which do not require it.
 */
export const authenticateOptional: RequestHandler = async (req, _res, next) => {
  const token = extractBearerToken(req.get("authorization"));
  if (!token) {
    next();
    return;
  }

  try {
    const claims = await verifyAccessToken(token);
    req.auth = {
      adminId: claims.sub,
      email: claims.email,
      role: claims.role,
      tokenId: claims.jti,
    };
  } catch {
    // A bad token on an optional route is simply an anonymous request.
  }

  next();
};

/**
 * Role guard.
 *
 * Roles are hierarchical (`ROLE_RANK`), so `requireRole("admin")` admits
 * `super_admin` too. Anything needing non-hierarchical access should use
 * explicit permissions rather than being bolted onto this.
 *
 * Always mounted after `authenticate`.
 */
export function requireRole(...allowed: AdminRole[]): RequestHandler {
  if (allowed.length === 0) {
    throw new Error("requireRole() needs at least one role");
  }

  const minimumRank = Math.min(...allowed.map((role) => ROLE_RANK[role]));

  return async (req, _res, next) => {
    if (!req.auth) {
      next(
        new UnauthorizedError(
          "Authentication required.",
          ErrorCode.UNAUTHORIZED,
        ),
      );
      return;
    }

    /* Re-read the live account. This costs one indexed primary-key lookup and
       closes the window where a revoked or demoted admin still holds a valid
       access token. */
    const admin = await findAdminById(req.auth.adminId);

    if (!admin) {
      next(new UnauthorizedError("Account no longer exists.", ErrorCode.UNAUTHORIZED));
      return;
    }

    if (!admin.isActive) {
      next(
        new ForbiddenError(
          "This account has been disabled.",
          ErrorCode.ACCOUNT_DISABLED,
        ),
      );
      return;
    }

    if (ROLE_RANK[admin.role] < minimumRank) {
      req.log?.warn(
        { adminId: admin.id, role: admin.role, required: allowed },
        "Authorisation denied — insufficient role",
      );
      next(
        new ForbiddenError(
          "You do not have permission to perform this action.",
          ErrorCode.INSUFFICIENT_ROLE,
        ),
      );
      return;
    }

    /* Keep the request's view of the role in sync with the database. */
    req.auth.role = admin.role;
    next();
  };
}

/** Convenience guards for the two boundaries used most. */
export const requireAdmin = requireRole("admin");
export const requireSuperAdmin = requireRole("super_admin");
