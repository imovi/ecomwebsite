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
import { deliveryZoneEnum, orderStatusEnum, paymentMethodEnum } from "./order-enums.js";

/**
 * Orders.
 *
 * Guest checkout — there is no customer account and no foreign key to one.
 * The phone number is the identity, which is how every cash-on-delivery store
 * in Bangladesh actually operates.
 *
 * Money is an integer number of taka. `subtotal`, `delivery_charge` and
 * `grand_total` are all persisted rather than derived at read time: an invoice
 * printed today and the same invoice reprinted after a settings change must
 * show the same numbers.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Human-readable reference, e.g. `GNG-10042`.
     *
     * Generated from a Postgres sequence, which is concurrency-safe by
     * construction — a `max(order_number) + 1` read-then-write races the
     * moment two orders are placed in the same second, and on a store running
     * a Facebook campaign that happens constantly.
     */
    orderNumber: text("order_number").notNull(),

    /* --- Customer (denormalised on purpose: no accounts exist) ----------- */
    customerName: text("customer_name").notNull(),
    /** Normalised to `01XXXXXXXXX` before storage so search and dedupe work. */
    phone: text("phone").notNull(),
    /** House / road / block / landmark. */
    address: text("address").notNull(),
    /** Area, thana or district exactly as the customer typed it. */
    areaText: text("area_text").notNull(),
    /** The zone the charge was based on. Stored, never re-derived on read. */
    deliveryZone: deliveryZoneEnum("delivery_zone").notNull(),

    /* --- Money ----------------------------------------------------------- */
    subtotal: integer("subtotal").notNull(),
    deliveryCharge: integer("delivery_charge").notNull(),
    grandTotal: integer("grand_total").notNull(),

    /* Denormalised counters so the order list needs no join or aggregate. */
    itemCount: integer("item_count").notNull().default(0),
    totalQuantity: integer("total_quantity").notNull().default(0),

    paymentMethod: paymentMethodEnum("payment_method").notNull().default("cod"),
    status: orderStatusEnum("status").notNull().default("pending"),

    /** Staff-only. Never rendered on the invoice or exposed publicly. */
    internalNotes: text("internal_notes"),
    cancellationReason: text("cancellation_reason"),

    /**
     * Optimistic concurrency token, incremented on every mutation.
     *
     * Two staff members editing the same order during a confirmation call is
     * routine. Without this, the second save silently overwrites the first —
     * with it, the second save is rejected and the operator re-reads.
     */
    version: integer("version").notNull().default(1),

    /**
     * Client-supplied idempotency key.
     *
     * A flaky mobile connection retrying a checkout POST must not create two
     * orders. Unique where present; a replay returns the original order.
     */
    idempotencyKey: text("idempotency_key"),

    /* Captured for forensics on a store where refused COD parcels cost money. */
    customerIp: text("customer_ip"),
    userAgent: text("user_agent"),

    /* --- Lifecycle timestamps -------------------------------------------- */
    /* Individually stamped rather than derived from the timeline: reporting
       queries must not have to scan an event table to find when an order was
       delivered. `delivered_at` in particular is what future daily and
       monthly sales reporting will group by. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),

    /**
     * Moved to the trash. Null is a live order.
     *
     * A soft delete, because an order is the record of money owed or collected
     * and it carries an audit trail that exists so nobody can quietly rewrite
     * history. Removing the row outright would also silently restate every
     * profit figure that order ever appeared in.
     *
     * Every list, count and report filters on `deleted_at is null`. Thirty days
     * later a sweep purges it for real — long enough to notice a mistake, short
     * enough that the trash does not become a second database.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => admins.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("orders_order_number_unique_idx").on(sql`upper(${table.orderNumber})`),
    /* Partial: only rows that actually supplied a key participate. */
    uniqueIndex("orders_idempotency_key_unique_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),

    /* The admin list is `order by created_at desc` with an optional status
       filter, so this composite serves both the filtered and unfiltered case. */
    index("orders_status_created_idx").on(table.status, table.createdAt.desc()),
    index("orders_created_at_idx").on(table.createdAt.desc()),

    /* Search. Phone is exact or prefix; name is prefix — `text_pattern_ops`
       is what lets a btree serve `lower(name) like 'rah%'`. */
    index("orders_phone_idx").on(table.phone),
    index("orders_customer_name_idx").on(sql`lower(${table.customerName}) text_pattern_ops`),

    /* Filters. */
    index("orders_delivery_zone_idx").on(table.deliveryZone, table.createdAt.desc()),
    index("orders_payment_method_idx").on(table.paymentMethod),

    /* Reporting-ready: daily and monthly sales group delivered orders by
       `delivered_at`. Partial, because only delivered orders are revenue. */
    index("orders_delivered_at_idx")
      .on(table.deliveredAt.desc())
      .where(sql`${table.status} = 'delivered'`),

    /* The same access path for the other end of the lifecycle: a return is a
       cost, counted on the day the parcel came back. Rare, so partial. */
    index("orders_returned_at_idx")
      .on(table.returnedAt.desc())
      .where(sql`${table.status} = 'returned'`),

    /* Totals must add up. A CHECK is cheap and catches an arithmetic bug at
       the point of the write rather than in a month-end report. */
    check(
      "orders_totals_consistent",
      sql`${table.grandTotal} = ${table.subtotal} + ${table.deliveryCharge}`,
    ),
    check(
      "orders_amounts_non_negative",
      sql`${table.subtotal} >= 0 and ${table.deliveryCharge} >= 0 and ${table.grandTotal} >= 0`,
    ),
  ],
);

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
