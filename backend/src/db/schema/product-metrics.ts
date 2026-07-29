import { sql } from "drizzle-orm";
import {
  bigint,
  doublePrecision,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./products.js";

/**
 * Per-product popularity signals — the data behind Trending.
 *
 * WHY A SEPARATE TABLE
 * --------------------
 * These columns are written on a read path (a view bumps a counter) and by
 * the future orders module. Keeping them off `products` means a view does not
 * churn product rows, does not invalidate their cache, and does not compete
 * with catalogue writes for row locks. One row per product, created with the
 * product.
 *
 * WHY A PRECOMPUTED SCORE
 * -----------------------
 * `trending_score` is recomputed in bulk by a single UPDATE and read through
 * an index. Trending is on the homepage — the highest-traffic query in the
 * system — and it must not compute an exponential decay across the catalogue
 * on every request.
 *
 * Trending is never operator-controlled. There is no "make this trend" flag by
 * design: the score is derived only from measured demand and product age.
 */
export const productMetrics = pgTable(
  "product_metrics",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),

    /** All-time detail-page views. bigint: a popular SKU outlives int4. */
    viewCount: bigint("view_count", { mode: "number" }).notNull().default(0),

    /**
     * All-time units sold. Drives the `best_selling` sort.
     *
     * Zero for every product until the orders module lands and starts calling
     * `recordProductSale()`. The sort therefore works today and becomes
     * meaningful automatically — no schema change, no code change.
     */
    unitsSold: integer("units_sold").notNull().default(0),

    /** Units sold in the trailing window. The dominant term in the score. */
    unitsSoldRecent: integer("units_sold_recent").notNull().default(0),

    lastSoldAt: timestamp("last_sold_at", { withTimezone: true }),

    /** Denormalised popularity ranking. Recomputed, never written by hand. */
    trendingScore: doublePrecision("trending_score").notNull().default(0),
    scoreUpdatedAt: timestamp("score_updated_at", { withTimezone: true }),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* The homepage Trending rail is a single index scan on this. */
    index("product_metrics_trending_idx").on(table.trendingScore.desc()),
    index("product_metrics_units_sold_idx").on(table.unitsSold.desc()),
  ],
);

export type ProductMetricsRow = typeof productMetrics.$inferSelect;
export type NewProductMetricsRow = typeof productMetrics.$inferInsert;
