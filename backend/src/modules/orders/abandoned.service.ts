import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  abandonedCheckouts,
  type AbandonedCheckoutRow,
  type AbandonedLine,
  type AbandonedStatus,
} from "../../db/schema/abandoned-checkouts.js";
import { products } from "../../db/schema/products.js";
import { productVariants } from "../../db/schema/product-variants.js";
import { NotFoundError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import type { DeliveryZone } from "../../db/schema/order-enums.js";

/**
 * Incomplete checkouts.
 *
 * A customer who typed their number and then vanished is a warm lead with a
 * known phone — the cheapest sale a cash-on-delivery shop can make. This module
 * records those attempts, hides the ones that turned into orders, and gives the
 * shop a list worth working through.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE
 * No marketing list, no export, no automated messaging. The record exists so
 * somebody can ring a customer about the order they were halfway through, and
 * it removes itself the moment that order arrives. Anything beyond that is a
 * different feature with different consent behind it.
 */

const log = createLogger("abandoned");

/** Digits only, so `01712-345678` and `01712345678` are one lead, not two. */
export function normalizePhone(input: string): string {
  return input.replace(/\D/g, "");
}

export interface RecordAbandonedInput {
  phone: string;
  customerName?: string | undefined;
  address?: string | undefined;
  areaText?: string | undefined;
  deliveryZone?: DeliveryZone | undefined;
  items: { productId: string; variantId?: string | null | undefined; quantity: number }[];
}

/**
 * Prices the cart from the catalogue rather than trusting the browser.
 *
 * The caller needs to know what the customer was actually looking at. A value
 * posted from the page could be anything, and a call list ordered by a number a
 * stranger controls would put whoever typed the biggest figure at the top.
 */
async function describeCart(
  items: RecordAbandonedInput["items"],
  executor: DatabaseExecutor,
): Promise<{ contents: AbandonedLine[]; itemCount: number; estimatedValue: number }> {
  if (items.length === 0) return { contents: [], itemCount: 0, estimatedValue: 0 };

  const contents: AbandonedLine[] = [];

  for (const item of items) {
    const rows = await executor
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
      })
      .from(products)
      .where(eq(products.id, item.productId))
      .limit(1);

    const product = rows[0];
    /* A cart line for a product that has since been deleted tells the caller
       nothing useful, so it is skipped rather than recorded as "unknown". */
    if (!product) continue;

    let unitPrice = product.price;
    let variantLabel: string | null = null;

    if (item.variantId) {
      const variantRows = await executor
        .select({ price: productVariants.price, options: productVariants.options })
        .from(productVariants)
        .where(eq(productVariants.id, item.variantId))
        .limit(1);

      const variant = variantRows[0];
      if (variant) {
        unitPrice = variant.price;
        const values = Object.values(variant.options).filter(Boolean);
        variantLabel = values.length > 0 ? values.join(" · ") : null;
      }
    }

    contents.push({
      productId: product.id,
      variantId: item.variantId ?? null,
      name: product.name,
      variantLabel,
      quantity: item.quantity,
      unitPrice,
    });
  }

  return {
    contents,
    itemCount: contents.reduce((sum, line) => sum + line.quantity, 0),
    estimatedValue: contents.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  };
}

/**
 * Records — or updates — the attempt for this number.
 *
 * Upsert rather than insert: the storefront saves as the customer types, and a
 * row per keystroke batch would have the shop ringing the same person five
 * times. `last_seen_at` moves forward so the freshest lead sorts first.
 *
 * A row that has already been recovered is left alone and a new one is started,
 * which is why the unique index is partial: a repeat customer abandoning a
 * second basket is a second opportunity, not a duplicate.
 */
