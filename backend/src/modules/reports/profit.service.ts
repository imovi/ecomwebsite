import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { orderItems } from "../../db/schema/order-items.js";
import type { StoreSettingsRow } from "../../db/schema/store-settings.js";
import { getSettings } from "../settings/settings.service.js";
import { amountWithin, findForRange } from "./expense.service.js";

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
  /** Share of ad spend by revenue. An estimate — see the file header. */
  estimatedAdSpend: number;
  /** Gross profit less the estimated ad share. */
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
        eq(orders.status, "delivered"),
        /* Dated by delivery, not placement: an order placed in March and
           delivered in April is April's income. */
        gte(sql`(${orders.deliveredAt} at time zone 'UTC')::date`, sql`${range.from}::date`),
        lte(sql`(${orders.deliveredAt} at time zone 'UTC')::date`, sql`${range.to}::date`),
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
  const courierPaid = delivered.reduce(
    (sum, order) => sum + courierCostOf(order.deliveryZone, settings),
    0,
  );
  const packaging = delivered.length * settings.packagingCostPerOrder;

  /* Returns and cancellations, counted on the day they happened. */
  const [returned] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${orders.grandTotal}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "returned"),
        gte(sql`(${orders.returnedAt} at time zone 'UTC')::date`, sql`${range.from}::date`),
        lte(sql`(${orders.returnedAt} at time zone 'UTC')::date`, sql`${range.to}::date`),
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
        eq(orders.status, "cancelled"),
        gte(sql`(${orders.cancelledAt} at time zone 'UTC')::date`, sql`${range.from}::date`),
        lte(sql`(${orders.cancelledAt} at time zone 'UTC')::date`, sql`${range.to}::date`),
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
    .where(inArray(orders.status, ["pending", "confirmed", "processing", "packed", "shipped"]));

  const openIds = await db
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.status, ["pending", "confirmed", "processing", "packed", "shipped"]));

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
  const netProfit =
    grossProfit + (deliveryCharged - courierPaid) - packaging - returnCost - expenseTotal;

  /* Per product, with ads shared out by revenue. */
  const products: ProductProfitDto[] = lines
    .map((line) => {
      const share = revenue > 0 ? line.revenue / revenue : 0;
      const estimatedAdSpend = Math.round(adSpend * share);
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
        estimatedNetProfit: lineGross - estimatedAdSpend,
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
