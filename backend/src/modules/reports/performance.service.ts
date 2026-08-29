import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { orderItems } from "../../db/schema/order-items.js";
import { products } from "../../db/schema/products.js";
import { abandonedCheckouts } from "../../db/schema/abandoned-checkouts.js";
import { productAdSpend } from "../../db/schema/product-ad-spend.js";
import { shopDay, type DateRange, type RangePreset } from "./profit.service.js";

/**
 * Marketing performance.
 *
 * The profit report answers "did the shop make money". This one answers the
 * question underneath it: **is the advertising working**, and it is a different
 * question with a different shape, which is why it is a separate report rather
 * than another section of that one.
 *
 * THE COHORT IS ORDERS AS PLACED, NOT MONEY AS BANKED
 * Profit is dated by delivery, deliberately. A funnel cannot be: to ask what
 * share of an ad's orders survived to the door, the orders counted at the top
 * and the deliveries counted at the bottom have to be the SAME orders. So every
 * figure here follows a cohort — the orders PLACED inside the range — through
 * to whatever became of them, however long after the range that happened.
 *
 * Mixing the two is how a shop ends up reporting a 130% delivery rate in a
 * month that cleared a backlog.
 *
 * ORDERS STILL MOVING ARE NOT FAILURES
 * A cohort from the last three days is mostly undelivered because it is young,
 * not because it is being refused. Rates are therefore computed over SETTLED
 * orders only — delivered plus cancelled plus returned — and the count still in
 * flight is reported beside them so the denominator is never a mystery.
 *
 * WHAT META WOULD TELL YOU, AND WHAT ACTUALLY HAPPENED
 * Meta counts a Purchase when the order is placed. On cash on delivery a fifth
 * or more of those never reach a customer, so the ROAS in Ads Manager is not
 * wrong about what it measures — it is measuring something the shop cannot
 * bank. Both are reported here: `placedRoas` is the Ads Manager view,
 * `trueRoas` is the same spend against orders that actually arrived. The gap
 * between them is the report's whole reason to exist.
 */

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** One step of the funnel, with what it cost to get there. */
export interface FunnelStep {
  key: "checkoutsStarted" | "ordersPlaced" | "confirmed" | "delivered";
  count: number;
  /** Share of the step above. Null for the first step, which has none. */
  ofPreviousPercent: number | null;
}

export interface DeliveryOutcome {
  /** Orders placed inside the range. The cohort everything below follows. */
  placed: number;
  delivered: number;
  cancelled: number;
  returned: number;
  /** Placed, not yet delivered, cancelled or returned. Not a failure. */
  stillMoving: number;
  /** delivered + cancelled + returned. The honest denominator. */
  settled: number;
  /** delivered ÷ settled. Null while nothing has settled yet. */
  ratePercent: number | null;
}

export interface AdsPerformance {
  /** Recorded per-product boost spend inside the range. */
  spend: number;
  /** Cohort orders carrying a Facebook click or browser id. */
  attributedPlaced: number;
  attributedDelivered: number;
  /** Value of those orders as placed — the Ads Manager view. */
  placedValue: number;
  /** Value of the ones that arrived. */
  deliveredValue: number;
  placedRoas: number | null;
  trueRoas: number | null;
  costPerDeliveredOrder: number | null;
  /**
   * Share of cohort orders that carry any Facebook identifier.
   *
   * Never 100%, and a low number does not mean the ads are not working: a
   * shopper who saw the ad, left, and came back by typing the address carries
   * nothing. Reported so the figures above are read as a floor rather than a
   * measurement.
   */
  attributionCoveragePercent: number;
}

export interface ProductPerformance {
  productId: string;
  productName: string;
  spend: number;
  placed: number;
  delivered: number;
  deliveredValue: number;
  deliveryRatePercent: number | null;
  trueRoas: number | null;
}

export interface DailyPoint {
  date: string;
  spend: number;
  placed: number;
  delivered: number;
}

