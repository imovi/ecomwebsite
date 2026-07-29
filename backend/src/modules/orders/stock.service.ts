import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client.js";
import { products } from "../../db/schema/products.js";
import { productVariants } from "../../db/schema/product-variants.js";
import { ConflictError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";

/**
 * Stock movement.
 *
 * Every function here MUST be called with a transaction executor. Stock and
 * orders change together or not at all — a decrement that commits while the
 * order insert fails is inventory that has silently vanished.
 *
 * THREE INVARIANTS, ENFORCED BY CONSTRUCTION
 * ------------------------------------------
 *
 * 1. **Stock can never go negative.** Decrements are a single conditional
 *    UPDATE (`... WHERE stock_quantity >= $qty`). If the row does not match,
 *    zero rows come back and we raise a conflict. A read-then-write check in
 *    application code loses to two concurrent checkouts: both read 1, both
 *    decide it is fine, both write 0, and the store has sold the same phone
 *    twice.
 *
 * 2. **Deadlocks are avoided by lock ordering.** Two orders containing the
 *    same two products in opposite order will deadlock if each locks rows in
 *    payload order. Every batch here is sorted by id first, so all
 *    transactions acquire row locks in the same sequence.
 *
 * 3. **The denormalised product total stays in step.** `products.stock_quantity`
 *    is the sum of its active variants (Phase 2 keeps it that way so listing
 *    queries need no aggregate join). Any variant movement re-derives it in the
 *    same transaction.
 */

const log = createLogger("stock");

export interface StockLine {
  productId: string;
  /** Null for a product sold as a single SKU. */
  variantId: string | null;
  quantity: number;
  /** For error messages a human can act on. */
  label: string;
}

/** Deterministic ordering: variant id when present, else product id. */
function lockKey(line: StockLine): string {
  return line.variantId ?? line.productId;
}

function sortForLocking(lines: StockLine[]): StockLine[] {
  return [...lines].sort((a, b) => lockKey(a).localeCompare(lockKey(b)));
}

/* -------------------------------------------------------------------------- */
/* Reserve                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Decrements stock for a set of lines.
 *
 * Throws `ConflictError` naming the item if any line cannot be satisfied,
 * which rolls the caller's transaction back and leaves every other line
 * untouched.
 */
export async function reserveStock(
  lines: StockLine[],
  executor: DatabaseExecutor,
): Promise<void> {
  for (const line of sortForLocking(lines)) {
    if (line.quantity <= 0) continue;

    const affected = line.variantId
      ? await executor
          .update(productVariants)
          .set({
            stockQuantity: sql`${productVariants.stockQuantity} - ${line.quantity}`,
            updatedAt: sql`now()`,
          })
          .where(
            sql`${productVariants.id} = ${line.variantId}
                and ${productVariants.stockQuantity} >= ${line.quantity}`,
          )
          .returning({ id: productVariants.id })
      : await executor
          .update(products)
          .set({
            stockQuantity: sql`${products.stockQuantity} - ${line.quantity}`,
            updatedAt: sql`now()`,
          })
          .where(
            sql`${products.id} = ${line.productId}
                and ${products.stockQuantity} >= ${line.quantity}`,
          )
          .returning({ id: products.id });

    if (affected.length === 0) {
      /* Either the row vanished or there is not enough stock. Both are the
         same thing from the customer's point of view. */
      throw new ConflictError(
        `"${line.label}" no longer has ${line.quantity} in stock. ` +
          `Please reduce the quantity or remove it.`,
        ErrorCode.CONFLICT,
      );
    }
  }

  await syncAffectedProducts(lines, executor);
  log.debug({ lines: lines.length }, "Stock reserved");
}

/* -------------------------------------------------------------------------- */
/* Release                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Returns stock to the catalogue — a cancellation, a return, or a quantity
 * reduction.
 *
 * Unconditional by design: releasing must never fail. Refusing to give stock
 * back because a row moved would leave the order cancelled and the inventory
 * permanently short.
 */
export async function releaseStock(
  lines: StockLine[],
  executor: DatabaseExecutor,
): Promise<void> {
  for (const line of sortForLocking(lines)) {
    if (line.quantity <= 0) continue;

    if (line.variantId) {
      await executor
        .update(productVariants)
        .set({
          stockQuantity: sql`${productVariants.stockQuantity} + ${line.quantity}`,
          updatedAt: sql`now()`,
        })
        .where(sql`${productVariants.id} = ${line.variantId}`);
    } else {
      await executor
        .update(products)
        .set({
          stockQuantity: sql`${products.stockQuantity} + ${line.quantity}`,
          updatedAt: sql`now()`,
        })
        .where(sql`${products.id} = ${line.productId}`);
    }
  }

  await syncAffectedProducts(lines, executor);
  log.debug({ lines: lines.length }, "Stock released");
}

/**
 * Applies a delta to one line: positive reserves more, negative gives back.
 *
 * Used when an admin edits a quantity. Expressed as a delta rather than
 * release-then-reserve so a quantity increase that cannot be satisfied fails
 * without first having handed the original units back.
 */
export async function adjustStock(
  line: StockLine,
  delta: number,
  executor: DatabaseExecutor,
): Promise<void> {
  if (delta === 0) return;

  if (delta > 0) {
    await reserveStock([{ ...line, quantity: delta }], executor);
  } else {
    await releaseStock([{ ...line, quantity: -delta }], executor);
  }
}

/**
 * Moves a reservation from one variant to another.
 *
 * The new variant is reserved FIRST. If it cannot be satisfied the whole
 * transaction rolls back and the customer keeps the variant they had — the
 * reverse order would release the original units and then fail, leaving the
 * order holding nothing.
 */
export async function moveReservation(
  from: StockLine,
  to: StockLine,
  executor: DatabaseExecutor,
): Promise<void> {
  await reserveStock([to], executor);
  await releaseStock([from], executor);

  log.info(
    { from: lockKey(from), to: lockKey(to), quantity: to.quantity },
    "Stock reservation moved",
  );
}

/* -------------------------------------------------------------------------- */
/* Denormalised totals                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Re-derives `products.stock_quantity` for every product whose variants moved.
 *
 * One statement for the whole batch rather than per line — an order with six
 * variants of the same product should not run six identical aggregates.
 */
async function syncAffectedProducts(
  lines: StockLine[],
  executor: DatabaseExecutor,
): Promise<void> {
  const productIds = [
    ...new Set(lines.filter((line) => line.variantId).map((line) => line.productId)),
  ];
  if (productIds.length === 0) return;

  /* Build the id list explicitly. Interpolating a JS array into a raw sql
     template binds it as one value, which Postgres then rejects — the same
     trap as array literals elsewhere. */
  const idList = sql.join(
    productIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  await executor.execute(sql`
    update ${products} p
    set stock_quantity = coalesce(v.total, 0),
        stock_status = case
          when p.stock_status in ('pre_order', 'discontinued') then p.stock_status
          when coalesce(v.total, 0) > 0 then 'in_stock'::stock_status
          else 'out_of_stock'::stock_status
        end,
        updated_at = now()
    from (
      select product_id, sum(stock_quantity) as total
      from ${productVariants}
      where product_id in (${idList}) and is_active
      group by product_id
    ) v
    where p.id = v.product_id
  `);

  /* A product whose every variant was deactivated has no aggregate row above,
     so its total must be zeroed explicitly. */
  await executor.execute(sql`
    update ${products} p
    set stock_quantity = 0,
        stock_status = case
          when p.stock_status in ('pre_order', 'discontinued') then p.stock_status
          else 'out_of_stock'::stock_status
        end,
        updated_at = now()
    where p.id in (${idList})
      and not exists (
        select 1 from ${productVariants} v
        where v.product_id = p.id and v.is_active
      )
      and p.stock_quantity <> 0
  `);
}

/**
 * Re-derives the stock status of products sold without variants.
 *
 * Their `stock_quantity` is moved directly by reserve/release, so only the
 * derived status needs refreshing.
 */
export async function syncSimpleProductStatus(
  productIds: string[],
  executor: DatabaseExecutor,
): Promise<void> {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return;

  const idList = sql.join(
    unique.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  await executor.execute(sql`
    update ${products}
    set stock_status = case
          when stock_status in ('pre_order', 'discontinued') then stock_status
          when stock_quantity > 0 then 'in_stock'::stock_status
          else 'out_of_stock'::stock_status
        end,
        updated_at = now()
    where id in (${idList})
  `);
}
