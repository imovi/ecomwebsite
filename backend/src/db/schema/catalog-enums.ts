import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Catalog enumerations.
 *
 * Postgres enums rather than free-text columns: an invalid value cannot be
 * written by any path, including a manual `psql` session. Widening one later
 * is an `ALTER TYPE ... ADD VALUE` migration.
 */

/**
 * Publication lifecycle.
 *
 *   draft    — being prepared; never visible publicly
 *   active   — publishable
 *   archived — withdrawn but retained, because orders will reference products
 *              and deleting the row would orphan order history
 */
export const productStatusEnum = pgEnum("product_status", ["draft", "active", "archived"]);
export type ProductStatus = (typeof productStatusEnum.enumValues)[number];

/**
 * Availability, kept separate from the lifecycle above.
 *
 * `in_stock` and `out_of_stock` are maintained automatically from quantity —
 * a store that has to remember to flip a flag will eventually oversell.
 * `pre_order` and `discontinued` are deliberate merchandising states that the
 * quantity sync leaves alone.
 */
export const stockStatusEnum = pgEnum("stock_status", [
  "in_stock",
  "out_of_stock",
  "pre_order",
  "discontinued",
]);
export type StockStatus = (typeof stockStatusEnum.enumValues)[number];

/** States whose stock status is operator-controlled, not derived from count. */
export const MANUAL_STOCK_STATUSES: readonly StockStatus[] = ["pre_order", "discontinued"];

/** Public sort modes. Anything not on this list is rejected by validation —
 *  interpolating a client-supplied column into `order by` is an injection. */
export const PRODUCT_SORT_OPTIONS = [
  "newest",
  "oldest",
  "price_asc",
  "price_desc",
  "name_asc",
  "name_desc",
  "discount",
  /* Both read `product_metrics`. `best_selling` is raw units; `trending`
     is the decayed popularity score. Neither is operator-controlled. */
  "best_selling",
  "trending",
] as const;

export type ProductSort = (typeof PRODUCT_SORT_OPTIONS)[number];
