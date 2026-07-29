import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Store settings — a single row.
 *
 * Delivery charges must be configurable rather than compiled in, and the
 * invoice needs the store's own details. Both live here.
 *
 * Modelled as one typed row rather than a key/value table: every consumer
 * wants the whole set at once, the columns are known and few, and a typed row
 * means a missing setting is a compile error instead of an `undefined` that
 * surfaces as a zero delivery charge in production. The `CHECK (id = 1)`
 * constraint makes "single row" a database guarantee, not a convention.
 *
 * Money is an integer number of taka, consistent with the rest of the system.
 */
export const storeSettings = pgTable(
  "store_settings",
  {
    id: smallint("id").primaryKey().default(1),

    /* --- Delivery pricing ------------------------------------------------ */
    deliveryChargeInsideDhaka: integer("delivery_charge_inside_dhaka").notNull().default(80),
    deliveryChargeOutsideDhaka: integer("delivery_charge_outside_dhaka").notNull().default(130),
    /** Order value at or above which delivery is free. 0 disables the rule. */
    freeDeliveryThreshold: integer("free_delivery_threshold").notNull().default(0),

    /* --- Ordering rules -------------------------------------------------- */
    /** Reject orders below this subtotal. 0 disables the rule. */
    minimumOrderValue: integer("minimum_order_value").notNull().default(0),
    /** Cap on units of any single line, to blunt joke orders on a COD store. */
    maxQuantityPerItem: integer("max_quantity_per_item").notNull().default(10),

    /* --- Store identity, used on invoices -------------------------------- */
    storeName: text("store_name").notNull().default("gng"),
    storePhone: text("store_phone").notNull().default(""),
    storeEmail: text("store_email").notNull().default(""),
    storeAddress: text("store_address").notNull().default(""),
    invoiceFooter: text("invoice_footer").notNull().default(""),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check("store_settings_single_row", sql`${table.id} = 1`),
    check(
      "store_settings_non_negative",
      sql`${table.deliveryChargeInsideDhaka} >= 0
          and ${table.deliveryChargeOutsideDhaka} >= 0
          and ${table.freeDeliveryThreshold} >= 0
          and ${table.minimumOrderValue} >= 0
          and ${table.maxQuantityPerItem} > 0`,
    ),
  ],
);

export type StoreSettingsRow = typeof storeSettings.$inferSelect;
export type NewStoreSettingsRow = typeof storeSettings.$inferInsert;