export interface PerformanceReport {
  range: DateRange & { preset?: RangePreset | undefined };
  funnel: FunnelStep[];
  delivery: DeliveryOutcome;
  ads: AdsPerformance;
  byProduct: ProductPerformance[];
  daily: DailyPoint[];
  /** True when the cohort is too young for its delivery rate to mean much. */
  cohortStillYoung: boolean;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** A percentage, or null when the denominator is zero. */
function share(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** A ratio to two decimals, or null when nothing was spent. */
function ratio(value: number, cost: number): number | null {
  if (cost <= 0) return null;
  return Math.round((value / cost) * 100) / 100;
}

/**
 * Orders placed inside the range, excluding deleted ones.
 *
 * `created_at` rather than any status timestamp: this is the cohort definition,
 * and it is the one date on an order that never moves.
 */
function placedInRange(range: DateRange) {
  return and(
    isNull(orders.deletedAt),
    gte(shopDay(orders.createdAt), sql`${range.from}::date`),
    lte(shopDay(orders.createdAt), sql`${range.to}::date`),
  );
}

/**
 * Carries a Facebook identifier.
 *
 * `fbc` is the click id, set only when the shopper arrived from an ad click.
 * `fbp` is the browser id, set by the pixel on any visit — weaker evidence, but
 * an order that has one at all came through a browser the pixel had seen, which
 * is more than a walk-in phone order can say. Both are stored as empty strings
 * rather than nulls when absent, so both checks are needed.
 */
const fromAds = sql`(coalesce(${orders.fbc}, '') <> '' or coalesce(${orders.fbp}, '') <> '')`;

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

export async function performanceReport(
  range: DateRange,
  options: { preset?: RangePreset | undefined } = {},
): Promise<PerformanceReport> {
  const [cohort, adsRow, checkoutRow, spendRow, byProduct, daily] = await Promise.all([
    cohortOutcome(range),
    attributedTotals(range),
    checkoutsStarted(range),
    spendTotal(range),
    productBreakdown(range),
    dailySeries(range),
  ]);

  const settled = cohort.delivered + cohort.cancelled + cohort.returned;
  const stillMoving = cohort.placed - settled;

  const delivery: DeliveryOutcome = {
    placed: cohort.placed,
    delivered: cohort.delivered,
    cancelled: cohort.cancelled,
    returned: cohort.returned,
    stillMoving,
    settled,
    ratePercent: share(cohort.delivered, settled),
  };

  const ads: AdsPerformance = {
    spend: spendRow.spend,
    attributedPlaced: adsRow.placed,
    attributedDelivered: adsRow.delivered,
    placedValue: adsRow.placedValue,
    deliveredValue: adsRow.deliveredValue,
    placedRoas: ratio(adsRow.placedValue, spendRow.spend),
    trueRoas: ratio(adsRow.deliveredValue, spendRow.spend),
    costPerDeliveredOrder:
      adsRow.delivered > 0 ? Math.round(spendRow.spend / adsRow.delivered) : null,
    attributionCoveragePercent: share(adsRow.placed, cohort.placed) ?? 0,
  };

  /* The funnel is the cohort narrowing, step by step. `confirmed` counts every
     order that ever reached the confirmation call, including ones that went on
     to be cancelled — a step is "did it get this far", not "is it here now". */
  const funnel: FunnelStep[] = [
    {
      key: "checkoutsStarted",
      count: checkoutRow.started,
      ofPreviousPercent: null,
    },
    {
      key: "ordersPlaced",
      count: cohort.placed,
      ofPreviousPercent: share(cohort.placed, checkoutRow.started),
    },
    {
      key: "confirmed",
      count: cohort.confirmed,
      ofPreviousPercent: share(cohort.confirmed, cohort.placed),
    },
    {
      key: "delivered",
      count: cohort.delivered,
      ofPreviousPercent: share(cohort.delivered, cohort.confirmed),
    },
  ];

  return {
    range: { ...range, preset: options.preset },
    funnel,
    delivery,
    ads,
    byProduct,
    daily,
    /* More than a third of the cohort undecided means the rate below is being
       read too early. Three days is roughly a Dhaka delivery cycle. */
    cohortStillYoung: cohort.placed > 0 && stillMoving / cohort.placed > 0.35,
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/** What became of the orders placed in the range. One pass, one cohort. */
async function cohortOutcome(range: DateRange): Promise<{
  placed: number;
  confirmed: number;
  delivered: number;
  cancelled: number;
  returned: number;
}> {
  const rows = await getDb()
    .select({
      placed: sql<number>`count(*)`.mapWith(Number),
      /* Ever confirmed, by the timestamp rather than the current status: an
         order confirmed on the phone and later refused still passed this step,
         and a funnel that forgets that shows the call failing when the doorstep
         did. */
      confirmed: sql<number>`count(*) filter (where ${orders.confirmedAt} is not null)`.mapWith(
        Number,
      ),
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'delivered')`.mapWith(
        Number,
      ),
      cancelled: sql<number>`count(*) filter (where ${orders.status} = 'cancelled')`.mapWith(
        Number,
      ),
      returned: sql<number>`count(*) filter (where ${orders.status} = 'returned')`.mapWith(Number),
    })
    .from(orders)
    .where(placedInRange(range));

  return rows[0] ?? { placed: 0, confirmed: 0, delivered: 0, cancelled: 0, returned: 0 };
}

/** The same cohort, narrowed to orders that carry a Facebook identifier. */
async function attributedTotals(range: DateRange): Promise<{
  placed: number;
  delivered: number;
  placedValue: number;
  deliveredValue: number;
}> {
  const rows = await getDb()
    .select({
      placed: sql<number>`count(*)`.mapWith(Number),
      delivered: sql<number>`count(*) filter (where ${orders.status} = 'delivered')`.mapWith(
        Number,
      ),
      /* Goods only. Delivery charge is collected for the courier, not earned,
         and counting it as ad revenue would flatter every ROAS on the page. */
      placedValue: sql<number>`coalesce(sum(${orders.subtotal}), 0)`.mapWith(Number),
      deliveredValue:
        sql<number>`coalesce(sum(${orders.subtotal}) filter (where ${orders.status} = 'delivered'), 0)`.mapWith(
          Number,
        ),
    })
    .from(orders)
    .where(and(placedInRange(range), fromAds));

  return rows[0] ?? { placed: 0, delivered: 0, placedValue: 0, deliveredValue: 0 };
}

/**
 * How many checkouts were started in the range.
 *
 * An abandoned checkout that was later recovered became an order, and both
 * rows exist — counting each separately would invent a shopper. Recovered rows
 * are therefore excluded and the orders count for them.
 */
async function checkoutsStarted(range: DateRange): Promise<{ started: number }> {
  const [abandoned, placed] = await Promise.all([
    getDb()
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(abandonedCheckouts)
      .where(
        and(
          isNull(abandonedCheckouts.recoveredOrderId),
          ne(abandonedCheckouts.status, "dismissed"),
          gte(shopDay(abandonedCheckouts.createdAt), sql`${range.from}::date`),
          lte(shopDay(abandonedCheckouts.createdAt), sql`${range.to}::date`),
        ),
      ),
    getDb()
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(orders)
      .where(placedInRange(range)),
  ]);

  return { started: (abandoned[0]?.n ?? 0) + (placed[0]?.n ?? 0) };
}

async function spendTotal(range: DateRange): Promise<{ spend: number }> {
  const rows = await getDb()
    .select({ spend: sql<number>`coalesce(sum(${productAdSpend.amount}), 0)`.mapWith(Number) })
    .from(productAdSpend)
    .where(and(gte(productAdSpend.spentOn, range.from), lte(productAdSpend.spentOn, range.to)));

  return rows[0] ?? { spend: 0 };
}

/**
 * Per product: what was spent on it, and what it did.
 *
 * Driven from ad spend rather than from sales, because the question this table
 * answers is "was boosting this worth it". A product with no recorded spend has
 * no answer to give and is left out; the profit report already ranks products
 * by margin for that.
 *
 * DELIBERATELY A DIFFERENT DENOMINATOR FROM THE HEADLINE
 * The headline return counts only orders carrying a Facebook identifier. This
 * one counts every delivered order for the product while it was being boosted,
 * attributed or not — because a boost lifts sales it never gets credited for,
 * and a shop deciding whether to keep paying for it needs the whole lift, not
 * the measurable slice. The two numbers therefore differ, and the screen says
 * so where they appear.
 */
async function productBreakdown(range: DateRange): Promise<ProductPerformance[]> {
  const spendRows = await getDb()
    .select({
      productId: productAdSpend.productId,
      productName: products.name,
      spend: sql<number>`coalesce(sum(${productAdSpend.amount}), 0)`.mapWith(Number),
    })
    .from(productAdSpend)
    .innerJoin(products, eq(productAdSpend.productId, products.id))
    .where(and(gte(productAdSpend.spentOn, range.from), lte(productAdSpend.spentOn, range.to)))
    .groupBy(productAdSpend.productId, products.name);

  if (spendRows.length === 0) return [];

  const ids = spendRows.map((row) => row.productId);

  /* Line-level, so a product is credited for its own share of a mixed order
     rather than for the whole basket it happened to be in. */
  const saleRows = await getDb()
    .select({
      productId: orderItems.productId,
      placed: sql<number>`count(distinct ${orders.id})`.mapWith(Number),
      delivered:
        sql<number>`count(distinct ${orders.id}) filter (where ${orders.status} = 'delivered')`.mapWith(
          Number,
        ),
      /* Same denominator as the headline rate. Dividing by everything placed
         would show a product at 50% next to a shop at 70% for the same day,
         purely because half its parcels were still on the road. */
      settled:
        sql<number>`count(distinct ${orders.id}) filter (where ${orders.status} in ('delivered', 'cancelled', 'returned'))`.mapWith(
          Number,
        ),
      deliveredValue:
        sql<number>`coalesce(sum(${orderItems.lineTotal}) filter (where ${orders.status} = 'delivered'), 0)`.mapWith(
          Number,
        ),
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(placedInRange(range), isNotNull(orderItems.productId), inArray(orderItems.productId, ids)))
    .groupBy(orderItems.productId);

  const sales = new Map(saleRows.map((row) => [row.productId, row]));

  return spendRows
    .map((row) => {
      const sale = sales.get(row.productId);
      const placed = sale?.placed ?? 0;
      const delivered = sale?.delivered ?? 0;
      const settled = sale?.settled ?? 0;
      const deliveredValue = sale?.deliveredValue ?? 0;

      return {
        productId: row.productId,
        productName: row.productName,
        spend: row.spend,
        placed,
        delivered,
        deliveredValue,
        deliveryRatePercent: share(delivered, settled),
        trueRoas: ratio(deliveredValue, row.spend),
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

/**
 * A day-by-day series, for the trend.
 *
 * Every day in the range appears, including the ones with nothing on them: a
 * chart that silently drops empty days compresses a quiet week into a busy one.
 */
async function dailySeries(range: DateRange): Promise<DailyPoint[]> {
  const [orderRows, spendRows] = await Promise.all([
    getDb()
      .select({
        date: sql<string>`to_char(${shopDay(orders.createdAt)}, 'YYYY-MM-DD')`,
        placed: sql<number>`count(*)`.mapWith(Number),
        delivered: sql<number>`count(*) filter (where ${orders.status} = 'delivered')`.mapWith(
          Number,
        ),
      })
      .from(orders)
      .where(placedInRange(range))
      .groupBy(shopDay(orders.createdAt)),
    getDb()
      .select({
        date: sql<string>`to_char(${productAdSpend.spentOn}, 'YYYY-MM-DD')`,
        spend: sql<number>`coalesce(sum(${productAdSpend.amount}), 0)`.mapWith(Number),
      })
      .from(productAdSpend)
      .where(and(gte(productAdSpend.spentOn, range.from), lte(productAdSpend.spentOn, range.to)))
      .groupBy(productAdSpend.spentOn),
  ]);

  const byDate = new Map<string, DailyPoint>();
  for (const row of orderRows) {
    byDate.set(row.date, { date: row.date, spend: 0, placed: row.placed, delivered: row.delivered });
  }
  for (const row of spendRows) {
    const point = byDate.get(row.date);
    if (point) point.spend = row.spend;
    else byDate.set(row.date, { date: row.date, spend: row.spend, placed: 0, delivered: 0 });
  }

  /* Filled in rather than left sparse. Capped so a "lifetime" range cannot ask
     the browser to draw a decade of empty columns. */
  const MAX_DAYS = 120;
  const out: DailyPoint[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);

  while (cursor <= end && out.length < MAX_DAYS) {
    const key = cursor.toISOString().slice(0, 10);
    out.push(byDate.get(key) ?? { date: key, spend: 0, placed: 0, delivered: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  /* A long range is shown from its most recent end — the days an owner is
     actually asking about. */
  if (out.length === MAX_DAYS && cursor <= end) {
    const remaining: DailyPoint[] = [];
    const back = new Date(`${range.to}T00:00:00Z`);
    while (remaining.length < MAX_DAYS) {
      const key = back.toISOString().slice(0, 10);
      remaining.unshift(byDate.get(key) ?? { date: key, spend: 0, placed: 0, delivered: 0 });
      back.setUTCDate(back.getUTCDate() - 1);
    }
    return remaining;
  }

  return out;
}
