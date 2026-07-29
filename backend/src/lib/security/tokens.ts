import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { config } from "../../config/index.js";
import { ErrorCode } from "../../core/http-status.js";
import { UnauthorizedError } from "../../core/errors.js";
import type { AdminRole } from "../../db/schema/enums.js";

/**
 * Token primitives.
 *
 * Two different kinds of token, deliberately:
 *
 *   Access token  — a signed JWT, 15 minutes, stateless. Carries identity and
 *                   role so authorisation needs no database round trip.
 *
 *   Refresh token — 32 bytes of CSPRNG output. NOT a JWT. It is a bearer
 *                   credential that must be revocable, and a stateless JWT
 *                   cannot be revoked before it expires. It is stored only as
 *                   a SHA-256 digest, so leaking the table leaks nothing
 *                   usable.
 *
 * Signing uses HS256 with a shared secret. That is the right choice while one
 * service both issues and verifies tokens; move to EdDSA/RS256 with a JWKS
 * endpoint if a second service ever needs to verify without holding the
 * signing key.
 */

const secretKey = new TextEncoder().encode(config.auth.accessSecret);

export interface AccessTokenClaims {
  /** Subject — the admin's id. */
  sub: string;
  email: string;
  role: AdminRole;
  /** JWT id. Logged at issue time so a token can be traced to a login. */
  jti: string;
}

export interface IssuedAccessToken {
  token: string;
  tokenId: string;
  expiresInSeconds: number;
  expiresAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Access tokens                                                              */
/* -------------------------------------------------------------------------- */

export async function signAccessToken(payload: {
  adminId: string;
  email: string;
  role: AdminRole;
}): Promise<IssuedAccessToken> {
  const tokenId = randomUUID();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAt + config.auth.accessTokenTtlSeconds;

  const token = await new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.adminId)
    .setJti(tokenId)
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .setIssuer(config.auth.issuer)
    .setAudience(config.auth.audience)
    .sign(secretKey);

  return {
    token,
    tokenId,
    expiresInSeconds: config.auth.accessTokenTtlSeconds,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

/**
 * Verifies an access token.
 *
 * Issuer and audience are checked, not just the signature — otherwise a token
 * minted by any other system sharing the secret would be accepted here.
 * Expiry and malformed tokens are distinguished so the client knows whether
 * refreshing is worth attempting.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      algorithms: ["HS256"],
      /* Tolerates minor clock drift between replicas without meaningfully
         extending a token's life. */
      clockTolerance: 5,
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.jti !== "string"
    ) {
      throw new UnauthorizedError("Malformed access token.", ErrorCode.TOKEN_INVALID);
    }

    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role as AdminRole,
      jti: payload.jti,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;

    if (error instanceof joseErrors.JWTExpired) {
      throw new UnauthorizedError("Access token has expired.", ErrorCode.TOKEN_EXPIRED);
    }

    throw new UnauthorizedError("Invalid access token.", ErrorCode.TOKEN_INVALID);
  }
}

/* -------------------------------------------------------------------------- */
/* Refresh tokens                                                             */
/* -------------------------------------------------------------------------- */

/** 256 bits of entropy — not guessable, and safe to hash with SHA-256. */
const REFRESH_TOKEN_BYTES = 32;

export interface GeneratedRefreshToken {
  /** Sent to the client. Never persisted. */
  token: string;
  /** Persisted. Never sent. */
  tokenHash: string;
  expiresAt: Date;
}

export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");

  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + config.auth.refreshTokenTtlSeconds * 1000),
  };
}

/**
 * SHA-256, hex.
 *
 * A fast hash is correct here and a slow one would be wrong: the input is
 * already 256 bits of uniform randomness, so there is no dictionary to defend
 * against, and refresh is a hot path that must not spend Argon2 time.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison, for any place a digest is compared in memory. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Extracts a bearer token from an Authorization header. */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value, ...rest] = header.trim().split(/\s+/);
  if (rest.length > 0) return undefined;
  if (!scheme || scheme.toLowerCase() !== "bearer") return undefined;
  return value && value.length > 0 ? value : undefined;
}
