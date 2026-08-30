import { sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { orderItems } from "../../db/schema/order-items.js";
import { products } from "../../db/schema/products.js";
import { abandonedCheckouts } from "../../db/schema/abandoned-checkouts.js";
import { courierShipments } from "../../db/schema/courier-shipments.js";
import { REPORT_UTC_OFFSET_MINUTES } from "../reports/profit.service.js";
import type { Window } from "./overview.repository.js";

/**
 * The operational half of the dashboard.
 *
 * Split from `overview.repository.ts` on a real seam rather than on file size:
 * that file answers "how did the shop do", these answer "what is about to go
 * wrong" — cash that has not arrived, a courier that loses parcels, a product
 * about to sell out, a customer who sends everything back. They are read
 * together and they change together, so they live together.
 *
 * EVERY WINDOW PREDICATE IS ON A BARE COLUMN
 * ------------------------------------------
 * Same rule as the sibling file, and for the same reason: `(delivered_at at
 * time zone 'Asia/Dhaka')::date between …` cannot use the index on
 * `delivered_at`, so a range that reads as a month scans the table. The shop
 * day is turned into a pair of UTC instants by the caller and compared against
 * the raw column here. The Dhaka offset appears below only inside `date_trunc`,
 * where it decides which bucket a row is drawn in — never in a `WHERE`.
 */

/** Dhaka is UTC+6 with no daylight saving, so a fixed shift is exact. */
const DHAKA_SHIFT = sql.raw(`interval '${REPORT_UTC_OFFSET_MINUTES} minutes'`);

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------------- */
/* The sales trend                                                            */
/* -------------------------------------------------------------------------- */

export type Bucket = "hour" | "day";

export interface SalesPoint {
  /**
   * Start of the bucket, as Dhaka wall-clock in ISO form and WITHOUT a zone
   * suffix — `2026-08-30T14:00:00`.
   *
   * Deliberately not an instant. The browser drawing this chart may be in any
   * timezone, and `new Date()` on a zoned string would redraw a shop's evening
   * as somebody else's afternoon. The bucket a row was counted into was decided
   * here, in Dhaka time, and the label has to say the same thing.
   */
  at: string;
  placedValue: number;
  placedOrders: number;
  deliveredValue: number;
  deliveredOrders: number;
}

/**
 * Money and orders over time, in one pass.
 *
 * Placed and delivered are dated by different columns, so one order can belong
 * to two different buckets — placed on Monday, delivered on Wednesday. That is
 * not a defect to be smoothed over: it is the shape of cash on delivery, and a
 * chart that folded them together would draw revenue arriving on the day it was
 * merely promised.
 *
 * So the two are unioned as separate points and summed per bucket. Rows with no
 * activity are absent rather than zero; the caller fills the gaps, because only
 * the caller knows how wide the axis should be.
 */
export async function salesSeries(
  window: Window,
  bucket: Bucket,
  executor: DatabaseExecutor = getDb(),
): Promise<SalesPoint[]> {
  /* Whitelisted above by the `Bucket` type — never interpolated from input. */
  const unit = sql.raw(`'${bucket}'`);

  const rows = await executor.execute(sql`
    with points as (
      select
        date_trunc(${unit}, ${orders.createdAt} + ${DHAKA_SHIFT}) as bucket,
        ${orders.grandTotal} as placed_value,
        1 as placed_orders,
        0 as delivered_value,
        0 as delivered_orders
      from ${orders}
      where ${orders.deletedAt} is null
        and ${orders.createdAt} >= ${window.from} and ${orders.createdAt} < ${window.to}

      union all

      select
        date_trunc(${unit}, ${orders.deliveredAt} + ${DHAKA_SHIFT}) as bucket,
        0, 0,
        ${orders.grandTotal} as delivered_value,
        1 as delivered_orders
      from ${orders}
      where ${orders.deletedAt} is null
        and ${orders.status} = 'delivered'
        and ${orders.deliveredAt} >= ${window.from} and ${orders.deliveredAt} < ${window.to}
    )
    select
      to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') as at,
      sum(placed_value)::bigint as placed_value,
      sum(placed_orders)::int as placed_orders,
      sum(delivered_value)::bigint as delivered_value,
      sum(delivered_orders)::int as delivered_orders
    from points
    group by bucket
    order by bucket
  `);

  return rows.rows.map((row) => ({
    at: text(row.at),
    placedValue: num(row.placed_value),
    placedOrders: num(row.placed_orders),
    deliveredValue: num(row.delivered_value),
    deliveredOrders: num(row.delivered_orders),
  }));
}

/* -------------------------------------------------------------------------- */
/* Cash sitting with the couriers                                             */
/* -------------------------------------------------------------------------- */

export interface CourierCashRow {
  provider: string;
  /** COD on parcels handed over and not yet settled — not collected yet. */
  inParcels: number;
  parcelsOut: number;
  /** COD on parcels delivered recently. Collected from the customer; whether
   *  it has reached the bank is not something this system is told. */
  recentlyCollected: number;
  parcelsDelivered: number;
}

/**
 * What the couriers are holding.
 *
 * WHAT THIS CANNOT TELL YOU, AND WHY
 * ----------------------------------
 * Neither courier reports settlements to us, and nothing in this system records
 * a payout landing in the shop's bank. So "delivered money that has not been
 * disbursed" is genuinely unknowable here, and inventing it — by assuming a
 * weekly cycle, say — would put a precise-looking number on a guess that the
 * shop would then reconcile its accounts against.
 *
 * What IS known is written down on each parcel: `cod_amount`, the sum the
 * courier undertook to collect. So this reports two facts and labels them as
 * facts:
 *
 *   - `inParcels` — parcels still out. This money has not been collected from
 *     anybody yet. Certain.
 *   - `recentlyCollected` — parcels delivered inside the payout window. The
 *     courier has this cash. Some of it may already have been disbursed; the
 *     window is a bound on the question, not an answer to it.
 *
 * A `payouts` table with dated receipts is what would close the gap, and it
 * needs the shop to enter what actually arrived.
 */
export async function courierCash(
  collectedSince: Date,
  executor: DatabaseExecutor = getDb(),
): Promise<CourierCashRow[]> {
  const rows = await executor.execute(sql`
    select
      ${courierShipments.provider} as provider,
      coalesce(sum(${courierShipments.codAmount}) filter (
        where ${courierShipments.mappedStatus} not in ('delivered', 'returned', 'cancelled')
      ), 0)::bigint as in_parcels,
      count(*) filter (
        where ${courierShipments.mappedStatus} not in ('delivered', 'returned', 'cancelled')
      )::int as parcels_out,
      coalesce(sum(${courierShipments.codAmount}) filter (
        where ${courierShipments.mappedStatus} = 'delivered'
      ), 0)::bigint as recently_collected,
      count(*) filter (where ${courierShipments.mappedStatus} = 'delivered')::int as parcels_delivered
    from ${courierShipments}
    where ${courierShipments.mappedStatus} not in ('returned', 'cancelled')
      and (
        ${courierShipments.mappedStatus} <> 'delivered'
        or ${courierShipments.updatedAt} >= ${collectedSince}
      )
    group by ${courierShipments.provider}
    order by ${courierShipments.provider}
  `);

  return rows.rows.map((row) => ({
    provider: text(row.provider),
    inParcels: num(row.in_parcels),
    parcelsOut: num(row.parcels_out),
    recentlyCollected: num(row.recently_collected),
    parcelsDelivered: num(row.parcels_delivered),
  }));
}

/* -------------------------------------------------------------------------- */
/* Which courier actually delivers                                            */
/* -------------------------------------------------------------------------- */

export interface CourierScoreRow {
  provider: string;
  delivered: number;
  returned: number;
  /** Delivered plus returned — parcels that actually finished. */
  settled: number;
  /** Median-free: total hours from handover to settlement, over `settled`. */
  averageDays: number | null;
}

/**
 * Delivered versus returned, per courier.
 *
 * Dated from the ORDER rather than from the shipment row. `courier_shipments`
 * has no settled-at column — only `updated_at`, which also moves when a sync
 * merely re-reads an unchanged parcel. The order carries `delivered_at` and
 * `returned_at`, which are set once, when the thing actually happened, and are
 * the same two columns the profit report and the return rate are dated by. One
 * clock for all of them, or three screens disagree about the same week.
 */
export async function courierSuccess(
  window: Window,
  executor: DatabaseExecutor = getDb(),
): Promise<CourierScoreRow[]> {
  const rows = await executor.execute(sql`
    select
      ${courierShipments.provider} as provider,
      count(*) filter (where ${orders.status} = 'delivered')::int as delivered,
      count(*) filter (where ${orders.status} = 'returned')::int as returned,
      count(*)::int as settled,
      avg(
        extract(epoch from (
          coalesce(${orders.deliveredAt}, ${orders.returnedAt}) - ${courierShipments.createdAt}
        )) / 86400.0
      ) as average_days
    from ${courierShipments}
    join ${orders} on ${orders.id} = ${courierShipments.orderId}
    where ${orders.deletedAt} is null
      and (
        (
          ${orders.status} = 'delivered'
          and ${orders.deliveredAt} >= ${window.from} and ${orders.deliveredAt} < ${window.to}
        )
        or (
          ${orders.status} = 'returned'
          and ${orders.returnedAt} >= ${window.from} and ${orders.returnedAt} < ${window.to}
        )
      )
    group by ${courierShipments.provider}
    order by count(*) desc, ${courierShipments.provider}
  `);

  return rows.rows.map((row) => {
    const days = row.average_days === null ? null : num(row.average_days);
    return {
      provider: text(row.provider),
      delivered: num(row.delivered),
      returned: num(row.returned),
      settled: num(row.settled),
      averageDays: days === null ? null : Math.round(days * 10) / 10,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* The checkout funnel                                                        */
/* -------------------------------------------------------------------------- */

export interface CheckoutFunnel {
  /** Shoppers who typed a name and a working phone into the checkout. */
  started: number;
  /** Of those, the ones who pressed Place Order. */
  completed: number;
}

/**
 * How many checkouts turned into orders.
 *
 * THIS IS NOT "CONVERSION RATE" AND MUST NOT BE LABELLED AS ONE
 * -------------------------------------------------------------
 * The rate a shop usually means — visitors who buy — needs a count of
 * visitors, and nothing in this system counts them. There are no sessions, no
 * page-view rows, no bot filtering. The Meta pixel and GTM know, and they are
 * where that number honestly comes from.
 *
 * What is countable here is narrower and, for a cash-on-delivery shop, more
 * actionable: of the people who got as far as handing over a name and a working
 * number, how many finished. Everything below that line is an advertising
 * question; everything above it is a checkout question, and this separates the
 * two.
 *
 * The denominator comes from the same event the recovery list is built on — an
 * incomplete checkout is written the moment the form holds a valid name and
 * phone. Orders with a `source` are excluded on both sides: an order the desk
 * typed from a WhatsApp conversation never passed through the checkout, and
 * counting it as a completion would report a rate above what the checkout
 * actually did.
 */
export async function checkoutFunnel(
  window: Window,
  executor: DatabaseExecutor = getDb(),
): Promise<CheckoutFunnel> {
  const rows = await executor.execute(sql`
    select
      (
        select count(*)::int from ${orders}
        where ${orders.deletedAt} is null
          and ${orders.source} is null
          and ${orders.createdAt} >= ${window.from} and ${orders.createdAt} < ${window.to}
      ) as completed,
      (
        select count(*)::int from ${abandonedCheckouts}
        where ${abandonedCheckouts.createdAt} >= ${window.from}
          and ${abandonedCheckouts.createdAt} < ${window.to}
      ) as leads,
      (
        select count(*)::int from ${orders}
        where ${orders.deletedAt} is null
          and ${orders.source} is null
          and ${orders.createdAt} >= ${window.from} and ${orders.createdAt} < ${window.to}
          and not exists (
            select 1 from ${abandonedCheckouts}
            where ${abandonedCheckouts.phone} = ${orders.phone}
              and ${abandonedCheckouts.createdAt} >= ${window.from}
              and ${abandonedCheckouts.createdAt} < ${window.to}
          )
      ) as orders_without_lead
  `);

  const row = rows.rows[0] ?? {};

  /*
   * A lead row is written before the order and closed by it, so in the ordinary
   * case every completed checkout already has one and the leads alone are the
   * people who started. `orders_without_lead` picks up the exceptions rather
   * than papering over them: a shopper who filled the form and pressed Place
   * Order before the debounced save fired, or one whose lead was written just
   * before midnight on a window boundary. Adding the two unconditionally would
   * double-count the ordinary case and halve every rate on the screen; taking
   * the larger of the two would silently swallow a real abandoned checkout
   * whenever orders outnumbered leads.
   */
  return {
    started: num(row.leads) + num(row.orders_without_lead),
    completed: num(row.completed),
  };
}

/* -------------------------------------------------------------------------- */
/* Stock about to run out                                                     */
/* -------------------------------------------------------------------------- */

export interface StockForecastRow {
  productId: string;
  name: string;
  stockQuantity: number;
  lowStockThreshold: number;
  /** Units sold across the velocity window. */
  soldRecently: number;
  /**
   * Whole days of stock left at the recent rate. Null when nothing sold — no
   * rate, therefore no forecast. Not "infinity", and certainly not a big number.
   */
  daysLeft: number | null;
}

/**
 * What is running out, and roughly when.
 *
 * A count of what is left is a fact the products screen already gives. The
 * useful thing on a dashboard is the rate it is leaving at: four units is a
 * fortnight for one product and this afternoon for another, and only the second
 * one is worth interrupting somebody about.
 *
 * Cancelled and returned orders are excluded from the rate. Stock that came
 * back is stock the shop still has, and counting it as demand would forecast a
 * stockout that the return has already prevented.
 *
 * Only active products. A draft cannot be bought, so it cannot run out.
 */
export async function stockForecast(
  velocitySince: Date,
  velocityDays: number,
  executor: DatabaseExecutor = getDb(),
): Promise<StockForecastRow[]> {
  const rows = await executor.execute(sql`
    select
      ${products.id} as product_id,
      ${products.name} as name,
      ${products.stockQuantity} as stock_quantity,
      ${products.lowStockThreshold} as low_stock_threshold,
      coalesce(sum(${orderItems.quantity}), 0)::int as sold_recently
    from ${products}
    left join ${orderItems} on ${orderItems.productId} = ${products.id}
    left join ${orders} on ${orders.id} = ${orderItems.orderId}
      and ${orders.deletedAt} is null
      and ${orders.status} not in ('cancelled', 'returned')
      and ${orders.createdAt} >= ${velocitySince}
    where ${products.status} = 'active'
      and ${products.stockQuantity} <= ${products.lowStockThreshold}
    group by ${products.id}, ${products.name}, ${products.stockQuantity},
             ${products.lowStockThreshold}
    order by ${products.stockQuantity} asc, ${products.name} asc
    limit 8
  `);

  return rows.rows.map((row) => {
    const stock = num(row.stock_quantity);
    const sold = num(row.sold_recently);
    /* `orders` is left-joined, so a product that sold nothing yields one row
       with NULL quantities and a zero sum — no rate, and no forecast. */
    const perDay = sold / velocityDays;

    return {
      productId: text(row.product_id),
      name: text(row.name),
      stockQuantity: stock,
      lowStockThreshold: num(row.low_stock_threshold),
      soldRecently: sold,
      daysLeft: perDay > 0 ? Math.floor(stock / perDay) : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Customers who send parcels back                                            */
/* -------------------------------------------------------------------------- */

export interface ReturnRiskRow {
  phone: string;
  name: string;
  returned: number;
  /** Delivered plus returned — orders of theirs that finished. */
  settled: number;
}

/**
 * Numbers that have refused delivery more than once.
 *
 * FROM THIS SHOP'S OWN ORDERS, NOT FROM THE COURIERS
 * --------------------------------------------------
 * The fraud module asks the couriers what a number's nationwide record looks
 * like, which is the better question — and it needs five courier logins the
 * shop may not have entered. This needs nothing. It is what already happened
 * here, and on cash on delivery a customer who has sent two parcels back at
 * this shop's expense is worth a phone call before the third goes out.
 *
 * Two returns rather than one: a single refusal is as likely to be a courier
 * calling once at lunchtime as a customer who never meant to pay. Two is a
 * pattern.
 *
 * Deleted orders are excluded — a record that was erased should not follow a
 * customer around — and the name is the most recent one they gave.
 */
export async function returnRisk(
  minimumReturns: number,
  executor: DatabaseExecutor = getDb(),
): Promise<ReturnRiskRow[]> {
  const rows = await executor.execute(sql`
    select
      ${orders.phone} as phone,
      (array_agg(${orders.customerName} order by ${orders.createdAt} desc))[1] as name,
      count(*) filter (where ${orders.status} = 'returned')::int as returned,
      count(*) filter (where ${orders.status} in ('delivered', 'returned'))::int as settled
    from ${orders}
    where ${orders.deletedAt} is null
    group by ${orders.phone}
    having count(*) filter (where ${orders.status} = 'returned') >= ${minimumReturns}
    order by count(*) filter (where ${orders.status} = 'returned') desc, ${orders.phone}
    limit 5
  `);

  return rows.rows.map((row) => ({
    phone: text(row.phone),
    name: text(row.name),
    returned: num(row.returned),
    settled: num(row.settled),
  }));
}