export async function record(input: RecordAbandonedInput): Promise<void> {
  const db = getDb();
  const phone = normalizePhone(input.phone);

  const cart = await describeCart(input.items, db);

  const existing = await db
    .select({ id: abandonedCheckouts.id, status: abandonedCheckouts.status })
    .from(abandonedCheckouts)
    .where(and(eq(abandonedCheckouts.phone, phone), isNull(abandonedCheckouts.recoveredOrderId)))
    .limit(1);

  const current = existing[0];

  if (current) {
    await db
      .update(abandonedCheckouts)
      .set({
        /* Only overwrite with something. A customer who clears a field mid-edit
           should not wipe the name the shop already has to call them by. */
        ...(input.customerName ? { customerName: input.customerName } : {}),
        ...(input.address ? { address: input.address } : {}),
        ...(input.areaText ? { areaText: input.areaText } : {}),
        ...(input.deliveryZone ? { deliveryZone: input.deliveryZone } : {}),
        ...(cart.contents.length > 0 ? cart : {}),
        /* A dismissed lead that comes back is a live lead again — they
           returned to the checkout of their own accord. */
        ...(current.status === "dismissed" ? { status: "open" as const } : {}),
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(abandonedCheckouts.id, current.id));

    return;
  }

  await db.insert(abandonedCheckouts).values({
    phone,
    customerName: input.customerName ?? null,
    address: input.address ?? null,
    areaText: input.areaText ?? null,
    deliveryZone: input.deliveryZone ?? null,
    ...cart,
  });

  log.info({ phone: phone.slice(-4), value: cart.estimatedValue }, "Incomplete checkout recorded");
}

/**
 * Closes the lead when the order finally arrives.
 *
 * Called after an order commits. Matching on the phone rather than a session
 * covers the common case: the customer gave up on their phone, then finished on
 * a laptop, or simply reloaded and started again.
 */
export async function markRecovered(
  phone: string,
  orderId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  const normalized = normalizePhone(phone);

  const updated = await executor
    .update(abandonedCheckouts)
    .set({
      recoveredOrderId: orderId,
      recoveredAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(abandonedCheckouts.phone, normalized),
        isNull(abandonedCheckouts.recoveredOrderId),
      ),
    )
    .returning({ id: abandonedCheckouts.id });

  if (updated.length > 0) {
    log.info({ orderId, count: updated.length }, "Incomplete checkout recovered by an order");
  }
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export interface AbandonedDto {
  id: string;
  phone: string;
  customerName: string | null;
  address: string | null;
  areaText: string | null;
  deliveryZone: DeliveryZone | null;
  contents: AbandonedLine[];
  itemCount: number;
  estimatedValue: number;
  status: AbandonedStatus;
  note: string;
  contactedAt: string | null;
  recovered: boolean;
  lastSeenAt: string;
  createdAt: string;
}

function toDto(row: AbandonedCheckoutRow): AbandonedDto {
  return {
    id: row.id,
    phone: row.phone,
    customerName: row.customerName,
    address: row.address,
    areaText: row.areaText,
    deliveryZone: row.deliveryZone,
    contents: row.contents,
    itemCount: row.itemCount,
    estimatedValue: row.estimatedValue,
    status: row.status,
    note: row.note,
    contactedAt: row.contactedAt?.toISOString() ?? null,
    recovered: row.recoveredOrderId !== null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function list(
  options: { includeRecovered?: boolean | undefined; status?: AbandonedStatus | undefined } = {},
): Promise<AbandonedDto[]> {
  const filters = [
    /* Recovered leads are hidden by default: this list is a to-do, and a
       customer who already ordered is not on it. */
    ...(options.includeRecovered ? [] : [isNull(abandonedCheckouts.recoveredOrderId)]),
    ...(options.status ? [eq(abandonedCheckouts.status, options.status)] : []),
  ];

  const rows = await getDb()
    .select()
    .from(abandonedCheckouts)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(abandonedCheckouts.lastSeenAt))
    .limit(200);

  return rows.map(toDto);
}

/** How many are waiting for a call — for the badge on the nav. */
export async function openCount(): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(abandonedCheckouts)
    .where(
      and(eq(abandonedCheckouts.status, "open"), isNull(abandonedCheckouts.recoveredOrderId)),
    );

  return rows[0]?.count ?? 0;
}

export async function update(
  id: string,
  input: { status?: AbandonedStatus | undefined; note?: string | undefined },
  actorId: string | null,
): Promise<AbandonedDto> {
  const patch: Partial<AbandonedCheckoutRow> = {};
  if (input.note !== undefined) patch.note = input.note;

  if (input.status !== undefined) {
    patch.status = input.status;
    /* Stamp who rang and when, so "did anyone call this person?" is a fact
       rather than a guess — the same reason order status changes are logged. */
    if (input.status === "contacted") {
      patch.contactedBy = actorId;
      patch.contactedAt = new Date();
    }
  }

  const rows = await getDb()
    .update(abandonedCheckouts)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(abandonedCheckouts.id, id))
    .returning();

  const row = rows[0];
  if (!row) throw new NotFoundError("That incomplete checkout no longer exists.");

  return toDto(row);
}

export async function remove(id: string): Promise<void> {
  const rows = await getDb()
    .delete(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, id))
    .returning({ id: abandonedCheckouts.id });

  if (rows.length === 0) throw new NotFoundError("That incomplete checkout no longer exists.");
}
