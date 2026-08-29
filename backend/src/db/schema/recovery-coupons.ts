import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admins } from "./admins.js";
import { orders } from "./orders.js";
import { abandonedCheckouts } from "./abandoned-checkouts.js";

/**
 * A one-time free-delivery offer, handed to one abandoned checkout at a time.
 *
 * The desk rings a customer who left a full cart, and the customer says the
 * delivery charge is why. Until now there was nothing to answer that with:
 * `orders` refuses admin edits to the delivery charge on purpose, so a promise
 * made on the phone had nowhere to land. This is where it lands.
 *
 * WHY ANYONE HOLDING THE CODE CAN USE IT
 * Not tied to the phone it was sent to, by decision. The offer is one delivery
 * charge, once — the worst case if a customer forwards the code to a friend is
 * that the shop pays that charge for a sale it would not otherwise have made.
 * Binding it to a number would mean a customer ordering for their sister has to
 * be talked through why it does not work, which costs the desk more than the
 * courier does. The report still separates the two: an order that came in
 * through the lead's own resume link is credited to the lead, and one that did
 * not is counted as a coupon used without a recovery.
 */

export const RECOVERY_COUPON_STATUSES = ["active", "used", "cancelled", "expired"] as const;
export type RecoveryCouponStatus = (typeof RECOVERY_COUPON_STATUSES)[number];

/**
 * The alphabet codes are drawn from.
 *
 * No O/0, no I/1, no S/5. These codes are read down a phone line at least as
 * often as they are copied, and "was that an oh or a zero" is a failed
 * redemption that the customer blames the shop for.
 */
export const COUPON_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
export const COUPON_LENGTH = 6;

export const recoveryCoupons = pgTable(
  "recovery_coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Stored upper case, so `hn7k2p` and `HN7K2P` are one coupon. */
    code: text("code").notNull(),

    /**
     * The lead it was made for.
     *
     * `set null` rather than cascade: a deleted lead must not revoke a code the
     * customer is already holding. The coupon outlives the record of why it
     * was issued, which is the right way round — one of them is a promise made
     * to somebody outside the shop.
     */
    abandonedCheckoutId: uuid("abandoned_checkout_id").references(
      () => abandonedCheckouts.id,
      { onDelete: "set null" },
    ),

    /** The cart's worth at the moment of the offer, frozen for the report. */
    cartValue: integer("cart_value").notNull().default(0),

    /**
     * What the shop last recorded. `expiresAt` is what actually decides.
     *
     * Redemption tests the timestamp, never this word alone, so a sweep that
     * fails to run can leave a stale label but can never let an expired coupon
     * through. Anything else would put money behind a scheduled job, and this
     * shop has already lost a database to one of those failing quietly.
     */
    status: text("status").$type<RecoveryCouponStatus>().notNull().default("active"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    usedOrderId: uuid("used_order_id").references(() => orders.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("recovery_coupons_code_key").on(table.code),

    /* One live offer per lead, in the database rather than only in the service,
       so a double-tapped Generate cannot mint two. Partial, so a lead whose
       offer expired can be given a fresh one. */
    uniqueIndex("recovery_coupons_one_active_per_lead_idx")
      .on(table.abandonedCheckoutId)
      .where(sql`${table.status} = 'active' and ${table.abandonedCheckoutId} is not null`),

    index("recovery_coupons_status_created_idx").on(table.status, table.createdAt.desc()),

    check(
      "recovery_coupons_status_known",
      sql`${table.status} in ('active', 'used', 'cancelled', 'expired')`,
    ),
    check("recovery_coupons_cart_value_non_negative", sql`${table.cartValue} >= 0`),
  ],
);

export type RecoveryCouponRow = typeof recoveryCoupons.$inferSelect;
export type NewRecoveryCouponRow = typeof recoveryCoupons.$inferInsert;
