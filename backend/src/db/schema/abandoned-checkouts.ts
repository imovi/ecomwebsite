import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admins } from "./admins.js";
import { orders } from "./orders.js";
import { deliveryZoneEnum } from "./order-enums.js";

/**
 * Checkouts that were started and never finished.
 *
 * The cheapest sales a cash-on-delivery shop has: the customer already picked a
 * product and typed their number, then lost the thread. A phone call recovers a
 * good share of them — but only if the shop knows the attempt happened at all,
 * and today that vanishes when the tab closes.
 */

/** What the customer had in the cart when they stopped. */
export interface AbandonedLine {
  productId: string;
  variantId: string | null;
  /** Snapshotted, so the caller sees what the customer saw. */
  name: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
}

export const ABANDONED_STATUSES = ["open", "contacted", "dismissed"] as const;
export type AbandonedStatus = (typeof ABANDONED_STATUSES)[number];

export const abandonedCheckouts = pgTable(
  "abandoned_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The only required field, and the reason a row exists at all.
     *
     * Normalised to digits before storing, so `01712-345678` and `01712345678`
     * are one person rather than two entries in the call list.
     */
    phone: text("phone").notNull(),

    /* Whatever else had been typed at the moment they stopped. */
    customerName: text("customer_name"),
    address: text("address"),
    areaText: text("area_text"),
    deliveryZone: deliveryZoneEnum("delivery_zone"),

    contents: jsonb("contents")
      .$type<AbandonedLine[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    itemCount: integer("item_count").notNull().default(0),
    /** Goods only — no zone is chosen yet, so delivery is not settled. */
    estimatedValue: integer("estimated_value").notNull().default(0),

    status: text("status").$type<AbandonedStatus>().notNull().default("open"),
    note: text("note").notNull().default(""),

    contactedBy: uuid("contacted_by").references(() => admins.id, { onDelete: "set null" }),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),

    /**
     * Set when an order later arrives from this number.
     *
     * Also what removes the row from the call list — without it the shop ends up
     * ringing customers who already bought, and switches the feature off.
     */
    recoveredOrderId: uuid("recovered_order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),

    /** The warmest lead is the one who just closed the tab. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(sql`now()`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* One live record per number. Partial, so a customer who abandons again on
       a later visit is recorded again rather than blocked by their own
       recovered row. */
    uniqueIndex("abandoned_checkouts_open_phone_idx")
      .on(table.phone)
      .where(sql`${table.recoveredOrderId} is null`),

    index("abandoned_checkouts_status_seen_idx").on(table.status, table.lastSeenAt.desc()),
    index("abandoned_checkouts_phone_idx").on(table.phone),

    check(
      "abandoned_checkouts_status_known",
      sql`${table.status} in ('open', 'contacted', 'dismissed')`,
    ),
    check(
      "abandoned_checkouts_value_non_negative",
      sql`${table.estimatedValue} >= 0 and ${table.itemCount} >= 0`,
    ),
  ],
);

export type AbandonedCheckoutRow = typeof abandonedCheckouts.$inferSelect;
export type NewAbandonedCheckoutRow = typeof abandonedCheckouts.$inferInsert;
