import { eq, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { admins, type AdminRow, type NewAdminRow } from "../../db/schema/admins.js";
import { normalizeEmail } from "./admin.types.js";

/**
 * Admin data access.
 *
 * The only module permitted to reference the `admins` table. Services depend
 * on these functions, never on Drizzle directly, so the query surface stays
 * small enough to audit and swapping storage later touches one file.
 *
 * Every function takes an optional executor so it can participate in a caller's
 * transaction: `findById(id, tx)`.
 */

export async function findAdminById(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<AdminRow | undefined> {
  const rows = await executor.select().from(admins).where(eq(admins.id, id)).limit(1);
  return rows[0];
}

/**
 * Case-insensitive lookup.
 *
 * Matches the `lower(email)` unique index, so this uses the index rather than
 * degrading to a sequential scan.
 */
export async function findAdminByEmail(
  email: string,
  executor: DatabaseExecutor = getDb(),
): Promise<AdminRow | undefined> {
  const rows = await executor
    .select()
    .from(admins)
    .where(sql`lower(${admins.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return rows[0];
}

export async function createAdmin(
  input: Omit<NewAdminRow, "email"> & { email: string },
  executor: DatabaseExecutor = getDb(),
): Promise<AdminRow> {
  const rows = await executor
    .insert(admins)
    .values({ ...input, email: normalizeEmail(input.email) })
    .returning();

  const created = rows[0];
  if (!created) {
    throw new Error("Insert into admins returned no row");
  }
  return created;
}

export async function countAdmins(executor: DatabaseExecutor = getDb()): Promise<number> {
  const rows = await executor.select({ count: sql<number>`count(*)::int` }).from(admins);
  return rows[0]?.count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Login bookkeeping                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Records a failed login and locks the account once the threshold is crossed.
 *
 * The increment happens in SQL (`failed_login_attempts + 1`) rather than
 * read-modify-write in JavaScript, so concurrent attempts from a distributed
 * attacker cannot interleave and lose counts.
 */
export async function registerFailedLogin(
  id: string,
  options: { maxAttempts: number; lockoutSeconds: number },
  executor: DatabaseExecutor = getDb(),
): Promise<{ attempts: number; lockedUntil: Date | null }> {
  const rows = await executor
    .update(admins)
    .set({
      failedLoginAttempts: sql`${admins.failedLoginAttempts} + 1`,
      lockedUntil: sql`
        case
          when ${admins.failedLoginAttempts} + 1 >= ${options.maxAttempts}
          then now() + make_interval(secs => ${options.lockoutSeconds})
          else ${admins.lockedUntil}
        end
      `,
      updatedAt: sql`now()`,
    })
    .where(eq(admins.id, id))
    .returning({
      attempts: admins.failedLoginAttempts,
      lockedUntil: admins.lockedUntil,
    });

  const row = rows[0];
  return { attempts: row?.attempts ?? 0, lockedUntil: row?.lockedUntil ?? null };
}

/** Clears the lockout counters and stamps the successful login. */
export async function registerSuccessfulLogin(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor
    .update(admins)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(admins.id, id));
}

/**
 * Recovery path for an owner locked out of their own panel.
 *
 * Sets a new password AND clears everything else that keeps an account out: a
 * lockout from repeated failed logins, and a deactivated flag. Resetting only the
 * password would send them back to the shell a second time to discover the
 * account was also disabled.
 *
 * Reachable only from a shell on the server — there is no HTTP route for it, by
 * design.
 */
export async function resetAdminCredentials(
  id: string,
  passwordHash: string,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor
    .update(admins)
    .set({
      passwordHash,
      passwordChangedAt: sql`now()`,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: sql`now()`,
    })
    .where(eq(admins.id, id));
}

/** Used to transparently upgrade a digest hashed with weaker parameters. */
export async function updatePasswordHash(
  id: string,
  passwordHash: string,
  options: { markPasswordChanged: boolean } = { markPasswordChanged: false },
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor
    .update(admins)
    .set({
      passwordHash,
      ...(options.markPasswordChanged ? { passwordChangedAt: sql`now()` } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(admins.id, id));
}
