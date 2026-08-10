import { randomInt, randomUUID } from "node:crypto";
import { config } from "../../config/index.js";
import { getDb } from "../../db/client.js";
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
import {
  consumeReset,
  findLatestLiveReset,
  findLatestReset,
  insertPasswordReset,
  invalidateResetsForAdmin,
  reserveResetAttempt,
} from "./password-reset.repository.js";
import { deliverResetCode } from "./reset-code.delivery.js";
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
/* Forgotten password                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How long a code lives. Long enough to find a message that went to spam,
 * short enough that a code left on a screen is not a standing key.
 */
const RESET_CODE_TTL_MINUTES = 15;

/**
 * Wrong guesses before the code dies.
 *
 * The real defence against guessing a six-digit number, because the rate
 * limiter keys on an address and an attacker with a botnet has many. Past this
 * the code is dead and a new one must be requested — which puts them back
 * through a channel only the owner can read.
 */
const RESET_MAX_ATTEMPTS = 5;

/**
 * Minimum gap between requests for one account.
 *
 * Without it, `/forgot-password` is a button anybody on the internet can use to
 * send the owner unlimited email and Telegram messages, using the shop's own
 * credentials to do it — which ends with the sending domain in a spam list.
 */
const RESET_RESEND_COOLDOWN_SECONDS = 60;

/** Six digits, from the CSPRNG. `Math.random` is predictable and this is a key. */
function generateResetCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export interface ResetRequestOutcome {
  /**
   * Whether a code was created and handed to the delivery layer.
   *
   * Deliberately NOT "was it delivered". Delivery is no longer awaited — see
   * the comment at the send site — so nothing here can honestly report it. The
   * caller must not turn this into a different HTTP answer either: whether a
   * given address has an account is exactly what this endpoint hides.
   */
  issued: boolean;
}

/**
 * Starts a password reset.
 *
 * ENUMERATION
 * -----------
 * The HTTP layer answers identically whether or not the address exists — see
 * the controller. This function still reports what really happened, because the
 * server's own logs should record the truth even when the response does not.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 * --------------------------------
 * A locked account. Being locked out by someone else's failed guesses is one of
 * the two reasons an owner ends up here, and refusing to help them because an
 * attacker has been hammering their account would hand that attacker a way to
 * deny recovery permanently. The reset itself clears the lock.
 *
 * A disabled account is different and IS refused: that is a decision somebody
 * made on purpose, and a password reset must not undo it.
 */
export async function requestPasswordReset(
  email: string,
  context: SessionContext,
): Promise<ResetRequestOutcome> {
  const nothing: ResetRequestOutcome = { issued: false };

  const admin = await findAdminByEmail(email);

  if (!admin) {
    log.warn({ email }, "Password reset requested for unknown account");
    return await sameCostAsIssuing(nothing);
  }

  if (!admin.isActive) {
    log.warn({ adminId: admin.id }, "Password reset requested for a disabled account");
    return await sameCostAsIssuing(nothing);
  }

  const previous = await findLatestReset(admin.id);
  if (previous) {
    const sinceSeconds = (Date.now() - previous.createdAt.getTime()) / 1000;
    if (sinceSeconds < RESET_RESEND_COOLDOWN_SECONDS) {
      /* Silent. Telling the caller to wait would confirm the account exists,
         and the owner who double-tapped Send already has a live code. */
      log.warn({ adminId: admin.id }, "Password reset rate limited by cooldown");
      return await sameCostAsIssuing(nothing);
    }
  }

  const code = generateResetCode();
  const codeHash = await hashPassword(code);

  try {
    /* One transaction, so "retire the old code, issue the new one" cannot be
       observed half-done. The partial unique index is the real guarantee — see
       the catch below — and this keeps the common case from ever reaching it. */
    await getDb().transaction(async (tx) => {
      await invalidateResetsForAdmin(admin.id, tx);
      await insertPasswordReset(
        {
          adminId: admin.id,
          codeHash,
          expiresAt: new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60_000),
          requestedIp: context.ipAddress ?? null,
        },
        tx,
      );
    });
  } catch (error) {
    /* `admin_password_resets_one_live_idx` refused a second live code, which
       means a concurrent request won the race and has already sent one. The
       caller wanted a code delivered to this account, and one was — answer as
       if this request had done it. Anything else would be a second code, which
       is the exact thing the index exists to prevent. */
    log.warn({ adminId: admin.id, err: error }, "Concurrent password reset request lost the race");
    return nothing;
  }

  /* NOT awaited, deliberately.
     ---------------------------------------------------------------------
     Delivery means an SMTP transaction and a Telegram HTTP call. Awaited, the
     response time would depend on them — and only the "this is a real, active
     account" path pays that cost, while every other path returns after one
     cheap SELECT. That is an account-enumeration oracle readable from a single
     request: fast means no such admin, slow means here is the address worth
     attacking. Handing back the answer first makes the reply the same shape
     whatever it is.
     It also means a stalling mail server can no longer hold the shopkeeper's
     browser past its own timeout and leave them reading "could not reach the
     server" about a code that has already arrived on Telegram. */
  void deliverResetCode({
    email: admin.email,
    name: admin.name,
    code,
    expiresInMinutes: RESET_CODE_TTL_MINUTES,
  })
    .then((delivery) => {
      log.info({ adminId: admin.id, ...delivery }, "Password reset code issued");
    })
    .catch((error: unknown) => {
      /* Nothing above can throw today. This is here so that if that ever
         changes, it is a logged failure rather than an unhandled rejection —
         which in current Node takes the whole API process down. */
      log.error({ adminId: admin.id, err: error }, "Password reset delivery threw");
    });

  return { issued: true };
}

