import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  adminPasswordResets,
  type AdminPasswordResetRow,
} from "../../db/schema/admin-password-resets.js";

/** Data access for password-reset codes. No policy — that lives in the service. */

export async function insertPasswordReset(
  values: {
    adminId: string;
    codeHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  },
  executor: DatabaseExecutor = getDb(),
): Promise<AdminPasswordResetRow> {
  const [row] = await executor.insert(adminPasswordResets).values(values).returning();
  /* Matching `createAdmin` and `insertRefreshToken` rather than asserting with
     `!`. A single-row INSERT … RETURNING cannot come back empty today, but a
     named failure beats a TypeError if that ever stops being true. */
  if (!row) throw new Error("Failed to create password reset code.");
  return row;
}

/**
 * The newest code for an account that has not been spent.
 *
 * Newest rather than "the only one": a second request supersedes the first, and
 * an owner who taps Resend then types the code from the FIRST message should be
 * told the code is wrong — not silently let in on a code that a later request
 * was supposed to have replaced.
 *
 * Expiry is deliberately NOT filtered here. An expired code must produce
 * "that code has expired", which is a different message from "that code is
 * wrong", and the service can only tell them apart if it sees the row.
 */
export async function findLatestLiveReset(
  adminId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<AdminPasswordResetRow | null> {
  const [row] = await executor
    .select()
    .from(adminPasswordResets)
    .where(
      and(eq(adminPasswordResets.adminId, adminId), isNull(adminPasswordResets.consumedAt)),
    )
    /* `id` breaks the tie. `created_at` defaults to `now()`, which is
       transaction-start time and can genuinely collide — and without a
       tiebreaker Postgres is free to return either row, which would make
       "the newest code supersedes the older one" untrue exactly when two codes
       exist at once. */
    .orderBy(desc(adminPasswordResets.createdAt), desc(adminPasswordResets.id))
    .limit(1);

  return row ?? null;
}

/** The most recent request of any kind, for the resend cooldown. */
export async function findLatestReset(
  adminId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<AdminPasswordResetRow | null> {
  const [row] = await executor
    .select()
    .from(adminPasswordResets)
    .where(eq(adminPasswordResets.adminId, adminId))
    .orderBy(desc(adminPasswordResets.createdAt))
    .limit(1);

  return row ?? null;
}

/**
 * Claims one of the code's guesses, atomically. Null means there were none left.
 *
 * THE BUG THIS REPLACES
 * ---------------------
 * The ceiling used to be enforced by reading `attempts`, comparing it in
 * JavaScript, and only incrementing afterwards — with an Argon2 verification,
 * about a hundred milliseconds, sitting in the middle of that gap. Requests
 * fired together all read the same value, all passed the comparison, and all
 * went on to guess. The real limit was not five; it was however many an
 * attacker could run at once, and the slow hash made the window wide.
 *
 * Doing it in one statement makes the reservation and the check the same
 * operation, so the row itself is the only arbiter. Postgres serialises the
 * concurrent updates on the row lock, and the losers see `attempts` already at
 * the ceiling and match nothing.
 *
 * The guess is charged BEFORE it is checked rather than after a failure. That
 * spends one on a correct code too, which costs nothing — the code is consumed
 * moments later anyway — and it is the only ordering that cannot be raced.
 */
export async function reserveResetAttempt(
  id: string,
  maxAttempts: number,
  executor: DatabaseExecutor = getDb(),
): Promise<number | null> {
  const [row] = await executor
    .update(adminPasswordResets)
    .set({ attempts: sql`${adminPasswordResets.attempts} + 1` })
    .where(
      and(
        eq(adminPasswordResets.id, id),
        isNull(adminPasswordResets.consumedAt),
        lt(adminPasswordResets.attempts, maxAttempts),
      ),
    )
    .returning({ attempts: adminPasswordResets.attempts });

  return row?.attempts ?? null;
}

/**
 * Spends the code.
 *
 * Conditional on `consumed_at is null`, and reports whether it won. Two
 * requests arriving with the same correct code must not both reset the
 * password — the loser is told the code is spent, which it is.
 */
export async function consumeReset(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const rows = await executor
    .update(adminPasswordResets)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(adminPasswordResets.id, id), isNull(adminPasswordResets.consumedAt)))
    .returning({ id: adminPasswordResets.id });

  return rows.length > 0;
}

/**
 * Kills every unspent code for an account.
 *
 * Called when a new code is issued, and again after a successful reset. Without
 * it, a code from twenty minutes ago would still be live alongside the current
 * one, which quietly multiplies the number of guesses an attacker has in play.
 */
export async function invalidateResetsForAdmin(
  adminId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const rows = await executor
    .update(adminPasswordResets)
    .set({ consumedAt: sql`now()` })
    .where(
      and(eq(adminPasswordResets.adminId, adminId), isNull(adminPasswordResets.consumedAt)),
    )
    .returning({ id: adminPasswordResets.id });

  return rows.length;
}
