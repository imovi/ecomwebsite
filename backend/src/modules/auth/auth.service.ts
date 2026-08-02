import { randomUUID } from "node:crypto";
import { config } from "../../config/index.js";
import { createLogger } from "../../core/logger.js";
import { ErrorCode } from "../../core/http-status.js";
import { ForbiddenError, UnauthorizedError } from "../../core/errors.js";
import {
  hashPassword,
  needsRehash,
  simulatePasswordVerification,
  verifyPassword,
} from "../../lib/security/password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "../../lib/security/tokens.js";
import {
  findAdminByEmail,
  findAdminById,
  registerFailedLogin,
  registerSuccessfulLogin,
  updatePasswordHash,
} from "../admins/admin.repository.js";
import { toAdminDto, type AdminDto } from "../admins/admin.types.js";
import {
  findRefreshTokenByHash,
  insertRefreshToken,
  markRefreshTokenUsed,
  revokeAllForAdmin,
  revokeRefreshToken,
  revokeTokenFamily,
} from "./refresh-token.repository.js";
import type { AdminRow } from "../../db/schema/admins.js";

/**
 * Authentication use cases.
 *
 * All auth policy lives here. Controllers only translate HTTP to and from
 * these functions, which keeps the security-critical logic in one testable
 * place with no Express types in sight.
 */

const log = createLogger("auth");

export interface SessionContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

export interface AuthResult {
  admin: AdminDto;
  accessToken: string;
  expiresIn: number;
  /** Plaintext refresh token — set as an httpOnly cookie, never in a body. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Authenticates an admin.
 *
 * Every failure path returns the same message and code. Distinguishing
 * "no such account" from "wrong password" hands an attacker a free account
 * enumeration oracle, so the only branch that reports something different is
 * an actual lockout — which the legitimate owner needs to be told about.
 *
 * The no-account branch still performs a dummy Argon2 verification so the two
 * paths take comparable time and cannot be told apart by latency either.
 */
export async function login(
  input: { email: string; password: string },
  context: SessionContext,
): Promise<AuthResult> {
  const genericFailure = new UnauthorizedError(
    "Incorrect email or password.",
    ErrorCode.INVALID_CREDENTIALS,
  );

  const admin = await findAdminByEmail(input.email);

  if (!admin) {
    await simulatePasswordVerification(input.password);
    log.warn({ email: input.email }, "Login attempt for unknown account");
    throw genericFailure;
  }

  if (isLocked(admin)) {
    const retryInSeconds = Math.max(
      1,
      Math.ceil((admin.lockedUntil!.getTime() - Date.now()) / 1000),
    );
    log.warn({ adminId: admin.id }, "Login attempt on a locked account");
    throw new ForbiddenError(
      `Account temporarily locked after too many failed attempts. Try again in ${Math.ceil(
        retryInSeconds / 60,
      )} minute(s).`,
      ErrorCode.ACCOUNT_LOCKED,
    );
  }

  if (!admin.isActive) {
    log.warn({ adminId: admin.id }, "Login attempt on a disabled account");
    throw new ForbiddenError(
      "This account has been disabled. Contact a super administrator.",
      ErrorCode.ACCOUNT_DISABLED,
    );
  }

  const passwordMatches = await verifyPassword(admin.passwordHash, input.password);

  if (!passwordMatches) {
    const { attempts, lockedUntil } = await registerFailedLogin(admin.id, {
      maxAttempts: config.auth.maxFailedLoginAttempts,
      lockoutSeconds: config.auth.lockoutSeconds,
    });
    log.warn({ adminId: admin.id, attempts, lockedUntil }, "Failed login");
    throw genericFailure;
  }

  /* Transparent upgrade: if this digest predates a parameter increase, rehash
     it now — this is the only moment the plaintext is available. */
  if (needsRehash(admin.passwordHash)) {
    await updatePasswordHash(admin.id, await hashPassword(input.password));
    log.info({ adminId: admin.id }, "Password hash upgraded to current parameters");
  }

  await registerSuccessfulLogin(admin.id);

  /* A fresh login starts a new token family, so revoking a compromised
     session later cannot sign the user out of their other devices. */
  const session = await issueSession(admin, randomUUID(), context);

  log.info({ adminId: admin.id, role: admin.role }, "Admin logged in");
  return session;
}

/* -------------------------------------------------------------------------- */
/* Refresh                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Exchanges a refresh token for a new pair.
 *
 * Reuse detection is the important behaviour. A token that has already been
 * exchanged must never work twice; seeing it again means it leaked, so the
 * whole family is revoked and the client is forced to log in again.
 */
export async function refresh(
  token: string,
  context: SessionContext,
): Promise<AuthResult> {
  const invalid = new UnauthorizedError(
    "Session expired. Please sign in again.",
    ErrorCode.TOKEN_INVALID,
  );

  const stored = await findRefreshTokenByHash(hashRefreshToken(token));
  if (!stored) throw invalid;

  if (stored.revokedAt) {
    log.warn(
      { adminId: stored.adminId, familyId: stored.familyId },
      "Refresh attempted with a revoked token",
    );
    throw invalid;
  }

  /* Already exchanged: the presented token is a copy. Kill the family. */
  if (stored.usedAt) {
    const revoked = await revokeTokenFamily(stored.familyId, "refresh_token_reuse_detected");
    log.error(
      { adminId: stored.adminId, familyId: stored.familyId, revoked },
      "Refresh token reuse detected — token family revoked",
    );
    throw new UnauthorizedError(
      "This session has been terminated for security reasons. Please sign in again.",
      ErrorCode.REFRESH_TOKEN_REUSED,
    );
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError(
      "Session expired. Please sign in again.",
      ErrorCode.TOKEN_EXPIRED,
    );
  }

  const admin = await findAdminById(stored.adminId);
  if (!admin || !admin.isActive) {
    await revokeTokenFamily(stored.familyId, "account_inactive");
    throw new ForbiddenError(
      "This account has been disabled.",
      ErrorCode.ACCOUNT_DISABLED,
    );
  }

  /* Issue the replacement first, then claim the old token. The claim is
     conditional on `used_at is null`, so if two requests race, only one wins
     and the loser's orphaned token simply expires. */
  const session = await issueSession(admin, stored.familyId, context);

  const claimed = await markRefreshTokenUsed(stored.id, session.refreshTokenId);
  if (!claimed) {
    await revokeTokenFamily(stored.familyId, "concurrent_refresh_detected");
    log.error(
      { adminId: admin.id, familyId: stored.familyId },
      "Concurrent refresh detected — token family revoked",
    );
    throw new UnauthorizedError(
      "This session has been terminated for security reasons. Please sign in again.",
      ErrorCode.REFRESH_TOKEN_REUSED,
    );
  }

  return session;
}

/* -------------------------------------------------------------------------- */
/* Logout                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ends a session.
 *
 * Intentionally forgiving: an unknown or already-revoked token still resolves
 * successfully. Logout must never fail in a way that leaves a user believing
 * they are still signed in, and it must not reveal whether a token was valid.
 */
export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;