/**
 * Burns roughly what issuing a code would have, before answering "no".
 *
 * The paths that decline — no such account, disabled, still inside the resend
 * cooldown — otherwise return after a single indexed SELECT, while the path
 * that proceeds spends an Argon2 hash. One request is enough to tell those
 * apart by the clock, which is the enumeration this endpoint is built to
 * prevent. The same defence `login` uses, for the same reason.
 *
 * The network side of the cost is handled differently — by not awaiting
 * delivery at all, so no path waits for it.
 */
async function sameCostAsIssuing(outcome: ResetRequestOutcome): Promise<ResetRequestOutcome> {
  await simulatePasswordVerification(generateResetCode());
  return outcome;
}

/**
 * Finishes a reset: verifies the code and sets the new password.
 *
 * One endpoint rather than "verify the code, then set a password with the token
 * that gives you". A verify-only step is a free oracle — an attacker could test
 * codes without ever committing to a password, and each test would be cheap.
 * Here every guess costs a full submission and burns one of five attempts.
 *
 * Every failure below returns the same message. The exception is an expired
 * code, which the owner needs to be told about because the fix is "ask for
 * another one" rather than "look at the number again".
 */
export async function resetPasswordWithCode(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  const genericFailure = new UnauthorizedError(
    "That code is not valid. Request a new one.",
    ErrorCode.INVALID_CREDENTIALS,
  );

  const admin = await findAdminByEmail(input.email);

  if (!admin || !admin.isActive) {
    /* Same dummy verification as login, for the same reason: without it, an
       unknown address answers noticeably faster than a real one. */
    await simulatePasswordVerification(input.code);
    throw genericFailure;
  }

  const reset = await findLatestLiveReset(admin.id);
  if (!reset) {
    await simulatePasswordVerification(input.code);
    throw genericFailure;
  }

  if (reset.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError(
      "That code has expired. Request a new one.",
      ErrorCode.TOKEN_EXPIRED,
    );
  }

  /* Charge the guess BEFORE checking it, in one statement that both increments
     and enforces the ceiling. Reading the count, comparing it here, and
     incrementing after the Argon2 verification left a hundred-millisecond gap
     in which every concurrent request saw the same stale number and every one
     of them got to guess — so the limit was not five, it was however many an
     attacker could run at once. Null means the budget is gone, and the code is
     dead without spending a hash on it. */
  const attempts = await reserveResetAttempt(reset.id, RESET_MAX_ATTEMPTS);

  if (attempts === null) {
    log.warn({ adminId: admin.id }, "Password reset code exhausted its attempts");
    throw genericFailure;
  }

  const matches = await verifyPassword(reset.codeHash, input.code);

  if (!matches) {
    log.warn({ adminId: admin.id, attempts }, "Wrong password reset code");
    throw genericFailure;
  }

  /* Claim it before changing anything. Conditional on `consumed_at is null`, so
     two requests carrying the same correct code cannot both reset the
     password — the loser is told the code is spent, which by then it is. */
  const claimed = await consumeReset(reset.id);
  if (!claimed) throw genericFailure;

  await updatePasswordHash(admin.id, await hashPassword(input.newPassword), {
    markPasswordChanged: true,
    /* The other reason an owner is on this page. Someone hammering the login
       leaves the account locked, and a reset that left the lock in place would
       hand back a working password that still cannot be used. */
    clearLockout: true,
  });

  /* Anything still signed in as this admin is now suspect — the reason for
     resetting may well be that somebody else got in. */
  await revokeAllForAdmin(admin.id, "password reset with a one-time code");

  /* Belt and braces: any code issued between the read above and here. */
  await invalidateResetsForAdmin(admin.id);

  log.info({ adminId: admin.id }, "Password reset completed with a one-time code");
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
