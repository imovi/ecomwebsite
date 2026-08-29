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

/**
 * Why a checkout was abandoned, as the desk heard it.
 *
 * A closed list rather than free text because the point is the tally: one
 * customer saying the delivery charge is too high is a conversation, forty
 * saying it is a pricing decision. The free-text `note` is still there for
 * everything a list cannot hold.
 *
 * Stored as the raw string and validated at the boundary rather than as a
 * database enum — adding a reason should be a one-line change here, not a
 * migration on a table the order desk is using.
 */
export const ABANDONED_REASONS = [
  "price_too_high",
  "delivery_charge",
  "product_question",
  "buying_later",
  "delivery_area",
  "checkout_problem",
  "no_response",
  "do_not_contact",
] as const;

export type AbandonedReason = (typeof ABANDONED_REASONS)[number];

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

    /**
     * When the Telegram alert for this lead went out. Null means "not yet".
     *
     * A column rather than firing on insert, for two reasons. The row is created
     * the moment a phone number is typed, so an immediate alert would announce
     * that someone left while they are still filling in their address. And the
     * row is rewritten on every keystroke batch, so anything derived from
     * `updated_at` would re-alert the same person repeatedly.
     */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),

    /**
     * When the desk confirmed it sent the recovery message.
     *
     * Set by a button the operator presses AFTER sending, not by opening the
     * WhatsApp link. The link only writes the message into the chat — the shop
     * still reads it, adjusts it, and may decide not to send at all. A flag set
     * on the click would mark half the list as messaged when it was not, and a
     * status nobody believes is a status nobody reads.
     */
    helpMessageSentAt: timestamp("help_message_sent_at", { withTimezone: true }),
    couponOfferSentAt: timestamp("coupon_offer_sent_at", { withTimezone: true }),

    /**
     * Why this one died, from a short list. Empty means nobody has said.
     *
     * Separate from `note`, which stays free text. The note is what the customer
     * said; this is the part the report can add up — and "delivery charge is too
     * high" appearing forty times is a pricing decision, not a call-list entry.
     */
    reason: text("reason").notNull().default(""),

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
    /* The recovery report groups leads by the day they were recorded. The
       status index above leads on status and cannot serve a plain date range. */
    index("abandoned_checkouts_created_at_idx").on(table.createdAt),

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
