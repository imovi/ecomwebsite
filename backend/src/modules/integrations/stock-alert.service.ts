import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { products } from "../../db/schema/products.js";
import { productVariants } from "../../db/schema/product-variants.js";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import * as telegram from "./telegram.service.js";

/**
 * Telling the shop it is about to run out, before it does.
 *
 * The Telegram bot can already ANSWER a stock question. Nobody asks it at two
 * in the morning. Meanwhile the ad account keeps spending on a product that
 * cannot be delivered, and the first anybody knows is a customer complaining or
 * a refund — by which point the money is gone either way.
 *
 * WHY VARIANTS ARE CHECKED SEPARATELY
 * A product's stock is the sum of its variants. A shirt with twenty in stock
 * reads healthy while size M is gone, and the total never dips far enough to
 * warn anyone — so the case that most reliably wastes ad money is exactly the
 * one a product-level check cannot see.
 *
 * SENT ONCE PER DIP, NOT ONCE PER CHECK
 * The scheduler wakes every five minutes. Somewhere to record "already
 * mentioned" is the whole difference between a useful warning and twelve an
 * hour — and twelve an hour is how an alert gets muted before the night it
 * matters. The stamp clears when stock climbs back above the threshold, so the
 * next run-down warns again.
 *
 * FOUND, SENT, THEN STAMPED — IN THAT ORDER
 * Stamping first and rolling back on a failed send was the obvious shape and it
 * is wrong: a crash between the two loses the dip silently, which is the exact
 * failure this feature exists to prevent. Stamping last means a send that
 * succeeds and then fails to stamp repeats itself once. A duplicate warning is
 * an annoyance; a swallowed one is a day of ads spent on an empty shelf.
 */

const log = createLogger("stock-alert");

/** Past this the message is a wall of text nobody reads to the end. */
const MAX_LISTED = 12;

export interface StockAlertOutcome {
  sent: boolean;
  /** How many products and options were newly low. */
  count?: number;
  reason?: string;
}

interface LowRow {
  id: string;
  label: string;
  left: number;
  threshold: number;
}

/**
 * Forgets the dips that have been restocked.
 *
 * Runs before the search, so a product that dipped, was refilled and has dipped
 * again is reported a second time rather than being swallowed by its own old
 * stamp.
 */
async function clearRecovered(): Promise<void> {
  await getDb()
    .update(products)
    .set({ lowStockAlertedAt: null })
    .where(
      and(
        isNotNull(products.lowStockAlertedAt),
        sql`${products.stockQuantity} > ${products.lowStockThreshold}`,
      ),
    );

  await getDb().execute(sql`
    update ${productVariants} v
       set low_stock_alerted_at = null
      from ${products} p
     where p.id = v.product_id
       and v.low_stock_alerted_at is not null
       and v.stock_quantity > p.low_stock_threshold
  `);
}

/**
 * Products whose total has fallen and that have not been mentioned yet.
 *
 * Only what is actually on sale. A draft or hidden product running out costs
 * the shop nothing, and warning about it teaches the owner that these messages
 * are usually noise — which is how the useful one gets ignored.
 *
 * Pre-order and discontinued are excluded for the same reason: neither is a
 * product anybody is trying to keep on the shelf.
 */
async function findLowProducts(): Promise<LowRow[]> {
  const rows = await getDb()
    .select({
      id: products.id,
      name: products.name,
      left: products.stockQuantity,
      threshold: products.lowStockThreshold,
    })
    .from(products)
    .where(
      and(
        eq(products.status, "active"),
        eq(products.isVisible, true),
        isNull(products.lowStockAlertedAt),
        sql`${products.stockQuantity} <= ${products.lowStockThreshold}`,
        sql`${products.stockStatus} not in ('pre_order', 'discontinued')`,
      ),
    )
    .orderBy(products.stockQuantity)
    .limit(MAX_LISTED);

  return rows.map((row) => ({
    id: row.id,
    label: row.name,
    left: row.left,
    threshold: row.threshold,
  }));
}

