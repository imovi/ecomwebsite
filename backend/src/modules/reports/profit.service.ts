import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { orderItems } from "../../db/schema/order-items.js";
/* Aliased: the report body already has a local `products` — the per-product
   rows it is building — and shadowing the table would silently break the join. */
import { products as productsTable } from "../../db/schema/products.js";
import type { StoreSettingsRow } from "../../db/schema/store-settings.js";
import { getSettings } from "../settings/settings.service.js";
import { amountWithin, findForRange } from "./expense.service.js";
import * as productAdSpendService from "./product-ad-spend.service.js";

/**
 * Profit and loss.
 *
 * THE ONE RULE: MONEY IS DELIVERED MONEY
 * On cash on delivery an order is not revenue when it is placed — it is a
 * promise. Roughly a fifth of them are refused at the door, and a shop that
 * counts placements as income sees a business that does not exist. Everything
 * under `realised` is therefore restricted to orders that actually reached a
 * customer's hands, dated by `delivered_at` rather than by when they were
 * placed. Orders still moving are reported separately as `inFlight`, and are
 * never added into profit.
 *
 * THE SECOND RULE: A COST NOBODY RECORDED IS UNKNOWN, NOT ZERO
 * Lines with no `unit_cost` are counted and reported. Silently treating them as
 * free would show a 100% margin on every product nobody has costed and quietly
 * inflate the whole report — the one failure mode that would make an owner trust
 * a number they should not.
 *
 * WHAT IS AN ESTIMATE
 * Goods, courier, packaging and returns are exact per product. Ads are not:
 * unless a shop runs one campaign per product, no honest attribution exists.
 * They are allocated across products by share of revenue and flagged as an
 * estimate wherever they appear, which is useful for ranking products and not
 * for accounting to the taka.
 */

/* -------------------------------------------------------------------------- */
/* Ranges                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Reports are read in Dhaka, so "today" means today there.
 *
 * The server may be anywhere and its clock is almost certainly UTC. Between
 * midnight and 6am Dhaka time, a UTC "today" is yesterday's date — an owner
 * checking last night's takings before bed would see the wrong day's figures.
 */
export const REPORT_UTC_OFFSET_MINUTES = 6 * 60;

