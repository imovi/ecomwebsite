import { and, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";

/**
 * Customers, derived from orders.
 *
 * THERE IS NO CUSTOMERS TABLE, AND THAT IS DELIBERATE
 * ---------------------------------------------------
 * `orders.ts` says it in the schema itself: the phone number is the identity.
 * A cash-on-delivery shop never asks anyone to register, so there is no moment
 * at which a customer record could be created — a customer is simply somebody
 * who has ordered, and everything known about them was typed into a checkout.
 *
 * So this module aggregates. One row per phone number, folded from that phone's
 * orders. The upside is that it can never disagree with the orders it came
 * from; the cost is a GROUP BY per read, which at this shop's size is nothing
 * and is index-backed by `orders_phone_idx`.
 *
 * MONEY IS COUNTED THE WAY THE PROFIT REPORT COUNTS IT
 * ----------------------------------------------------
 * `spent` sums DELIVERED orders only. On a COD shop a placed order is not
 * money — it is an intention, and a meaningful share of them come back. The
 * profit module already draws that line at `status = 'delivered'`, and a
 * customer list that drew it anywhere else would disagree with the one screen
 * the owner trusts about income.
 *
 * Returns and cancellations are counted separately and shown, because on COD
 * they are the single most useful thing to know about a repeat customer.
 */

export interface CustomerRow {
  phone: string;
  /** The name from their most recent order — people retype it inconsistently. */
  name: string;
  /** Most recent address, area and zone. Older ones live in the order history. */
  address: string;
  areaText: string;
  deliveryZone: string;
  orderCount: number;
  deliveredCount: number;
  returnedCount: number;
  cancelledCount: number;
  /** Realised: delivered orders only, in whole taka. */
  spent: number;
  /** Sum of every order ever placed, delivered or not. */
  placedValue: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  totalCount: number;
}

export type CustomerSort =
  | "recent"
  | "oldest"
  | "spent"
  | "orders"
  | "returns"
  | "name";

export interface ListCustomersOptions {
  search?: string;
  /** Only customers with more than one order. */
  repeatOnly?: boolean;
  /** Only customers who have ever had an order returned. */
  withReturnsOnly?: boolean;
  sort: CustomerSort;
  page: number;
  perPage: number;
}

/* Soft-deleted orders are in the trash, and the trash is not history. */
const liveOrders = isNull(orders.deletedAt);

/* -------------------------------------------------------------------------- */
/* Narrowing a raw result row                                                 */
/* -------------------------------------------------------------------------- */
/* This query is hand-written SQL, so its columns arrive as `unknown` and have
   to be narrowed rather than cast. `String(value)` would compile and would turn
   an unexpected object into the literal "[object Object]" in a customer's name —
   which is the kind of thing that reaches a delivery label before anyone
   notices. Each helper answers with a sane empty value instead. */

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(typeof value === "string" ? value : "");
  /* An unparseable timestamp is a bug upstream, not a reason to hand the API an
     Invalid Date that serialises to null and breaks the column silently. */
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function buildHaving(options: ListCustomersOptions): SQL | undefined {
  const clauses: SQL[] = [];
  if (options.repeatOnly) clauses.push(sql`count(*) > 1`);
  if (options.withReturnsOnly) {
    clauses.push(sql`count(*) filter (where ${orders.status} = 'returned') > 0`);
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

function buildWhere(options: ListCustomersOptions): SQL | undefined {
  if (!options.search) return liveOrders;

  const term = options.search.trim();
  /* Digits are how anyone actually looks a customer up — the phone is the key,
     and an operator with a call on the line types the number, not a name.

     The name branch is a fallback and it is genuinely expensive: `%term%` has a
     leading wildcard, so no btree index can serve it and every order is scanned
     and grouped. That is affordable at this shop's size and is why the schema
     asks for two characters minimum. If the orders table grows into six figures,
     the fix is a trigram (GIN) index on `customer_name`, not a narrower LIKE. */
  const digits = term.replace(/\D/g, "");
  const like = `%${term.replace(/[%_\\]/g, "\\$&")}%`;

  const match =
    digits.length >= 3
      ? sql`(${orders.phone} LIKE ${`%${digits}%`} or ${orders.customerName} ILIKE ${like})`
      : sql`${orders.customerName} ILIKE ${like}`;

  return and(liveOrders, match)!;
}

function orderBy(sort: CustomerSort): SQL {
  switch (sort) {
    case "oldest":
      return sql`min(${orders.createdAt}) asc`;
    case "spent":
      return sql`spent desc`;
    case "orders":
      return sql`order_count desc`;
    case "returns":
      return sql`returned_count desc`;
    case "name":
      return sql`lower(max(${orders.customerName})) asc`;
    case "recent":
    default:
      return sql`last_order_at desc`;
  }
}

/**
 * One page of customers.
 *
 * `count(*) over()` returns the total in the same pass, as the product listing
 * does — a separate COUNT would have to repeat the whole GROUP BY.
 *
 * The name and address come from the LATEST order rather than the first, via
 * `distinct on`-style ordering inside the aggregate: people retype their name
 * and move house, and the most recent thing they told us is the one worth
 * calling and delivering to.
 */
export async function listCustomers(
  options: ListCustomersOptions,
  executor: DatabaseExecutor = getDb(),
): Promise<CustomerRow[]> {
  const offset = (options.page - 1) * options.perPage;
  const where = buildWhere(options);
  const having = buildHaving(options);

  const rows = await executor.execute(sql`
    select
      ${orders.phone} as phone,
      (array_agg(${orders.customerName} order by ${orders.createdAt} desc))[1] as name,
      (array_agg(${orders.address} order by ${orders.createdAt} desc))[1] as address,
      (array_agg(${orders.areaText} order by ${orders.createdAt} desc))[1] as area_text,
      (array_agg(${orders.deliveryZone} order by ${orders.createdAt} desc))[1] as delivery_zone,
      count(*)::int as order_count,
      count(*) filter (where ${orders.status} = 'delivered')::int as delivered_count,
      count(*) filter (where ${orders.status} = 'returned')::int as returned_count,
      count(*) filter (where ${orders.status} = 'cancelled')::int as cancelled_count,
      coalesce(sum(${orders.grandTotal}) filter (where ${orders.status} = 'delivered'), 0)::int as spent,
      coalesce(sum(${orders.grandTotal}), 0)::int as placed_value,
      min(${orders.createdAt}) as first_order_at,
      max(${orders.createdAt}) as last_order_at,
      count(*) over()::int as total_count
    from ${orders}
    ${where ? sql`where ${where}` : sql``}
    group by ${orders.phone}
    ${having ? sql`having ${having}` : sql``}
    order by ${orderBy(options.sort)}, ${orders.phone} asc
    limit ${options.perPage} offset ${offset}
  `);

  return rows.rows.map((row) => ({
    phone: text(row.phone),
    name: text(row.name),
    address: text(row.address),
    areaText: text(row.area_text),
    deliveryZone: text(row.delivery_zone),
    orderCount: num(row.order_count),
    deliveredCount: num(row.delivered_count),
    returnedCount: num(row.returned_count),
    cancelledCount: num(row.cancelled_count),
    spent: num(row.spent),
    placedValue: num(row.placed_value),
    firstOrderAt: date(row.first_order_at),
    lastOrderAt: date(row.last_order_at),
    totalCount: num(row.total_count),
  }));
}

/**
 * Every customer matching the filter, for an export.
 *
 * Separate from `listCustomers` because an export must not be a page. A CSV
 * built from whatever the table happened to be showing is the kind of file that
 * gets opened once, trusted, and quietly acted on — and the fact that it stopped
 * at row 20 is invisible in Excel.
 *
 * Bounded anyway: `EXPORT_MAX` is a ceiling, not a page, and the caller is told
 * when it was reached rather than being handed a silent truncation.
 */
export const EXPORT_MAX = 10_000;

/**
 * How many customers match, asked separately.
 *
 * `count(*) over()` rides along on every returned row, which is free — and
 * unreadable when there are no rows. A page past the end returns nothing, so the
 * window count has nowhere to live and the caller cannot tell "no matches at
 * all" from "matches, but not on this page". The first is a real empty state;
 * the second is a stuck screen with the pager hidden and no way back.
 *
 * So this runs only in that case: rows empty and a page above the first. On the
 * ordinary path it never runs.
 */
export async function countCustomers(
  options: Omit<ListCustomersOptions, "page" | "perPage">,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const where = buildWhere({ ...options, page: 1, perPage: 1 });
  const having = buildHaving({ ...options, page: 1, perPage: 1 });

  const rows = await executor.execute(sql`
    select count(*)::int as total from (
      select 1
      from ${orders}
      ${where ? sql`where ${where}` : sql``}
      group by ${orders.phone}
      ${having ? sql`having ${having}` : sql``}
    ) as matched
  `);

  return num(rows.rows[0]?.total);
}

export async function listCustomersForExport(
  options: Omit<ListCustomersOptions, "page" | "perPage">,
  executor: DatabaseExecutor = getDb(),
): Promise<CustomerRow[]> {
  return listCustomers({ ...options, page: 1, perPage: EXPORT_MAX }, executor);
}
