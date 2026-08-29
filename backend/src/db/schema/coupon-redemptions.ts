import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { recoveryCoupons } from "./recovery-coupons.js";

/**
 * One use of one coupon.
 *
 * A counter on the coupon answers "how many times". The question an owner
 * actually asks is "which orders" — a code used five times is five orders whose
 * delivery the shop paid for, and they want to look at them. One column cannot
 * hold five order numbers.
 *
 * Written inside the order's own transaction, next to the conditional UPDATE
 * that claims the use. If the order rolls back so does this, and the count and
 * the rows can never disagree about how many times a code was spent.
 */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /* Cascade: this is the coupon's own history and means nothing without it. */
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => recoveryCoupons.id, { onDelete: "cascade" }),

    /**
     * The order it was spent on, and its number beside it.
     *
     * `set null` with a snapshotted number rather than cascade: an order purged
     * from the trash must not erase the fact that this coupon cost the shop a
     * delivery — and the number is what an owner recognises anyway.
     */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    orderNumber: text("order_number").notNull().default(""),

    /**
     * What this use cost, in taka. Frozen at the moment of the order.
     *
     * The delivery charge is a setting, and settings change. Pricing this from
     * today's rate would silently restate what last month's offers cost.
     */
    deliverySaved: integer("delivery_saved").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("coupon_redemptions_coupon_idx").on(table.couponId, table.createdAt),
    /* "Which orders used coupons". Partial: a redemption whose order was purged
       joins to nothing and does not belong in the index. */
    index("coupon_redemptions_order_idx")
      .on(table.orderId)
      .where(sql`${table.orderId} is not null`),
    check("coupon_redemptions_saved_non_negative", sql`${table.deliverySaved} >= 0`),
  ],
);

export type CouponRedemptionRow = typeof couponRedemptions.$inferSelect;
