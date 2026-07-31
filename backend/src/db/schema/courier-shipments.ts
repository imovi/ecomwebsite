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

/**
 * A parcel handed to a courier.
 *
 * One row per order, created when someone presses "Send to courier" and then
 * updated by the sync as the parcel moves. Two providers sit behind it —
 * Steadfast and Pathao — and nothing outside this module needs to know which
 * one carried a given parcel.
 */

export const COURIER_PROVIDERS = ["steadfast", "pathao"] as const;
export type CourierProvider = (typeof COURIER_PROVIDERS)[number];

/**
 * Our own vocabulary, and the only wording a customer ever sees.
 *
 * Couriers report things like `partial_delivered` and `return_pending`, change
 * the strings without notice, and mix English with Bangla. Mapping to a fixed
 * set means the storefront's tracking page reads the same whoever carried the
 * parcel, and an unrecognised courier status degrades to `unknown` rather than
 * leaking a raw code to a shopper.
 */
export const SHIPMENT_STATUSES = [
  "pending",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
  "unknown",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** States the courier will not move away from — the sync can stop polling. */
export const FINAL_SHIPMENT_STATUSES: ShipmentStatus[] = ["delivered", "returned", "cancelled"];

export const courierShipments = pgTable(
  "courier_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    provider: text("provider").$type<CourierProvider>().notNull(),

    /** What the courier's API takes back when asked for status. */
    consignmentId: text("consignment_id").notNull(),
    /** What a human types into the courier's own tracking page. */
    trackingCode: text("tracking_code").notNull().default(""),

    /** Verbatim, for support questions and for spotting a mapping gap. */
    courierStatus: text("courier_status").notNull().default(""),
    mappedStatus: text("mapped_status").$type<ShipmentStatus>().notNull().default("pending"),

    /**
     * What the courier believes it is collecting.
     *
     * Stored so it can be compared with the order total: a mismatch is money
     * that goes quietly missing, and it is invisible unless both numbers are
     * written down.
     */
    codAmount: integer("cod_amount").notNull().default(0),

    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Surfaced in the panel — a sync failing only in the logs is a sync
     *  nobody knows is broken. */
    lastError: text("last_error").notNull().default(""),

    createdBy: uuid("created_by").references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* Sending one parcel twice means two couriers at one customer's door and
       two delivery charges billed. The database refuses rather than trusting a
       disabled button. */
    uniqueIndex("courier_shipments_order_idx").on(table.orderId),

    index("courier_shipments_open_idx")
      .on(table.mappedStatus, table.lastSyncedAt)
      .where(sql`${table.mappedStatus} not in ('delivered', 'returned', 'cancelled')`),

    index("courier_shipments_consignment_idx").on(table.provider, table.consignmentId),

    check("courier_shipments_provider_known", sql`${table.provider} in ('steadfast', 'pathao')`),
    check(
      "courier_shipments_mapped_status_known",
      sql`${table.mappedStatus} in (
        'pending', 'picked_up', 'in_transit', 'out_for_delivery',
        'delivered', 'returned', 'cancelled', 'unknown'
      )`,
    ),
    check("courier_shipments_cod_non_negative", sql`${table.codAmount} >= 0`),
  ],
);

export type CourierShipmentRow = typeof courierShipments.$inferSelect;
export type NewCourierShipmentRow = typeof courierShipments.$inferInsert;
