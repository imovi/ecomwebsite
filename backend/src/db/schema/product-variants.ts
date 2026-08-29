import { sql } from "drizzle-orm";
import {
  boolean,
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
import { products } from "./products.js";
import { productImages } from "./product-images.js";

/**
 * Product variants — one purchasable combination of the parent's declared
 * option axes.
 *
 * `options` is jsonb (`{ "Color": "Black", "Storage": "256GB" }`) rather than
 * a normalised option/value/assignment triple. The axes differ per product
 * (Color+Storage for a phone, Size for a case, Model for a camera kit), the
 * values are only ever read as a set alongside their variant, and the service
 * validates every key against the parent's `variantOptions`. Three extra
 * tables and two joins would buy flexibility this catalogue does not use.
 *
 * SKU is globally unique, not per product: it is the physical identifier
 * warehouse staff and couriers read off a box, and a duplicate across two
 * products is a picking error waiting to happen.
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    sku: text("sku").notNull(),

    /** Axis → value, keyed by the parent's declared option names. */
    options: jsonb("options")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    price: integer("price").notNull(),
    oldPrice: integer("old_price"),

    /**
     * What this option costs the shop. Falls back to the product's cost when
     * null — 256 GB costs more to buy than 128 GB, exactly as it sells for
     * more, but most variants (colours) cost the same as their parent.
     */
    costPrice: integer("cost_price"),

    stockQuantity: integer("stock_quantity").notNull().default(0),

    /**
     * When the shop was last warned that this option is running down.
     *
     * Tracked per variant as well as per product because a product's stock is
     * the sum of its variants: a shirt with twenty in stock looks healthy while
     * size M is gone, and that is exactly the case that quietly wastes ad money
     * — the campaign keeps running, the customer who wanted M leaves, and the
     * total never dips far enough to warn anybody.
     */
    lowStockAlertedAt: timestamp("low_stock_alerted_at", { withTimezone: true }),

    /* SET NULL rather than CASCADE: deleting an image must not delete the
       variant that happened to display it. */
    imageId: uuid("image_id").references(() => productImages.id, { onDelete: "set null" }),

    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("product_variants_sku_unique_idx").on(sql`lower(${table.sku})`),
    index("product_variants_product_sort_idx").on(table.productId, table.sortOrder),
    /* Supports "cheapest in-stock variant", which drives the price shown on
       a listing card. */
    index("product_variants_product_price_idx").on(table.productId, table.price),

    check(
      "product_variants_cost_price_non_negative",
      sql`${table.costPrice} is null or ${table.costPrice} >= 0`,
    ),
  ],
);

export type ProductVariantRow = typeof productVariants.$inferSelect;
export type NewProductVariantRow = typeof productVariants.$inferInsert;
