import { eq, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { productMetrics } from "../../db/schema/product-metrics.js";
import { products } from "../../db/schema/products.js";
import { createLogger } from "../../core/logger.js";

/**
 * Product popularity — the engine behind Trending and Best Selling.
 *
 * TRENDING IS NEVER OPERATOR-CONTROLLED. There is no "feature this product"
 * flag anywhere in this module by design. The score is a pure function of
 * measured demand and product age, so the homepage reflects what customers
 * actually do rather than what someone remembered to tick.
 *
 * The score is precomputed in bulk and read through an index, because Trending
 * sits on the homepage and must not run a decay calculation across the
 * catalogue on every request.
 */

const log = createLogger("product-metrics");

/**
 * Scoring weights.
 *
 *   sales    dominate — a purchase is the strongest possible demand signal
 *   views    are logarithmic, so a bot or a viral link cannot swamp the board
 *   freshness decays over ~3 weeks, giving new stock a chance to be seen at
 *            all before it has any sales history to rank on
 */
const WEIGHTS = {
  recentSale: 25,
  viewLog: 5,
  freshness: 40,
  freshnessHalfLifeDays: 21,
} as const;

/** Creates the metrics row that accompanies every product. */
export async function createMetricsRow(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor.insert(productMetrics).values({ productId }).onConflictDoNothing();
}

/**
 * Records a product-detail view.
 *
 * Deliberately fire-and-forget: a counter bump must never delay or fail the
 * page it is counting. Failures are logged at debug and swallowed.
 *
 * SCALING NOTE — this is one UPDATE per product view. At a few hundred views
 * per second per product it becomes a hot-row contention point; the fix then
 * is to buffer counts in Redis and flush periodically, which changes only this
 * function.
 */
export function recordView(productId: string): void {
  void getDb()
    .update(productMetrics)
    .set({ viewCount: sql`${productMetrics.viewCount} + 1`, updatedAt: sql`now()` })
    .where(eq(productMetrics.productId, productId))
    .catch((error: unknown) => {
      log.debug({ err: error, productId }, "View counter update failed");
    });
}

/**
 * Records a sale.
 *
 * THIS IS THE INTEGRATION POINT FOR THE FUTURE ORDERS MODULE. When an order
 * reaches a state that counts as a real sale — for a cash-on-delivery store
 * that is `delivered`, not `placed` — it calls this once per line item:
 *
 *     await recordProductSale({ productId, units: item.qty });
 *
 * Nothing else needs to change: `best_selling` sorting and the trending score
 * start reflecting real demand automatically, because both already read these
 * columns. Until then every product scores zero on sales and ranks on views
 * and freshness alone.
 */
export async function recordProductSale(
  input: { productId: string; units: number; occurredAt?: Date },
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  if (input.units <= 0) return;

  await executor
    .insert(productMetrics)
    .values({
      productId: input.productId,
      unitsSold: input.units,
      unitsSoldRecent: input.units,
      lastSoldAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoUpdate({
      target: productMetrics.productId,
      set: {
        unitsSold: sql`${productMetrics.unitsSold} + ${input.units}`,
        unitsSoldRecent: sql`${productMetrics.unitsSoldRecent} + ${input.units}`,
        lastSoldAt: input.occurredAt ?? sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Reverses a recorded sale — a returned or cancelled order.
 *
 * Clamped at zero so a double-reversal cannot drive a counter negative and
 * corrupt the ranking.
 */
export async function reverseProductSale(
  input: { productId: string; units: number },
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  if (input.units <= 0) return;

  await executor
    .update(productMetrics)
    .set({
      unitsSold: sql`greatest(0, ${productMetrics.unitsSold} - ${input.units})`,
      unitsSoldRecent: sql`greatest(0, ${productMetrics.unitsSoldRecent} - ${input.units})`,
      updatedAt: sql`now()`,
    })
    .where(eq(productMetrics.productId, input.productId));
}

/**
 * Recomputes every trending score in one statement.
 *
 * Run on a schedule — hourly is ample. One UPDATE ... FROM over the whole
 * catalogue is far cheaper than scoring per request, and it means the read
 * path is a plain indexed ORDER BY.
 *
 *     score = units_sold_recent × 25
 *           + ln(view_count + 1) × 5
 *           + 40 × exp(−age_in_days / 21)
 */
export async function recomputeTrendingScores(
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  // 1. Ensure all products have a row in product_metrics
  await executor.execute(sql`
    insert into ${productMetrics} (product_id)
    select id from ${products}
    on conflict (product_id) do nothing
  `);

  // 2. Sync units_sold and units_sold_recent from actual non-cancelled orders
  await executor.execute(sql`
    update ${productMetrics} m
    set units_sold = coalesce(s.total_units, 0),
        units_sold_recent = coalesce(s.total_units, 0),
        updated_at = now()
    from (
      select oi.product_id, sum(oi.quantity) as total_units
      from order_items oi
      join orders o on o.id = oi.order_id
      where o.status != 'cancelled'
      group by oi.product_id
    ) s
    where m.product_id = s.product_id
  `);

  const result = await executor.execute(sql`
    update ${productMetrics} m
    set trending_score =
          (m.units_sold_recent * ${WEIGHTS.recentSale}::double precision)
        + (ln(m.view_count + 1) * ${WEIGHTS.viewLog}::double precision)
        + (${WEIGHTS.freshness}::double precision * exp(
            -1.0 * (extract(epoch from (now() - coalesce(p.published_at, p.created_at)))
                    / 86400.0)
            / ${WEIGHTS.freshnessHalfLifeDays}::double precision
          )),
        score_updated_at = now(),
        updated_at = now()
    from ${products} p
    where p.id = m.product_id
  `);

  const updated = result.rowCount ?? 0;
  log.info({ updated }, "Trending scores recomputed");
  return updated;
}

/**
 * Drops the rolling sales window back to zero.
 *
 * Intended for a daily/weekly job once orders exist, so `units_sold_recent`
 * genuinely means "recent". Kept separate from the score recompute because the
 * two run on different cadences.
 */
export async function resetRecentSalesWindow(
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor.update(productMetrics).set({ unitsSoldRecent: 0, updatedAt: sql`now()` });
}
