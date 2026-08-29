import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { admins } from "./admins.js";
import { abandonedCheckouts } from "./abandoned-checkouts.js";

/**
 * What has been done about one incomplete checkout.
 *
 * The same shape as `order_events`, and there for the same reason. Once a
 * second person is working the call list, "has anyone messaged this customer,
 * and what did we offer them?" stops being answerable from memory — and the
 * first time two people offer the same customer two different things, the shop
 * stops trusting the page.
 *
 * The report is the other half of it. Counting help messages, coupons handed
 * out and offers actually sent needs somewhere those were written down; a
 * boolean on the lead would say that something happened once and lose
 * everything about when, how often, and by whom.
 */

export const ABANDONED_EVENT_TYPES = [
  "help_message_sent",
  "coupon_generated",
  "coupon_offer_sent",
  "coupon_used",
  "coupon_cancelled",
  "called",
  "note_added",
  "dismissed",
  "recovered",
] as const;

export type AbandonedEventType = (typeof ABANDONED_EVENT_TYPES)[number];

export const abandonedCheckoutEvents = pgTable(
  "abandoned_checkout_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /* Cascade, unlike the coupon's link to the same table: this history is
       about the lead and means nothing without it, whereas a coupon is a
       promise already made to somebody outside the shop. */
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => abandonedCheckouts.id, { onDelete: "cascade" }),

    type: text("type").$type<AbandonedEventType>().notNull(),

    /** Whatever the entry needs to be readable later — a code, an order number. */
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),

    actorAdminId: uuid("actor_admin_id").references(() => admins.id, { onDelete: "set null" }),
    /* Kept alongside the id so the line still names somebody after that account
       is deleted — which is precisely when anyone goes looking. */
    actorName: text("actor_name").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("abandoned_checkout_events_checkout_idx").on(table.checkoutId, table.createdAt),
    /* "Who worked the list" counts events per staff member over a date range. */
    index("abandoned_checkout_events_created_at_idx").on(table.createdAt),
  ],
);

export type AbandonedCheckoutEventRow = typeof abandonedCheckoutEvents.$inferSelect;
