import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { products } from "./products.js";
import { productVariants } from "./product-variants.js";

/**
 * Order line items.
 *
 * THE SNAPSHOT RULE
 * -----------------
 * Every field a customer or an invoice needs is copied here at order time:
 * name, SKU, variant label, unit price, image. The foreign keys to `products`
 * and `product_variants` exist for reporting and for stock adjustment — they
 * are NOT the source of display data.
 *
 * This is the single most important property of the table. Renaming a product,
 * repricing it, or archiving it must never change what a past order says it
 * was, or what the customer agreed to pay. Joining to `products` at read time
 * would silently rewrite history the first time someone ran a sale.
 *
 * Both FKs are ON DELETE SET NULL rather than CASCADE for the same reason:
 * permanently deleting a product must not delete the orders that contain it.
 */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    /* Nullable: the referenced catalogue row may be permanently deleted long
       after the order was fulfilled. The snapshot below still tells the whole
       story. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "set null",
    }),

    /* --- Snapshot -------------------------------------------------------- */
    productName: text("product_name").notNull(),
    productSlug: text("product_slug").notNull(),
    sku: text("sku").notNull(),
    /** e.g. "Titanium Gray · 256GB". Null for a product without variants. */
    variantLabel: text("variant_label"),
    /** Storage key of the image shown at order time. */
    imageKey: text("image_key"),

    /** Price per unit at the moment of ordering, in whole taka. */
    unitPrice: integer("unit_price").notNull(),

    /**
     * What the unit cost the SHOP at the moment of ordering.
     *
     * Snapshotted for the same reason as `unitPrice`: profit joined to the
     * product's current buying price would rewrite every past order the day a
     * supplier raises his rate. Null where the product had no cost recorded —
     * reported as unknown, never as free.
     */
    unitCost: integer("unit_cost"),

    quantity: integer("quantity").notNull(),
    /** Persisted rather than computed, so the row is self-contained. */
    lineTotal: integer("line_total").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("order_items_order_id_idx").on(table.orderId),
    /* Supports "how many units of this product have we sold", which is what
       best-selling reporting will ask. */
    index("order_items_product_id_idx").on(table.productId),
    index("order_items_variant_id_idx").on(table.variantId),

    check("order_items_quantity_positive", sql`${table.quantity} > 0`),
    check("order_items_price_non_negative", sql`${table.unitPrice} >= 0`),
    check(
      "order_items_unit_cost_non_negative",
      sql`${table.unitCost} is null or ${table.unitCost} >= 0`,
    ),
    check(
      "order_items_line_total_consistent",
      sql`${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`,
    ),
  ],
);

export type OrderItemRow = typeof orderItems.$inferSelect;
export type NewOrderItemRow = typeof orderItems.$inferInsert;
