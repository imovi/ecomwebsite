import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { orders, type NewOrderRow, type OrderRow } from "../../db/schema/orders.js";
import { orderItems, type NewOrderItemRow, type OrderItemRow } from "../../db/schema/order-items.js";
import type { OrderEventRow } from "../../db/schema/order-events.js";
import type { DeliveryZone, OrderStatus, PaymentMethod } from "../../db/schema/order-enums.js";

/**
 * Order data access.
 *
 * The admin list is the hot query here — staff keep it open all day and filter
 * it constantly — so it is one statement returning rows and the pagination
 * total together via `count(*) over()`, with every filter served by an index.
 */

/* -------------------------------------------------------------------------- */
/* Order numbers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Allocates the next order number from the Postgres sequence.
 *
 * `nextval` is atomic and lock-free. Computing `max(order_number) + 1` would
 * race two concurrent checkouts into the same number, and the unique index
 * would then fail one of them at random.
 */
export async function nextOrderNumber(executor: DatabaseExecutor = getDb()): Promise<string> {
  const result = await executor.execute<{ order_number: string }>(
    sql`select 'GNG-' || nextval('order_number_seq') as order_number`,
  );

  const value = result.rows[0]?.order_number;
  if (!value) throw new Error("Failed to allocate an order number");
  return value;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function insertOrder(
  input: NewOrderRow,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow> {
  const rows = await executor.insert(orders).values(input).returning();
  const created = rows[0];
  if (!created) throw new Error("Insert into orders returned no row");
  return created;
}

export async function insertOrderItems(
  input: NewOrderItemRow[],
  executor: DatabaseExecutor = getDb(),
): Promise<OrderItemRow[]> {
  if (input.length === 0) return [];
  return executor.insert(orderItems).values(input).returning();
}

/**
 * Updates an order, bumping its version.
 *
 * When `expectedVersion` is supplied the update only applies if the row is
 * still at that version — optimistic concurrency. Two staff members editing
 * the same order during a confirmation call is routine, and without this the
 * second save silently discards the first.
 *
 * Returns undefined when the row is missing OR the version did not match; the
 * caller distinguishes the two.
 */
export async function updateOrderRow(
  id: string,
  patch: Partial<NewOrderRow>,
  options: { expectedVersion?: number } = {},
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow | undefined> {
  const predicate =
    options.expectedVersion === undefined
      ? eq(orders.id, id)
      : and(eq(orders.id, id), eq(orders.version, options.expectedVersion));

  const rows = await executor
    .update(orders)
    .set({
      ...patch,
      version: sql`${orders.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(predicate)
    .returning();

  return rows[0];
}

export async function updateOrderItemRow(
  id: string,
  patch: Partial<NewOrderItemRow>,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderItemRow | undefined> {
  const rows = await executor
    .update(orderItems)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(orderItems.id, id))
    .returning();
  return rows[0];
}

export async function deleteOrderItemRow(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const rows = await executor
    .delete(orderItems)
    .where(eq(orderItems.id, id))
    .returning({ id: orderItems.id });
  return rows.length === 1;
}

/**
 * Recomputes and persists the order's derived totals from its items.
 *
 * One statement: the subtotal, line and unit counters are all aggregates over
 * `order_items`, so pulling them into JavaScript to add up would be a round
 * trip for arithmetic the database can do in place. The delivery charge is
 * passed in because it depends on settings and zone, not on the items.
 */
export async function recalculateOrderTotals(
  orderId: string,
  deliveryCharge: number,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow | undefined> {
  /* Correlated aggregates over the items, evaluated inside the UPDATE.
     Written through Drizzle's builder rather than `execute(sql\`…\`)` on
     purpose: a raw execute returns driver rows with snake_case keys and no
     type mapping, so `row.grandTotal` would be undefined — which silently
     produced null "new value" entries in the audit log. */
  const subtotal = sql<number>`(
    select coalesce(sum(${orderItems.lineTotal}), 0)
    from ${orderItems} where ${orderItems.orderId} = ${orderId}
  )`;

  const rows = await executor
    .update(orders)
    .set({
      subtotal,
      deliveryCharge,
      grandTotal: sql<number>`${subtotal} + ${deliveryCharge}`,
      itemCount: sql<number>`(
        select count(*)::int from ${orderItems} where ${orderItems.orderId} = ${orderId}
      )`,
      totalQuantity: sql<number>`(
        select coalesce(sum(${orderItems.quantity}), 0)::int
        from ${orderItems} where ${orderItems.orderId} = ${orderId}
      )`,
      version: sql`${orders.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(orders.id, orderId))
    .returning();

  return rows[0];
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function findOrderById(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow | undefined> {
  const rows = await executor.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0];
}

export async function findOrderByNumber(
  orderNumber: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow | undefined> {
  const rows = await executor
    .select()
    .from(orders)
    .where(sql`upper(${orders.orderNumber}) = ${orderNumber.trim().toUpperCase()}`)
    .limit(1);
  return rows[0];
}

/**
 * Customer-facing lookup for public order tracking.
 *
 * Requires BOTH identifiers to match. The order number alone is guessable — it
 * comes from a sequence — so the phone number is what makes this safe to expose
 * without a login. Callers must return an identical response for "no such
 * order" and "phone does not match", or the endpoint becomes an oracle that
 * confirms which order numbers exist.
 */
export async function findOrderForCustomer(
  orderNumber: string,
  phone: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow | undefined> {
  const rows = await executor
    .select()
    .from(orders)
    .where(
      and(
        sql`upper(${orders.orderNumber}) = ${orderNumber.trim().toUpperCase()}`,
        eq(orders.phone, phone),
      ),
    )
    .limit(1);

  return rows[0];
}

export async function findOrderByIdempotencyKey(
  key: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow | undefined> {
  const rows = await executor
    .select()
    .from(orders)
    .where(eq(orders.idempotencyKey, key))
    .limit(1);
  return rows[0];
}

export async function listOrderItems(
  orderId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderItemRow[]> {
  return executor
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));
}

export async function findOrderItemById(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderItemRow | undefined> {
  const rows = await executor.select().from(orderItems).where(eq(orderItems.id, id)).limit(1);
  return rows[0];
}

export interface OrderDetail {
  order: OrderRow;
  items: OrderItemRow[];
  events: OrderEventRow[];
}

/**
 * Full order detail.
 *
 * Drizzle's relational query compiles the `with` clauses into lateral joins
 * against a single statement — header, items and timeline in one round trip
 * rather than three sequential queries.
 */
export async function findOrderDetail(
  identifier: { id?: string; orderNumber?: string },
  executor: DatabaseExecutor = getDb(),
): Promise<OrderDetail | undefined> {
  const db = executor as ReturnType<typeof getDb>;

  const predicate = identifier.id
    ? eq(orders.id, identifier.id)
    : sql`upper(${orders.orderNumber}) = ${(identifier.orderNumber ?? "").trim().toUpperCase()}`;

  const row = await db.query.orders.findFirst({
    where: predicate,
    with: { items: true, events: true },
  });

  if (!row) return undefined;

  return {
    order: row as unknown as OrderRow,
    items: row.items,
    events: row.events,
  };
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

export interface OrderFilters {
  /** Matches order number, phone, or customer name prefix. */
  search?: string;
  status?: OrderStatus[];
  paymentMethod?: PaymentMethod;
  deliveryZone?: DeliveryZone;
  /** Inclusive, on `created_at`. */
  dateFrom?: Date;
  dateTo?: Date;
  minTotal?: number;
  maxTotal?: number;
}

export type OrderSort = "newest" | "oldest" | "total_desc" | "total_asc";

export interface ListOrdersOptions {
  filters: OrderFilters;
  sort: OrderSort;
  page: number;
  perPage: number;
}

/**
 * Search predicate.
 *
 * Three shapes of input, each routed to an index:
 *   - `GNG-10042` or `10042` → order number
 *   - digits                 → phone, exact or prefix
 *   - anything else          → customer name prefix (`text_pattern_ops` index)
 *
 * A trailing-wildcard `LIKE` is used rather than `%term%`: a leading wildcard
 * cannot use a btree at all, and staff search by the start of a name or number
 * in practice.
 */
function buildSearchPredicate(term: string): SQL | undefined {
  const trimmed = term.trim();
  if (!trimmed) return undefined;

  /* Escape LIKE metacharacters so a customer named "100%" cannot turn the
     search into a full scan or match everything. */
  const escaped = trimmed.replace(/[%_\\]/g, "\\$&");
  const digits = trimmed.replace(/\D/g, "");

  const clauses: SQL[] = [
    sql`upper(${orders.orderNumber}) like ${`%${escaped.toUpperCase()}%`}`,
    sql`lower(${orders.customerName}) like ${`${escaped.toLowerCase()}%`}`,
  ];

  if (digits.length >= 3) {
    clauses.push(sql`${orders.phone} like ${`%${digits}%`}`);
  }

  return or(...clauses);
}

function buildWhere(filters: OrderFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  if (filters.search) conditions.push(buildSearchPredicate(filters.search));
  if (filters.status?.length) conditions.push(inArray(orders.status, filters.status));
  if (filters.paymentMethod) conditions.push(eq(orders.paymentMethod, filters.paymentMethod));
  if (filters.deliveryZone) conditions.push(eq(orders.deliveryZone, filters.deliveryZone));
  if (filters.dateFrom) conditions.push(gte(orders.createdAt, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(orders.createdAt, filters.dateTo));
  if (filters.minTotal !== undefined) conditions.push(gte(orders.grandTotal, filters.minTotal));
  if (filters.maxTotal !== undefined) conditions.push(lte(orders.grandTotal, filters.maxTotal));

  const defined = conditions.filter((condition): condition is SQL => condition !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
}

/** Closed mapping — a client sort string never reaches `ORDER BY`. */
function buildOrderBy(sort: OrderSort): SQL[] {
  const tiebreak = sql`${orders.id}`;

  switch (sort) {
    case "oldest":
      return [asc(orders.createdAt), tiebreak];
    case "total_desc":
      return [desc(orders.grandTotal), tiebreak];
    case "total_asc":
      return [asc(orders.grandTotal), tiebreak];
    case "newest":
    default:
      return [desc(orders.createdAt), tiebreak];
  }
}

export async function listOrders(
  options: ListOrdersOptions,
  executor: DatabaseExecutor = getDb(),
): Promise<{ rows: OrderRow[]; total: number }> {
  const offset = (options.page - 1) * options.perPage;

  const rows = await executor
    .select({
      order: orders,
      /* Pre-LIMIT total in the same pass — no second COUNT query re-running
         every filter. */
      totalCount: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(orders)
    .where(buildWhere(options.filters))
    .orderBy(...buildOrderBy(options.sort))
    .limit(options.perPage)
    .offset(offset);

  return {
    rows: rows.map((row) => row.order),
    total: rows[0]?.totalCount ?? 0,
  };
}

/**
 * Counts orders by status in one pass.
 *
 * Drives the status tabs above the order list. A separate COUNT per status
 * would be eight queries on every page load.
 */
export async function countOrdersByStatus(
  executor: DatabaseExecutor = getDb(),
): Promise<Record<string, number>> {
  const rows = await executor
    .select({
      status: orders.status,
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(orders)
    .groupBy(orders.status);

  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

/**
 * Recent orders sharing a phone number.
 *
 * Backs the duplicate-submission guard: a customer double-tapping "Place
 * Order" should not create two identical orders when the client forgot to send
 * an idempotency key.
 */
export async function findRecentOrdersByPhone(
  phone: string,
  withinSeconds: number,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderRow[]> {
  return executor
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.phone, phone),
        gte(orders.createdAt, new Date(Date.now() - withinSeconds * 1000)),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(5);
}
