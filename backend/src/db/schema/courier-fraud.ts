import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Checking a customer's delivery record with the couriers.
 *
 * On cash on delivery the shop pays both ways for a parcel that comes back, so
 * the question worth asking before dispatch is whether this phone number takes
 * delivery of what it orders. The couriers know — each merchant panel exposes
 * the number's history — but only to a merchant who is logged in.
 *
 * WHY THIS IS A LOGIN AND NOT AN API KEY
 * -------------------------------------
 * None of these five couriers publishes a documented fraud-check API. What
 * exists is the endpoint their own merchant panel calls, reachable by signing
 * in as a merchant. So the shop's real courier login is what the check needs,
 * and that is a far more powerful credential than the shipment key already in
 * store settings: it can create parcels and see settlement. Consequences that
 * shape this schema:
 *
 *   - The credentials live in their own table, one row per courier, so a
 *     courier can be turned off without deleting what was typed, and so the
 *     API can return every field EXCEPT the secret.
 *   - `last_error` is stored, not just logged. These endpoints are
 *     undocumented and can change without notice; a check that quietly stops
 *     working would show as a customer with no history, which reads as a new
 *     customer rather than as a broken integration.
 */
export const courierFraudAccounts = pgTable("courier_fraud_accounts", {
  /** `steadfast`, `pathao`, `redx`, `paperfly`, `carrybee`. */
  provider: text("provider").primaryKey(),

  /** Email, username or phone — whichever that courier signs in with. */
  identifier: text("identifier").notNull().default(""),

  /**
   * The password. A SECRET: write-only through the API, never returned.
   *
   * Empty means "not configured", which is why the column is not null — a
   * three-state secret (unset / empty / present) has no use here.
   */
  secret: text("secret").notNull().default(""),

  enabled: boolean("enabled").notNull().default(false),

  /** When this courier last answered. Null means it never has. */
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  /** Empty when the last attempt succeeded. */
  lastError: text("last_error").notNull().default(""),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export type CourierFraudAccountRow = typeof courierFraudAccounts.$inferSelect;

/**
 * One customer's record, as last fetched.
 *
 * Keyed by phone rather than by order: the same number ordering twice is the
 * same person, and signing into five courier panels again to learn what was
 * learnt an hour ago is how a merchant account gets rate limited.
 *
 * The result is jsonb because its shape is "whatever couriers answered" — a
 * column per courier would need a migration every time one is added, and a
 * courier that failed is meaningfully absent rather than zero.
 */
export const courierFraudChecks = pgTable(
  "courier_fraud_checks",
  {
    /** Normalised to `01XXXXXXXXX`, the same form orders store. */
    phone: text("phone").primaryKey(),

    result: jsonb("result").notNull(),

    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* Sweeping stale rows, and answering "what did we check recently". */
    index("courier_fraud_checks_checked_at_idx").on(table.checkedAt.desc()),
  ],
);

export type CourierFraudCheckRow = typeof courierFraudChecks.$inferSelect;
