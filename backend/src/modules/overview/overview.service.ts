import { ROLE_RANK, type AdminRole } from "../../db/schema/enums.js";
import { profitReport, shopDate, type DateRange } from "../reports/profit.service.js";
import { createLogger } from "../../core/logger.js";
import {
  callList,
  compareMoney,
  parcelHealth,
  returnRate,
  sourceBreakdown,
  type CallList,
  type DayMoney,
  type ParcelHealth,
  type ReturnRate,
  type SourceCount,
  type Window,
} from "./overview.repository.js";
import {
  checkoutFunnel,
  courierCash,
  courierSuccess,
  returnRisk,
  salesSeries,
  stockForecast,
  type Bucket,
  type CheckoutFunnel,
  type CourierCashRow,
  type CourierScoreRow,
  type ReturnRiskRow,
  type SalesPoint,
  type StockForecastRow,
} from "./overview.insights.repository.js";

/**
 * The dashboard summary.
 *
 * ONE RANGE, EVERY NUMBER
 * -----------------------
 * This screen used to run two clocks: the status tiles followed the picker
 * while the takings were always today-against-yesterday and the source split
 * was always thirty days, each labelled "not affected by the filter above". The
 * labels were honest and the screen was still misread — somebody selects Last
 * 30 days, sees a revenue figure, and has no reason to suspect it is answering
 * a different question from the tiles beside it.
 *
 * So everything below now takes the same window, and the comparison figure is
 * the window before it of equal length rather than a hardcoded yesterday.
 *
 * TWO THINGS STILL DO NOT TAKE THE RANGE, ON PURPOSE
 * --------------------------------------------------
 * `parcels` and `stock` are states, not histories. A parcel that stopped moving
 * is stuck NOW, and four units left is four units left; asking what the stock
 * was last Tuesday is not a question anyone opens a dashboard to ask, and a
 * stock alert that disappeared because the picker said "yesterday" would be an
 * alert that failed at its one job. Both say "right now" in the UI.
 *
 * MONEY IS GATED HERE, NOT IN THE UI
 * ----------------------------------
 * The overview is what a `manager` on the order desk opens all day, and revenue
 * is not theirs to read — the reports module sits at `admin` for exactly that
 * reason. So the takings, the profit and the courier cash are omitted from the
 * response for anyone below `admin` rather than sent and hidden with CSS,
 * because a field that reaches the browser has been disclosed no matter what is
 * drawn.
 */

const log = createLogger("overview");

/** How long a shipment may go unsynced before it counts as stuck. */
const PARCEL_STALE_HOURS = 24;

/** Sales velocity for the stockout forecast. Long enough to survive a quiet
 *  day, short enough to notice a product that just started selling. */
const VELOCITY_DAYS = 14;

/** How far back a delivered parcel's cash still counts as possibly unsettled. */
const PAYOUT_WINDOW_DAYS = 14;

/** Refusals before a phone number is worth a second look. */
const RETURN_RISK_MINIMUM = 2;

/** Above this span, hourly buckets stop being readable and stop being useful. */
const HOURLY_MAX_HOURS = 48;

/** A series point with the money removed unless the reader may see money. */
export type SalesSeriesPoint = Omit<SalesPoint, "placedValue" | "deliveredValue"> &
  Partial<Pick<SalesPoint, "placedValue" | "deliveredValue">>;

export interface RealisedProfit {
  net: number;
  marginPercent: number | null;
  /** False when some delivered lines have no cost recorded. */
  costsComplete: boolean;
  revenueWithUnknownCost: number;
}

export interface OverviewDto {
  range: { from: string; to: string; bucket: Bucket };

  /** Present only for `admin` and above. */
  money?: {
    current: DayMoney;
    previous: DayMoney;
    /** Null when nothing was delivered — an average needs a denominator. */
    averageOrderValue: number | null;
    /**
     * From the profit report, so this screen and that one cannot disagree.
     * Null when the report could not be produced.
     */
    profit: RealisedProfit | null;
    /** Empty when no parcel has ever been handed to a courier. */
    courierCash: CourierCashRow[];
  };

  /**
   * Order counts always; the taka only for `admin` and above.
   *
   * The gate has to reach in here too. Omitting the `money` block while sending
   * a per-hour revenue series would withhold the total from the order desk and
   * hand them the addends — the same disclosure, spelled differently.
   */
  series: SalesSeriesPoint[];
  sources: SourceCount[];
  funnel: CheckoutFunnel;
  returns: ReturnRate;
  couriers: CourierScoreRow[];
  callList: CallList;

  /** Right now, not over the range. */
  parcels: ParcelHealth;
  stock: StockForecastRow[];
  returnRisk: ReturnRiskRow[];
}

/**
 * The window before this one, of the same length.
 *
 * A percentage against "yesterday" is meaningless once the picker can say Last
 * 30 days, and a comparison against a fixed period would flatter or damn a
 * range purely by how long it is.
 */
