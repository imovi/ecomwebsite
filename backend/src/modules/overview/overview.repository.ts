import { sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { abandonedCheckouts } from "../../db/schema/abandoned-checkouts.js";
import { courierShipments } from "../../db/schema/courier-shipments.js";
import { REPORT_UTC_OFFSET_MINUTES } from "../reports/profit.service.js";

/**
 * The dashboard's numbers, in as few table scans as it takes.
 *
 * WHY THIS IS ITS OWN MODULE AND NOT FIVE CLIENT FETCHES
 * -----------------------------------------------------
 * The overview screen already makes four requests on load. Adding money, order
 * sources, parcels and the call list as four more would make opening the admin
 * panel eight round trips over Bangladeshi mobile data, and each one wakes the
 * same 2-vCPU box. These are all small aggregates, so they are asked for
 * together.
 *
 * WHY EVERY QUERY HERE PUTS ITS WINDOW IN `WHERE`, NOT ONLY IN `FILTER`
 * --------------------------------------------------------------------
 * `count(*) filter (where ...)` is evaluated per row *after* the scan has
 * already fetched it — a FILTER clause never becomes the scan's access
 * predicate. So an aggregate whose only outer restriction is `deleted_at is
 * null` reads the whole live table however narrow the FILTERs look. Worse, the
 * indexes that would serve these windows are partial:
 *
 *   orders_delivered_at_idx  on (delivered_at desc)  where status = 'delivered'
 *   orders_returned_at_idx   on (returned_at desc)   where status = 'returned'
 *   courier_shipments_open_idx on (mapped_status, last_synced_at)
 *                              where mapped_status not in (…terminal…)
 *
 * A partial index is only usable when the query's own predicate implies the
 * index's. So each function below states its window in the outer `WHERE` — an
 * OR of the branches it needs, which Postgres can serve as a BitmapOr of those
 * partial indexes — and uses FILTER only to split the already-narrowed rows
 * into the buckets being reported.
 *
 * WHY THE DAY BOUNDARIES ARE COMPUTED IN JAVASCRIPT
 * ------------------------------------------------
 * The profit report dates rows with `(delivered_at at time zone 'Asia/Dhaka')
 * ::date`, and a predicate on an expression cannot use a btree index on the
 * bare column. Here the shop day is turned into a pair of UTC instants first,
 * so the comparison is against the column itself.
 */

/** A half-open UTC interval: `from` inclusive, `to` exclusive. */
export interface Window {
  from: Date;
  to: Date;
}

/** A shop day, as the half-open UTC interval it actually covers. */
export function shopDayBounds(dayOffset = 0): { from: Date; to: Date } {
  const offsetMs = REPORT_UTC_OFFSET_MINUTES * 60_000;
  /* Midnight in Dhaka for the requested day, expressed in UTC. */
  const shiftedNow = new Date(Date.now() + offsetMs);
  const midnightShifted = Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate() + dayOffset,
  );

  return {
    from: new Date(midnightShifted - offsetMs),
    to: new Date(midnightShifted - offsetMs + 86_400_000),
  };
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface DayMoney {
  /** Taka from orders DELIVERED in the window — the profit report's definition. */
  delivered: number;
  deliveredOrders: number;
  /** Orders PLACED in the window, whatever became of them. */
  placedOrders: number;
  placedValue: number;
}

/**
 * Money for a window and the window before it, in one pass.
 *
 * Delivered and placed are counted separately and never added together, because
 * on cash on delivery they answer different questions: what came in, and what
 * was promised. A dashboard showing only one of them tells half the story —
 * placed alone flatters, delivered alone hides a busy day whose parcels are
 * still out.
 *
 * Both days come from a single query rather than two calls. The two windows are
 * contiguous, so together they are one range per column, and asking twice would
 * mean reading the same rows twice on a box with two cores.
 */
export async function compareMoney(
  previous: Window,
  current: Window,
  executor: DatabaseExecutor = getDb(),
): Promise<{ current: DayMoney; previous: DayMoney }> {
  const from = previous.from;
  const to = current.to;

  const rows = await executor.execute(sql`
    select
      coalesce(sum(${orders.grandTotal}) filter (
        where ${orders.status} = 'delivered'
          and ${orders.deliveredAt} >= ${current.from} and ${orders.deliveredAt} < ${current.to}
      ), 0)::bigint as current_delivered,
      count(*) filter (
        where ${orders.status} = 'delivered'
          and ${orders.deliveredAt} >= ${current.from} and ${orders.deliveredAt} < ${current.to}
      )::int as current_delivered_orders,
      count(*) filter (
        where ${orders.createdAt} >= ${current.from} and ${orders.createdAt} < ${current.to}
      )::int as current_placed_orders,
      coalesce(sum(${orders.grandTotal}) filter (
        where ${orders.createdAt} >= ${current.from} and ${orders.createdAt} < ${current.to}
      ), 0)::bigint as current_placed_value,

      coalesce(sum(${orders.grandTotal}) filter (
        where ${orders.status} = 'delivered'
          and ${orders.deliveredAt} >= ${previous.from} and ${orders.deliveredAt} < ${previous.to}
      ), 0)::bigint as previous_delivered,
      count(*) filter (
        where ${orders.status} = 'delivered'
          and ${orders.deliveredAt} >= ${previous.from} and ${orders.deliveredAt} < ${previous.to}
      )::int as previous_delivered_orders,
      count(*) filter (
        where ${orders.createdAt} >= ${previous.from} and ${orders.createdAt} < ${previous.to}
      )::int as previous_placed_orders,
      coalesce(sum(${orders.grandTotal}) filter (
        where ${orders.createdAt} >= ${previous.from} and ${orders.createdAt} < ${previous.to}
      ), 0)::bigint as previous_placed_value
    from ${orders}
    where ${orders.deletedAt} is null
      and (
        (${orders.createdAt} >= ${from} and ${orders.createdAt} < ${to})
        or (
          ${orders.status} = 'delivered'
          and ${orders.deliveredAt} >= ${from} and ${orders.deliveredAt} < ${to}
        )
      )
  `);

  const row = rows.rows[0] ?? {};
  return {
    current: {
      delivered: num(row.current_delivered),
      deliveredOrders: num(row.current_delivered_orders),
      placedOrders: num(row.current_placed_orders),
      placedValue: num(row.current_placed_value),
    },
    previous: {
      delivered: num(row.previous_delivered),
      deliveredOrders: num(row.previous_delivered_orders),
      placedOrders: num(row.previous_placed_orders),
      placedValue: num(row.previous_placed_value),
    },
  };
}

export interface SourceCount {
  /** Null means the customer checked out on the website themselves. */
  source: string | null;
  orders: number;
}

/**
 * Where orders came from, over a window.
 *
 * The `source` column was added for hand-typed orders and nothing displayed it
 * until now. NULL is kept as its own bucket rather than folded into "other",
 * because "the customer checked out unaided" is the answer the shop most wants
 * to compare the messaging channels against.
 *
 * The tiebreaker on `source` is not decoration: without it two channels on the
 * same count can swap places between one page load and the next, which reads as
 * unreliable data even though both numbers are right.
 */
export async function sourceBreakdown(
  window: Window,
  executor: DatabaseExecutor = getDb(),
): Promise<SourceCount[]> {
  const rows = await executor.execute(sql`
    select ${orders.source} as source, count(*)::int as orders
    from ${orders}
    where ${orders.deletedAt} is null
      and ${orders.createdAt} >= ${window.from} and ${orders.createdAt} < ${window.to}
    group by ${orders.source}
    order by count(*) desc, ${orders.source} asc nulls last
  `);

  return rows.rows.map((row) => ({
    source: typeof row.source === "string" ? row.source : null,
    orders: num(row.orders),
  }));
}

export interface ParcelHealth {
  /** Handed over and not yet settled. Money in transit. */
  inTransit: number;
  /**
   * In transit AND either failing to sync or long unsynced.
   *
   * One count over the union, not the sum of two counts: a parcel whose sync
   * errored is usually also the parcel that has not been synced since, so
   * adding the two would double-count it and could report more parcels needing
   * attention than exist. This is a subset of `inTransit` by construction.
   */
  needsAttention: number;
  /** Of those, the ones whose last sync attempt returned an error. */
  failing: number;
}

/**
 * Parcels worth worrying about.
 *
 * On a cash-on-delivery shop the money is inside the parcel, so a shipment that
 * stopped moving is revenue that has stopped arriving. `last_error` and a stale
 * `last_synced_at` are the two ways that happens without anybody being told.
 *
 * All three counts are about parcels still out, so "still out" is the outer
 * `WHERE` rather than a repeated FILTER — which is also what lets
 * `courier_shipments_open_idx` serve this, since the predicate is now word for
 * word that index's own.
 *
 * Settled parcels are excluded from the problem counts by the same clause: an
 * error left on a shipment that has since been delivered is history, not work.
 */
export async function parcelHealth(
  staleBefore: Date,
  executor: DatabaseExecutor = getDb(),
): Promise<ParcelHealth> {
  const rows = await executor.execute(sql`
    select
      count(*)::int as in_transit,
      count(*) filter (
        where ${courierShipments.lastError} <> ''
          or ${courierShipments.lastSyncedAt} is null
          or ${courierShipments.lastSyncedAt} < ${staleBefore}
      )::int as needs_attention,
      count(*) filter (where ${courierShipments.lastError} <> '')::int as failing
    from ${courierShipments}
    where ${courierShipments.mappedStatus} not in ('delivered', 'returned', 'cancelled')
  `);

  const row = rows.rows[0] ?? {};
  return {
    inTransit: num(row.in_transit),
    needsAttention: num(row.needs_attention),
    failing: num(row.failing),
  };
}

export interface CallList {
  abandonedOpen: number;
  /**
   * Goods left in those baskets.
   *
   * Goods only, because nobody chose a delivery area — adding a guessed
   * delivery charge would inflate a figure the shop is about to act on. It is
   * what is recoverable by picking up the phone, not a receipt.
   */
  abandonedValue: number;
}

/**
 * Customers waiting to be rung, and what they left behind.
 *
 * Dated by `last_seen_at` rather than by when the row was first written: a
 * customer who came back to the checkout this afternoon is this afternoon's
 * call, whatever week they first appeared. That is also the column the list
 * sorts by, so the banner and the list agree about which leads are in scope.
 */
export async function callList(
  window: Window,
  executor: DatabaseExecutor = getDb(),
): Promise<CallList> {
  const rows = await executor.execute(sql`
    select
      count(*)::int as open,
      coalesce(sum(${abandonedCheckouts.estimatedValue}), 0)::bigint as value
    from ${abandonedCheckouts}
    where ${abandonedCheckouts.status} = 'open'
      and ${abandonedCheckouts.recoveredOrderId} is null
      and ${abandonedCheckouts.lastSeenAt} >= ${window.from}
      and ${abandonedCheckouts.lastSeenAt} < ${window.to}
  `);

  const row = rows.rows[0] ?? {};
  return { abandonedOpen: num(row.open), abandonedValue: num(row.value) };
}

export interface ReturnRate {
  returned: number;
  /** Delivered plus returned — orders that have actually finished. */
  settled: number;
}

/**
 * How many finished orders came back, over a window.
 *
 * Dated by when they SETTLED rather than when they were placed: a return is a
 * cost incurred the day the parcel comes back, and an order placed three weeks
 * ago that returns today belongs to today's problem.
 *
 * `status` is single-valued, so the two branches are mutually exclusive and a
 * returned order is never also counted as delivered.
 */
export async function returnRate(
  window: Window,
  executor: DatabaseExecutor = getDb(),
): Promise<ReturnRate> {
  const rows = await executor.execute(sql`
    select
      count(*) filter (where ${orders.status} = 'returned')::int as returned,
      count(*)::int as settled
    from ${orders}
    where ${orders.deletedAt} is null
      and (
        (
          ${orders.status} = 'returned'
          and ${orders.returnedAt} >= ${window.from} and ${orders.returnedAt} < ${window.to}
        )
        or (
          ${orders.status} = 'delivered'
          and ${orders.deliveredAt} >= ${window.from} and ${orders.deliveredAt} < ${window.to}
        )
      )
  `);

  const row = rows.rows[0] ?? {};
  return { returned: num(row.returned), settled: num(row.settled) };
}
