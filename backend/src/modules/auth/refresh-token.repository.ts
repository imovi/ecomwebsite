import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  refreshTokens,
  type NewRefreshTokenRow,
  type RefreshTokenRow,
} from "../../db/schema/refresh-tokens.js";

/**
 * Refresh token persistence.
 *
 * Every lookup is by `tokenHash` — the plaintext token exists only in transit
 * and in the client's cookie, never in this database.
 */

export async function insertRefreshToken(
  input: NewRefreshTokenRow,
  executor: DatabaseExecutor = getDb(),
): Promise<RefreshTokenRow> {
  const rows = await executor.insert(refreshTokens).values(input).returning();
  const created = rows[0];
  if (!created) throw new Error("Insert into refresh_tokens returned no row");
  return created;
}

export async function findRefreshTokenByHash(
  tokenHash: string,
  executor: DatabaseExecutor = getDb(),
): Promise<RefreshTokenRow | undefined> {
  const rows = await executor
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

/**
 * Atomically marks a token as used and records its replacement.
 *
 * The `used_at is null` predicate is the concurrency control: two simultaneous
 * refreshes with the same token both attempt this update, and exactly one
 * matches a row. The loser gets zero rows back and is treated as a reuse. Doing
 * this as a read-then-write in application code would let both succeed and
 * silently fork the session.
 */
export async function markRefreshTokenUsed(
  id: string,
  replacedByTokenId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const rows = await executor
    .update(refreshTokens)
    .set({ usedAt: sql`now()`, replacedByTokenId })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.usedAt)))
    .returning({ id: refreshTokens.id });

  return rows.length === 1;
}

/** Revokes a single token — used on logout. */
export async function revokeRefreshToken(
  id: string,
  reason: string,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor
    .update(refreshTokens)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));
}

/**
 * Revokes an entire token family.
 *
 * Called on reuse detection. Every token descended from the compromised login
 * dies at once, which is what turns a stolen refresh token from permanent
 * access into a single-use nuisance that also alerts us.
 */
export async function revokeTokenFamily(
  familyId: string,
  reason: string,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const rows = await executor
    .update(refreshTokens)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });

  return rows.length;
}

/** Revokes every live session for an admin — "sign out everywhere". */
export async function revokeAllForAdmin(
  adminId: string,
  reason: string,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const rows = await executor
    .update(refreshTokens)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(refreshTokens.adminId, adminId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });

  return rows.length;
}

/**
 * Deletes expired rows.
 *
 * Refresh tokens are the fastest-growing table in an auth system. Run on a
 * schedule (cron/worker) — deliberately not on the request path, where a
 * cleanup pause would show up as user-visible latency.
 */
export async function deleteExpiredRefreshTokens(
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const rows = await executor
    .delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, sql`now()`))
    .returning({ id: refreshTokens.id });

  return rows.length;
}