function previousWindow(window: Window): Window {
  const span = window.to.getTime() - window.from.getTime();
  return { from: new Date(window.from.getTime() - span), to: window.from };
}

/**
 * Hour or day.
 *
 * A single day drawn in daily buckets is one bar, which tells a shop nothing
 * about whether the evening is where its orders come from. A month drawn hourly
 * is seven hundred points on a phone.
 */
function bucketFor(window: Window): Bucket {
  const hours = (window.to.getTime() - window.from.getTime()) / 3_600_000;
  return hours <= HOURLY_MAX_HOURS ? "hour" : "day";
}

/** The window as the shop-day strings the profit report is written in terms of. */
function shopDatesFor(window: Window): DateRange {
  /* `to` is exclusive and normally lands on the next midnight, so a millisecond
     back puts it on the last day the range actually covers. */
  return {
    from: shopDate(window.from),
    to: shopDate(new Date(window.to.getTime() - 1)),
  };
}

export async function summary(role: AdminRole, window: Window): Promise<OverviewDto> {
  const showMoney = ROLE_RANK[role] >= ROLE_RANK.admin;
  const bucket = bucketFor(window);

  const velocitySince = new Date(Date.now() - VELOCITY_DAYS * 86_400_000);
  const payoutSince = new Date(Date.now() - PAYOUT_WINDOW_DAYS * 86_400_000);
  const staleBefore = new Date(Date.now() - PARCEL_STALE_HOURS * 3_600_000);

  /* Every aggregate is independent, so they go together rather than in a
     waterfall — this is the first screen of the panel and it should not take a
     dozen round trips of database latency to draw. */
  const [
    money,
    profit,
    cash,
    series,
    sources,
    funnel,
    returns,
    couriers,
    calls,
    parcels,
    stock,
    risk,
  ] = await Promise.all([
    showMoney ? compareMoney(previousWindow(window), window) : Promise.resolve(null),
    showMoney ? realisedProfit(window) : Promise.resolve(null),
    showMoney ? courierCash(payoutSince) : Promise.resolve(null),
    salesSeries(window, bucket),
    sourceBreakdown(window),
    checkoutFunnel(window),
    returnRate(window),
    courierSuccess(window),
    callList(window),
    parcelHealth(staleBefore),
    stockForecast(velocitySince, VELOCITY_DAYS),
    returnRisk(RETURN_RISK_MINIMUM),
  ]);

  return {
    range: { from: window.from.toISOString(), to: window.to.toISOString(), bucket },
    ...(money
      ? {
          money: {
            current: money.current,
            previous: money.previous,
            /* Delivered, not placed. On cash on delivery an average built from
               orders that may still be refused is an average of promises. */
            averageOrderValue:
              money.current.deliveredOrders > 0
                ? Math.round(money.current.delivered / money.current.deliveredOrders)
                : null,
            profit,
            courierCash: cash ?? [],
          },
        }
      : {}),
    /* The gate reaches into the series too: withholding the revenue total
       while sending its hourly addends is the same disclosure, spelled out. */
    series: showMoney
      ? series
      : series.map(({ placedValue: _placed, deliveredValue: _delivered, ...counts }) => counts),
    sources,
    funnel,
    returns,
    couriers,
    callList: calls,
    parcels,
    stock,
    returnRisk: risk,
  };
}

/**
 * Net profit for the window, from the profit report itself.
 *
 * WHY THE WHOLE REPORT AND NOT A CHEAPER SUM
 * ------------------------------------------
 * Net profit is revenue less goods, courier, packaging, recorded boosts and a
 * share of shop-wide advertising. Every one of those has a rule — zone-based
 * courier costs, parcel costs split across the products inside by revenue,
 * uncosted lines left in the denominator — and re-deriving them here would
 * produce a second margin that agrees with the Profit page until the day
 * somebody changes one of the rules in one place. A dashboard and a report
 * disagreeing about profit is worse than a dashboard without profit on it.
 *
 * It costs more than the aggregates around it, which is why it runs only for
 * `admin` and above: the order desk opens this screen all day and never sees
 * this number, so it should not pay for it.
 *
 * A failure is swallowed to null rather than propagated. The report reads
 * settings and ad spend, and none of that should be able to take down the call
 * list and the stock alerts on the same screen.
 */
async function realisedProfit(window: Window): Promise<RealisedProfit | null> {
  try {
    const report = await profitReport(shopDatesFor(window));
    return {
      net: report.realised.netProfit,
      marginPercent: report.realised.marginPercent,
      costsComplete: report.coverage.complete,
      revenueWithUnknownCost: report.coverage.revenueWithUnknownCost,
    };
  } catch (error) {
    log.warn({ err: error }, "Overview could not produce the profit figure");
    return null;
  }
}
