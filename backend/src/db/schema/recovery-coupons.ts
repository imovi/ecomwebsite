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
     * The lead it was made for, or null.
     *
     * `set null` rather than cascade: a deleted lead must not revoke a code the
     * customer is already holding. The coupon outlives the record of why it
     * was issued, which is the right way round — one of them is a promise made
     * to somebody outside the shop.
     *
     * Null is also the normal state for a coupon minted from the Coupons page,
     * which is why the one-active-per-lead index below is partial on `is not
     * null`: any number of standalone coupons may be live at once.
     */
    abandonedCheckoutId: uuid("abandoned_checkout_id").references(
      () => abandonedCheckouts.id,
      { onDelete: "set null" },
    ),

    /** The cart's worth at the moment of the offer, frozen for the report. */
    cartValue: integer("cart_value").notNull().default(0),

    /**
     * Who it was made for, when it was not made for a lead.
     *
     * A coupon minted from the Coupons page has no abandoned checkout behind it
     * — the desk is on the phone to somebody who was never in the call list —
     * so the name and number a lead would have supplied are absent. Without
     * this the standalone list is a column of anonymous codes.
     *
     * Empty for every coupon issued from a lead: those already know whose they
     * are.
     */
    note: text("note").notNull().default(""),

    /**
     * How many times it may be spent. Null means no limit.
     *
     * Nullable rather than a magic 0, because "unlimited" and "zero uses
     * allowed" are different things and a shop that typed 0 by accident should
     * not get an unlimited coupon out of it. 1 is the default and is what every
     * lead offer still is.
     */
    maxUses: integer("max_uses").default(1),

    /** How many times it has been spent. Bumped by the claim, never read for it. */
    usedCount: integer("used_count").notNull().default(0),

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

    /**
     * The FIRST order it was spent on, and when.
     *
     * Kept as they were. For a single-use coupon — still the default, still
     * every lead offer — the first use is the only use, so nothing about the
     * existing behaviour moved. Every use, including this one, is also a row in
     * `coupon_redemptions`, which is what the panel lists.
     */
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
    /* A date range across every status; the composite above leads on status. */
    index("recovery_coupons_created_at_idx").on(table.createdAt),
    /* Redemption looks a code up and tests whether it is live. Partial, so it
       covers only the rows a checkout can claim — that set stays small however
       many spent coupons pile up behind it. */
    index("recovery_coupons_claimable_idx")
      .on(table.code)
      .where(sql`${table.status} = 'active'`),

    check(
      "recovery_coupons_status_known",
      sql`${table.status} in ('active', 'used', 'cancelled', 'expired')`,
    ),
    check("recovery_coupons_cart_value_non_negative", sql`${table.cartValue} >= 0`),
    check(
      "recovery_coupons_uses_sane",
      sql`${table.usedCount} >= 0 and (${table.maxUses} is null or ${table.maxUses} >= 1)`,
    ),
  ],
);

export type RecoveryCouponRow = typeof recoveryCoupons.$inferSelect;
export type NewRecoveryCouponRow = typeof recoveryCoupons.$inferInsert;