/** Individual options that have run down inside a product that looks fine. */
async function findLowVariants(): Promise<LowRow[]> {
  const rows = await getDb().execute(sql`
    select v.id,
           p.name             as product_name,
           v.sku              as sku,
           v.options          as options,
           v.stock_quantity   as remaining,
           p.low_stock_threshold as threshold
      from ${productVariants} v
      join ${products} p on p.id = v.product_id
     where p.status = 'active'
       and p.is_visible
       and v.is_active
       and v.low_stock_alerted_at is null
       and v.stock_quantity <= p.low_stock_threshold
       and p.stock_status not in ('pre_order', 'discontinued')
     order by v.stock_quantity
     limit ${MAX_LISTED}
  `);

  return rows.rows.map((row) => {
    /* The option values a customer would recognise — "Black · L" — falling back
       to the SKU when a variant has nothing readable on it. */
    const options = row.options as Record<string, string> | null;
    const readable = options ? Object.values(options).filter(Boolean).join(" · ") : "";

    return {
      id: String(row.id),
      label: `${String(row.product_name)} — ${readable || String(row.sku)}`,
      left: Number(row.remaining ?? 0),
      threshold: Number(row.threshold ?? 0),
    };
  });
}

/**
 * Checks stock and warns once per dip.
 *
 * Every failure is returned rather than thrown: this runs on a schedule with
 * nobody watching, and a rejected promise in a timer is a check that stopped
 * silently — which is the failure mode this whole feature exists to prevent.
 */
export async function alertLowStock(
  /**
   * Test seam, matching `__setTestConnection` in the database client.
   *
   * The interesting behaviour here is the DECISION to send and the bookkeeping
   * around it — once per dip, again after a restock — and none of that can be
   * exercised without a send that reports success. ES module exports cannot be
   * replaced from a test, so the sender is a parameter with the real one as its
   * default. Production never passes it.
   */
  notify: typeof telegram.notifyLowStock = telegram.notifyLowStock,
): Promise<StockAlertOutcome> {
  const settings = await getSettings();

  /* Not configured is not a failure. A shop that has not connected Telegram
     should not get an error in its log every five minutes. */
  const problem = telegram.configProblem(settings);
  if (problem !== null) return { sent: false, reason: problem };

  try {
    await clearRecovered();

    const [lowProducts, lowVariants] = await Promise.all([
      findLowProducts(),
      findLowVariants(),
    ]);

    const items = [...lowProducts, ...lowVariants];
    if (items.length === 0) return { sent: false, reason: "Nothing has newly run low." };

    const outcome = await notify(
      items.map((item) => ({ label: item.label, left: item.left, threshold: item.threshold })),
      settings,
    );

    if (!outcome.sent) {
      /* Nothing was stamped, so the next pass tries again with the same list. */
      log.error({ reason: outcome.reason }, "Low stock warning not sent");
      return { sent: false, ...(outcome.reason ? { reason: outcome.reason } : {}) };
    }

    /* Stamped only now, and only the rows that were actually in the message. */
    if (lowProducts.length > 0) {
      await getDb()
        .update(products)
        .set({ lowStockAlertedAt: sql`now()` })
        .where(inArray(products.id, lowProducts.map((row) => row.id)));
    }
    if (lowVariants.length > 0) {
      await getDb()
        .update(productVariants)
        .set({ lowStockAlertedAt: sql`now()` })
        .where(inArray(productVariants.id, lowVariants.map((row) => row.id)));
    }

    log.info(
      { products: lowProducts.length, variants: lowVariants.length },
      "Low stock warning sent",
    );
    return { sent: true, count: items.length };
  } catch (error) {
    log.error({ err: error }, "Low stock check failed");
    return { sent: false, reason: "The stock check failed." };
  }
}