/** `YYYY-MM-DD` for an instant, in the shop's timezone. */
export function shopDate(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + REPORT_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The shop's calendar day for a stored timestamp, in SQL.
 *
 * `at time zone 'UTC'` was the obvious thing to write and it was wrong: the
 * ranges above are resolved in Dhaka, so comparing them against a UTC date put
 * everything between midnight and 6am Dhaka into the previous day's report. A
 * parcel delivered at 1am read as yesterday's income — on the one screen the
 * shop is judged by, and only for the hours somebody is most likely to be
 * checking last night's takings.
 *
 * Named rather than repeated: three columns are dated this way, and one of them
 * being fixed alone would be worse than none, because the totals would stop
 * adding up between sections of the same report.
 */
function shopDay(column: SQL | AnyPgColumn): SQL {
  return sql`(${column} at time zone 'Asia/Dhaka')::date`;
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export type RangePreset = "today" | "yesterday" | "last7" | "last30" | "month" | "lifetime";

export interface DateRange {
  from: string;
  to: string;
}

/** The shop's own launch is the natural floor for "lifetime". */
const EPOCH = "2000-01-01";

export function resolveRange(
  preset: RangePreset | undefined,
  custom: { from?: string | undefined; to?: string | undefined },
  now: Date = new Date(),
): DateRange {
  /* An explicit range always wins — the custom picker must not be overridden
     by a preset left in the query string. */
  if (custom.from || custom.to) {
    const today = shopDate(now);
    return { from: custom.from ?? EPOCH, to: custom.to ?? today };
  }

  const today = shopDate(now);

  switch (preset ?? "last7") {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "last7":
      /* Inclusive of today: "last 7 days" to a shop owner means this week so
         far, not a week ending yesterday. */
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "lifetime":
      return { from: EPOCH, to: today };
  }
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProductProfitDto {
  productId: string | null;
  productName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  /** Revenue from lines whose cost was never recorded. */
  revenueWithUnknownCost: number;
  unitsWithUnknownCost: number;
  /** Share of the shop-wide ad line by revenue. An estimate — see the header. */
  estimatedAdSpend: number;
  /**
   * Boost money recorded against this product. A fact, not a share-out, and
   * reported separately so a reader can tell the two apart at a glance.
   */
  recordedAdSpend: number;
  /**
   * This product's share of the parcels it travelled in — courier plus boxing.
   * Exact per order, split across the products inside by revenue.
   */
  parcelCost: number;
  /** Gross profit less shipping, boxing, recorded boosts and the ad share. */
  estimatedNetProfit: number;
  /** Null when nothing about this product's cost is known. */
  marginPercent: number | null;
}

export interface ProfitReportDto {
  range: DateRange & { preset: RangePreset | null };

  realised: {
    orderCount: number;
    /** Goods only — delivery is reported separately, as its own line. */
    revenue: number;
    costOfGoods: number;
    grossProfit: number;

    deliveryCharged: number;
    courierPaid: number;
    /** Negative when free delivery is being paid for out of margin. */
    deliveryMargin: number;

    packaging: number;
    returns: { count: number; cost: number };

    expenses: { total: number; byCategory: Record<string, number> };

    /**
     * Boosts recorded against individual products.
     *
     * Its own line, not part of `expenses`: everything else under advertising
     * is a shop-wide figure shared out by revenue, and this one is measured.
     */
    productBoosts: number;

    netProfit: number;
    /**
     * Net profit over total revenue. Null when there was no revenue.
     *
     * Uncosted sales sit in the denominator while contributing nothing to the
     * numerator, so an incompletely-costed catalogue reads as a LOWER margin
     * than reality. `coverage` says how much of the report that affects.
     */
    marginPercent: number | null;
  };

  /**
   * Orders on their way. Never added into profit — a promise is not money.
   */
  inFlight: { orderCount: number; value: number; expectedGrossProfit: number };

  /**
   * Orders that earned nothing but still cost something.
   *
   * Usually the number that changes how a shop is run: the packaging and the
   * ad spend behind a cancelled order are gone regardless.
   */
  leaked: { cancelled: number; returned: number; returnCost: number; lostValue: number };

  /**
   * How much of the report is guesswork.
   *
   * Surfaced rather than buried: an owner reading a margin needs to know that a
   * third of their sales have no cost recorded, or the number is worse than no
   * number at all.
   */
  coverage: {
    linesWithCost: number;
    linesWithoutCost: number;
    revenueWithUnknownCost: number;
    /** True when every delivered line had a cost. */
    complete: boolean;
  };

  products: ProductProfitDto[];
}

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

/** Delivered orders in range, with their goods, cost and courier zone. */
async function realisedOrders(range: DateRange) {
  const db = getDb();

  const rows = await db
    .select({
      orderId: orders.id,
      deliveryZone: orders.deliveryZone,
      deliveryCharge: orders.deliveryCharge,
      subtotal: orders.subtotal,
    })
    .from(orders)
    .where(
      and(
        isNull(orders.deletedAt),
        eq(orders.status, "delivered"),
        /* Dated by delivery, not placement: an order placed in March and
           delivered in April is April's income. */
        gte(shopDay(orders.deliveredAt), sql`${range.from}::date`),
        lte(shopDay(orders.deliveredAt), sql`${range.to}::date`),
      ),
    );

  return rows;
}

interface LineAggregate {
  productId: string | null;
  productName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  unitsWithUnknownCost: number;
  revenueWithUnknownCost: number;
  linesWithCost: number;
  linesWithoutCost: number;
}

/**
 * The same lines, ungrouped and carrying their order id.
 *
 * Needed because a parcel's shipping cost belongs to an ORDER, and splitting it
 * across products requires knowing which order each line came from — which the
 * grouped aggregate above has already thrown away.
 */
async function rawLinesFor(orderIds: string[]) {
  if (orderIds.length === 0) return [];

  return getDb()
    .select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      revenue: orderItems.lineTotal,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds));
}

async function linesFor(orderIds: string[]): Promise<LineAggregate[]> {
  if (orderIds.length === 0) return [];

  const rows = await getDb()
    .select({
      productId: orderItems.productId,
      /* The snapshotted name, so a product renamed or deleted since still
         appears as the customer bought it. */
      productName: orderItems.productName,
      unitsSold: sql<number>`sum(${orderItems.quantity})`.mapWith(Number),
      revenue: sql<number>`sum(${orderItems.lineTotal})`.mapWith(Number),
      cost: sql<number>`
        coalesce(sum(${orderItems.unitCost} * ${orderItems.quantity})
          filter (where ${orderItems.unitCost} is not null), 0)
      `.mapWith(Number),
      unitsWithUnknownCost: sql<number>`
        coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.unitCost} is null), 0)
      `.mapWith(Number),
      revenueWithUnknownCost: sql<number>`
        coalesce(sum(${orderItems.lineTotal}) filter (where ${orderItems.unitCost} is null), 0)
      `.mapWith(Number),
      linesWithCost: sql<number>`count(*) filter (where ${orderItems.unitCost} is not null)`.mapWith(
        Number,
      ),
      linesWithoutCost: sql<number>`count(*) filter (where ${orderItems.unitCost} is null)`.mapWith(
        Number,
      ),
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    /* Grouped by product AND name: a deleted product has a null id, and
       lumping every deleted product into one "unknown" row would be useless. */
    .groupBy(orderItems.productId, orderItems.productName);

  return rows;
}

function courierCostOf(
  zone: "inside_dhaka" | "outside_dhaka",
  settings: StoreSettingsRow,
): number {
  return zone === "inside_dhaka"
    ? settings.courierCostInsideDhaka
    : settings.courierCostOutsideDhaka;
}

/* -------------------------------------------------------------------------- */
/* Per-parcel costs                                                           */
/* -------------------------------------------------------------------------- */

interface ParcelCost {
  orderId: string;
  courier: number;
  packaging: number;
}

/**
 * What each delivered parcel actually cost to ship and to box.
 *
 * A courier bills per PARCEL, so per-product overrides cannot be summed: an
 * order holding a laptop and a cable is one box, and adding both overrides
 * together would invent a cost nobody was charged. The rule is the HIGHEST
 * override among the products inside, falling back to the shop's zone figure —
 * the honest reading of "this bulky item makes the parcel cost more".
 *
 * Products with no override contribute nothing to the maximum, so a shop can
 * set them on the few items that need it and leave the rest alone.
 */
async function parcelCostsFor(
  orders: { orderId: string; deliveryZone: "inside_dhaka" | "outside_dhaka" }[],
  settings: StoreSettingsRow,
): Promise<Map<string, ParcelCost>> {
  const byOrder = new Map<string, ParcelCost>();
  for (const order of orders) {
    byOrder.set(order.orderId, {
      orderId: order.orderId,
      courier: courierCostOf(order.deliveryZone, settings),
      packaging: settings.packagingCostPerOrder,
    });
  }

  if (orders.length === 0) return byOrder;

  const overrides = await getDb()
    .select({
      orderId: orderItems.orderId,
      inside: productsTable.courierCostInsideDhaka,
      outside: productsTable.courierCostOutsideDhaka,
      packaging: productsTable.packagingCost,
    })
    .from(orderItems)
    .innerJoin(productsTable, eq(orderItems.productId, productsTable.id))
    .where(inArray(orderItems.orderId, orders.map((order) => order.orderId)));

  const zoneOf = new Map(orders.map((order) => [order.orderId, order.deliveryZone]));

  for (const row of overrides) {
    const parcel = byOrder.get(row.orderId);
    if (!parcel) continue;

    const zone = zoneOf.get(row.orderId);
    const courierOverride = zone === "inside_dhaka" ? row.inside : row.outside;

    if (courierOverride !== null) {
      parcel.courier = Math.max(parcel.courier, courierOverride);
    }
    if (row.packaging !== null) {
      parcel.packaging = Math.max(parcel.packaging, row.packaging);
    }
  }

  return byOrder;
}

/**
 * Splits each parcel's shipping and boxing back across the products inside it,
 * by share of that order's revenue.
 *
 * Without this the per-product table and the shop totals would disagree: the
 * totals would carry the real parcel costs while the product rows carried none,
 * and the difference would look like a bug in whichever number was read second.
 */
function attributeParcelCosts(
  lines: { orderId: string; productId: string | null; productName: string; revenue: number }[],
  parcels: Map<string, ParcelCost>,
): Map<string, number> {
  const revenueByOrder = new Map<string, number>();
  for (const line of lines) {
    revenueByOrder.set(line.orderId, (revenueByOrder.get(line.orderId) ?? 0) + line.revenue);
  }

  const byProduct = new Map<string, number>();

  for (const line of lines) {
    const parcel = parcels.get(line.orderId);
    if (!parcel) continue;

    const orderRevenue = revenueByOrder.get(line.orderId) ?? 0;
    /* A zero-revenue order — every line free — splits evenly rather than
       dividing by zero and dropping the cost entirely. */
    const share =
      orderRevenue > 0
        ? line.revenue / orderRevenue
        : 1 / Math.max(1, lines.filter((other) => other.orderId === line.orderId).length);

    const key = line.productId ?? `name:${line.productName}`;
    byProduct.set(
      key,
      (byProduct.get(key) ?? 0) + (parcel.courier + parcel.packaging) * share,
    );
  }

  return byProduct;
}

export async function profitReport(
  range: DateRange,
  options: { preset?: RangePreset | undefined } = {},
): Promise<ProfitReportDto> {
  const db = getDb();
  const settings = await getSettings();

  const delivered = await realisedOrders(range);
  const lines = await linesFor(delivered.map((order) => order.orderId));

  const revenue = lines.reduce((sum, line) => sum + line.revenue, 0);
  const costOfGoods = lines.reduce((sum, line) => sum + line.cost, 0);

  /**
   * Revenue from lines nobody costed.
   *
   * Subtracted from gross profit below, which makes those sales contribute
   * exactly zero rather than 100%. `revenue - costOfGoods` alone would book
   * every uncosted sale as pure profit — the precise failure this module exists
   * to avoid. Zero-profit is also the conservative direction: it understates
   * rather than flatters, which is the safe way for a business decision to be
   * wrong.
   */
  const revenueWithUnknownCost = lines.reduce(
    (sum, line) => sum + line.revenueWithUnknownCost,
    0,
  );

  const deliveryCharged = delivered.reduce((sum, order) => sum + order.deliveryCharge, 0);

  /* Per parcel, honouring any per-product overrides — see `parcelCostsFor`. A
     shop with no overrides gets exactly the old figures. */
  const parcels = await parcelCostsFor(delivered, settings);
  const courierPaid = [...parcels.values()].reduce((sum, parcel) => sum + parcel.courier, 0);
  const packaging = [...parcels.values()].reduce((sum, parcel) => sum + parcel.packaging, 0);

  /* The same parcel costs, split back across the products inside each order, so
     the per-product table and these totals cannot disagree. */
  const rawLines = await rawLinesFor(delivered.map((order) => order.orderId));
  const parcelCostByProduct = attributeParcelCosts(rawLines, parcels);

  /* Boosts recorded against a specific product: a fact, not a share-out. */
  const recordedBoosts = await productAdSpendService.totalsForRange(range);
  const boostTotal = [...recordedBoosts.values()].reduce((sum, amount) => sum + amount, 0);

  /* Returns and cancellations, counted on the day they happened. */
  const [returned] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${orders.grandTotal}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(
      and(
        isNull(orders.deletedAt),
        eq(orders.status, "returned"),
        gte(shopDay(orders.returnedAt), sql`${range.from}::date`),
        lte(shopDay(orders.returnedAt), sql`${range.to}::date`),
      ),
    );

  const [cancelled] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${orders.grandTotal}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(
      and(
        isNull(orders.deletedAt),
        eq(orders.status, "cancelled"),
        gte(shopDay(orders.cancelledAt), sql`${range.from}::date`),
        lte(shopDay(orders.cancelledAt), sql`${range.to}::date`),
      ),
    );

  const returnCount = returned?.count ?? 0;
  const returnCost = returnCount * settings.returnCostPerOrder;

  /* In flight: everything placed and not yet resolved, whenever it was placed.
     A range does not apply — these are open now. */
  const [open] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${orders.grandTotal}), 0)`.mapWith(Number),
      subtotal: sql<number>`coalesce(sum(${orders.subtotal}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(
      and(
        isNull(orders.deletedAt),
        inArray(orders.status, ["pending", "confirmed", "processing", "packed", "shipped"]),
      ),
    );

  const openIds = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        isNull(orders.deletedAt),
        inArray(orders.status, ["pending", "confirmed", "processing", "packed", "shipped"]),
      ),
    );

  const openLines = await linesFor(openIds.map((row) => row.id));
  const expectedGrossProfit = openLines.reduce(
    (sum, line) => sum + (line.revenue - line.cost - line.revenueWithUnknownCost),
    0,
  );

  /* Expenses, with monthly ones spread across their days. */
  const expenseRows = await findForRange(range.from, range.to);
  const byCategory: Record<string, number> = {};
  for (const row of expenseRows) {
    const amount = amountWithin(row, range.from, range.to);
    if (amount === 0) continue;
    byCategory[row.category] = (byCategory[row.category] ?? 0) + amount;
  }
  const expenseTotal = Object.values(byCategory).reduce((sum, value) => sum + value, 0);
  const adSpend = byCategory.ads ?? 0;

  const grossProfit = revenue - costOfGoods - revenueWithUnknownCost;
  /* Boosts sit alongside the ledger rather than inside it: the ledger's `ads`
     line is shop-wide campaigns, a boost is money aimed at one product. Adding
     both is correct as long as the same taka is not written in both places,
     which is what the panel warns about where a boost is entered. */
  const netProfit =
    grossProfit +
    (deliveryCharged - courierPaid) -
    packaging -
    returnCost -
    expenseTotal -
    boostTotal;

  /* Per product: shipping and boxing attributed exactly, boosts taken as
     recorded, and only the shop-wide ad line still shared out by revenue. */
  const products: ProductProfitDto[] = lines
    .map((line) => {
      const share = revenue > 0 ? line.revenue / revenue : 0;
      const estimatedAdSpend = Math.round(adSpend * share);

      const key = line.productId ?? `name:${line.productName}`;
      const recordedAdSpend = line.productId ? (recordedBoosts.get(line.productId) ?? 0) : 0;
      const parcelCost = Math.round(parcelCostByProduct.get(key) ?? 0);

      const lineGross = line.revenue - line.cost - line.revenueWithUnknownCost;

      return {
        productId: line.productId,
        productName: line.productName,
        unitsSold: line.unitsSold,
        revenue: line.revenue,
        cost: line.cost,
        grossProfit: lineGross,
        revenueWithUnknownCost: line.revenueWithUnknownCost,
        unitsWithUnknownCost: line.unitsWithUnknownCost,
        estimatedAdSpend,
        recordedAdSpend,
        parcelCost,
        estimatedNetProfit: lineGross - estimatedAdSpend - recordedAdSpend - parcelCost,
        /* Only over the revenue whose cost is actually known — a margin that
           silently includes uncosted sales is the flattering kind. */
        marginPercent:
          line.revenue - line.revenueWithUnknownCost > 0
            ? Math.round(
                (lineGross / (line.revenue - line.revenueWithUnknownCost)) * 100,
              )
            : null,
      };
    })
    /* Worst first is the more useful default on a shop with loss-makers, but
       the common question is "what earns most", so: descending. */
    .sort((a, b) => b.estimatedNetProfit - a.estimatedNetProfit);

  const linesWithCost = lines.reduce((sum, line) => sum + line.linesWithCost, 0);
  const linesWithoutCost = lines.reduce((sum, line) => sum + line.linesWithoutCost, 0);

  return {
    range: { ...range, preset: options.preset ?? null },
    realised: {
      orderCount: delivered.length,
      revenue,
      costOfGoods,
      grossProfit,
      deliveryCharged,
      courierPaid,
      deliveryMargin: deliveryCharged - courierPaid,
      packaging,
      returns: { count: returnCount, cost: returnCost },
      expenses: { total: expenseTotal, byCategory },
      /* Reported on its own line rather than folded into `expenses`, because
         this is the one advertising figure that is measured rather than
         inferred — and the difference is the whole point of recording it. */
      productBoosts: boostTotal,
      netProfit,
      marginPercent: revenue > 0 ? Math.round((netProfit / revenue) * 100) : null,
    },
    inFlight: {
      orderCount: open?.count ?? 0,
      value: open?.value ?? 0,
      expectedGrossProfit,
    },
    leaked: {
      cancelled: cancelled?.count ?? 0,
      returned: returnCount,
      returnCost,
      lostValue: (cancelled?.value ?? 0) + (returned?.value ?? 0),
    },
    coverage: {
      linesWithCost,
      linesWithoutCost,
      revenueWithUnknownCost,
      complete: linesWithoutCost === 0,
    },
    products,
  };
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

/** RFC 4180 quoting — a product name with a comma must not shift every column. */
function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The per-product table as CSV.
 *
 * Deliberately the product breakdown rather than the summary: a summary is four
 * numbers anyone can read off the screen, while the per-product table is what
 * someone actually wants to sort and filter in a spreadsheet.
 */
export function toCsv(report: ProfitReportDto): string {
  const header = [
    "Product",
    "Units",
    "Revenue",
    "Cost of goods",
    "Gross profit",
    "Ads (estimated)",
    "Net profit (estimated)",
    "Margin %",
    "Revenue with unknown cost",
  ];

  const rows = report.products.map((product) => [
    csvCell(product.productName),
    product.unitsSold,
    product.revenue,
    product.cost,
    product.grossProfit,
    product.estimatedAdSpend,
    product.estimatedNetProfit,
    product.marginPercent ?? "",
    product.revenueWithUnknownCost,
  ]);

  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
}
