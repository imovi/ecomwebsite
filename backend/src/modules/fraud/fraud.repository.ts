import { eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  courierFraudAccounts,
  courierFraudChecks,
  type CourierFraudAccountRow,
  type CourierFraudCheckRow,
} from "../../db/schema/courier-fraud.js";
import type { ProviderKey } from "./providers/index.js";

/* -------------------------------------------------------------------------- */
/* Credentials                                                                */
/* -------------------------------------------------------------------------- */

export async function listAccounts(
  executor: DatabaseExecutor = getDb(),
): Promise<CourierFraudAccountRow[]> {
  return executor.select().from(courierFraudAccounts).orderBy(courierFraudAccounts.provider);
}

export async function findAccount(
  provider: ProviderKey,
  executor: DatabaseExecutor = getDb(),
): Promise<CourierFraudAccountRow | null> {
  const rows = await executor
    .select()
    .from(courierFraudAccounts)
    .where(eq(courierFraudAccounts.provider, provider))
    .limit(1);

  return rows[0] ?? null;
}

export interface SaveAccountInput {
  identifier: string;
  /** Undefined leaves the stored password alone — see the service. */
  secret?: string | undefined;
  enabled: boolean;
}

/**
 * Creates or updates one courier's credentials.
 *
 * An upsert rather than insert-or-update in two statements: two admins saving
 * the same courier at once would otherwise race, and one of them would get a
 * primary key violation instead of a saved row.
 */
export async function saveAccount(
  provider: ProviderKey,
  input: SaveAccountInput,
  executor: DatabaseExecutor = getDb(),
): Promise<CourierFraudAccountRow> {
  const rows = await executor
    .insert(courierFraudAccounts)
    .values({
      provider,
      identifier: input.identifier,
      secret: input.secret ?? "",
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: courierFraudAccounts.provider,
      set: {
        identifier: input.identifier,
        enabled: input.enabled,
        updatedAt: new Date(),
        /* Only overwrite the password when a new one was actually typed.
           Saving the form without retyping it must not wipe it. */
        ...(input.secret === undefined ? {} : { secret: input.secret }),
      },
    })
    .returning();

  const saved = rows[0];
  if (!saved) throw new Error("Upsert into courier_fraud_accounts returned no row");
  return saved;
}

/** Records how the last attempt went, for the Settings screen to show. */
export async function recordAttempt(
  provider: ProviderKey,
  outcome: { ok: boolean; error?: string },
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor
    .update(courierFraudAccounts)
    .set(
      outcome.ok
        ? { lastOkAt: new Date(), lastError: "" }
        : { lastError: (outcome.error ?? "Failed.").slice(0, 500) },
    )
    .where(eq(courierFraudAccounts.provider, provider));
}

/* -------------------------------------------------------------------------- */
/* Cached results                                                             */
/* -------------------------------------------------------------------------- */

export async function findCheck(
  phone: string,
  executor: DatabaseExecutor = getDb(),
): Promise<CourierFraudCheckRow | null> {
  const rows = await executor
    .select()
    .from(courierFraudChecks)
    .where(eq(courierFraudChecks.phone, phone))
    .limit(1);

  return rows[0] ?? null;
}

/** Every stored result for a set of numbers, in one query. */
export async function findChecks(
  phones: string[],
  executor: DatabaseExecutor = getDb(),
): Promise<CourierFraudCheckRow[]> {
  if (phones.length === 0) return [];

  return executor
    .select()
    .from(courierFraudChecks)
    .where(inArray(courierFraudChecks.phone, phones));
}

export async function saveCheck(
  phone: string,
  result: unknown,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor
    .insert(courierFraudChecks)
    .values({ phone, result, checkedAt: new Date() })
    .onConflictDoUpdate({
      target: courierFraudChecks.phone,
      set: { result, checkedAt: new Date() },
    });
}

/**
 * Drops results older than the cutoff.
 *
 * A delivery record is a fact about a person that this shop has no reason to
 * keep once it has stopped being current. Nothing calls this on a timer yet;
 * it exists so that when something does, the query is here rather than
 * invented at the call site.
 */
export async function forgetChecksBefore(
  cutoff: Date,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const result = await executor
    .delete(courierFraudChecks)
    .where(lt(courierFraudChecks.checkedAt, cutoff))
    .returning({ phone: courierFraudChecks.phone });

  return result.length;
}

/** How many numbers we hold a record for. */
export async function countChecks(executor: DatabaseExecutor = getDb()): Promise<number> {
  const rows = await executor.execute(
    sql`select count(*)::int as total from ${courierFraudChecks}`,
  );
  const value = rows.rows[0]?.total;
  return typeof value === "number" ? value : Number(value ?? 0);
}