  const stored = await findRefreshTokenByHash(hashRefreshToken(token));
  if (!stored) return;

  await revokeRefreshToken(stored.id, "logout");
  log.info({ adminId: stored.adminId }, "Admin logged out");
}

/** Signs the admin out of every device. */
export async function logoutAll(adminId: string): Promise<number> {
  const count = await revokeAllForAdmin(adminId, "logout_all");
  log.info({ adminId, revoked: count }, "All sessions revoked");
  return count;
}

/* -------------------------------------------------------------------------- */
/* Current admin                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Loads the admin behind a verified access token.
 *
 * Re-read from the database rather than trusted from token claims, so an
 * account disabled thirty seconds ago cannot keep acting on a token that is
 * still cryptographically valid.
 */
export async function getCurrentAdmin(adminId: string): Promise<AdminDto> {
  const admin = await findAdminById(adminId);

  if (!admin) {
    throw new UnauthorizedError("Account no longer exists.", ErrorCode.UNAUTHORIZED);
  }
  if (!admin.isActive) {
    throw new ForbiddenError("This account has been disabled.", ErrorCode.ACCOUNT_DISABLED);
  }

  return toAdminDto(admin);
}

/* -------------------------------------------------------------------------- */
/* Self-service password change                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lets any signed-in admin — any role, not just an owner — change their own
 * password.
 *
 * Requires the current password rather than trusting the access token alone:
 * a hijacked session should not be enough to lock the real owner out by
 * changing their credential out from under them. Every session is revoked
 * afterwards, including this one, the same way an administrator-driven reset
 * already works — the client re-authenticates with the new password.
 */
export async function changePassword(
  adminId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const admin = await findAdminById(adminId);
  if (!admin) {
    throw new UnauthorizedError("Account no longer exists.", ErrorCode.UNAUTHORIZED);
  }

  const matches = await verifyPassword(admin.passwordHash, input.currentPassword);
  if (!matches) {
    throw new UnauthorizedError("Current password is incorrect.", ErrorCode.INVALID_CREDENTIALS);
  }

  await updatePasswordHash(admin.id, await hashPassword(input.newPassword), {
    markPasswordChanged: true,
  });

  await revokeAllForAdmin(admin.id, "password changed by the account holder");

  log.info({ adminId: admin.id }, "Admin changed their own password");
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function isLocked(admin: AdminRow): boolean {
  return admin.lockedUntil !== null && admin.lockedUntil.getTime() > Date.now();
}

/** Mints an access/refresh pair and persists the refresh digest. */
async function issueSession(
  admin: AdminRow,
  familyId: string,
  context: SessionContext,
): Promise<AuthResult & { refreshTokenId: string }> {
  const access = await signAccessToken({
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
  });

  const refreshToken = generateRefreshToken();

  const stored = await insertRefreshToken({
    adminId: admin.id,
    tokenHash: refreshToken.tokenHash,
    familyId,
    expiresAt: refreshToken.expiresAt,
    userAgent: context.userAgent ?? null,
    ipAddress: context.ipAddress ?? null,
  });

  return {
    admin: toAdminDto(admin),
    accessToken: access.token,
    expiresIn: access.expiresInSeconds,
    refreshToken: refreshToken.token,
    refreshTokenExpiresAt: refreshToken.expiresAt,
    refreshTokenId: stored.id,
  };
}
