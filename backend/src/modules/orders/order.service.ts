import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { productVariants, type ProductVariantRow } from "../../db/schema/product-variants.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { orderEvents as orderEventBus } from "../../lib/events/order-events.js";
import { suggestDeliveryZone } from "../../lib/geo/delivery-zone.js";
import { calculateDeliveryCharge, getSettings } from "../settings/settings.service.js";
import { recordProductSale, reverseProductSale } from "../products/metrics.service.js";
import {
  countOrdersByStatus,
  findOrderById,
  findOrderDetail,
  findOrderItemById,
  listOrderItems,
  listOrders,
  recalculateOrderTotals,
  updateOrderItemRow,
  updateOrderRow,
  type OrderFilters,
  type OrderSort,
} from "./order.repository.js";
import {
  listOrderEvents,
  recordEvent,
  type Actor,
  type RecordEventInput,
} from "./order-event.repository.js";
import { adjustStock, moveReservation, releaseStock, type StockLine } from "./stock.service.js";
import { variantLabelOf } from "./checkout.service.js";
import {
  toOrderDto,
  toOrderEventDto,
  toOrderListItemDto,
  type OrderDto,
  type OrderEventDto,
  type OrderListItemDto,
} from "./order.types.js";
import {
  DISPATCHED_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  type DeliveryZone,
  type OrderStatus,
} from "../../db/schema/order-enums.js";
import type { OrderRow } from "../../db/schema/orders.js";
import type { OrderItemRow } from "../../db/schema/order-items.js";
import type {
  CancelOrderInput,
  InternalNotesInput,
  UpdateCustomerInput,
  UpdateItemQuantityInput,
  UpdateItemVariantInput,
  UpdateStatusInput,
} from "./order.validation.js";

/**
 * Admin order management.
 *
 * THREE PROPERTIES EVERY MUTATION HERE HOLDS
 * ------------------------------------------
 *
 * 1. **Nothing changes silently.** Every mutation writes one or more timeline
 *    events inside the same transaction as the change. If the event insert
 *    fails, the change rolls back with it — the audit log cannot drift.
 *
 * 2. **Money is recomputed, never patched.** Totals come from
 *    `recalculateOrderTotals`, which re-aggregates the items in SQL. No code
 *    path adjusts `grand_total` by a delta, so an arithmetic slip cannot
 *    accumulate. A CHECK constraint on the table catches it if one ever did.
 *
 * 3. **Stock moves with the order.** Quantity and variant edits adjust
 *    inventory in the same transaction, through the conditional decrements in
 *    `stock.service`, so an edit can never oversell.
 */

const log = createLogger("orders");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Applies a version-checked update.
 *
 * A version mismatch is a 409 rather than a silent overwrite: during a
 * confirmation call two operators editing the same order is routine, and the
 * loser needs to re-read rather than have their change vanish.
 */
async function applyUpdate(
  order: OrderRow,
  patch: Parameters<typeof updateOrderRow>[1],
  expectedVersion: number | undefined,
  executor: DatabaseExecutor,
): Promise<OrderRow> {
  const updated = await updateOrderRow(
    order.id,
    patch,
    expectedVersion === undefined ? {} : { expectedVersion },
    executor,
  );

  if (!updated) {
    throw new ConflictError(
      "This order was modified by someone else. Reload it and try again.",
      ErrorCode.CONFLICT,
    );
  }

  return updated;
}

/** Loads an order or throws a 404. */
async function requireOrder(id: string, executor?: DatabaseExecutor): Promise<OrderRow> {
  const order = executor ? await findOrderById(id, executor) : await findOrderById(id);
  if (!order) throw new NotFoundError("Order not found.");
  return order;
}

function stockLineOf(item: OrderItemRow, quantity: number): StockLine {
  if (!item.productId) {
    /* The catalogue row was permanently deleted. There is nothing left to
       adjust, and the snapshot on the order still tells the whole story. */
    throw new ConflictError(
      `"${item.productName}" has been removed from the catalogue and its stock can no longer be adjusted.`,
      ErrorCode.CONFLICT,
    );
  }

  return {
    productId: item.productId,
    variantId: item.variantId,
    quantity,
    label: item.variantLabel ? `${item.productName} (${item.variantLabel})` : item.productName,
  };
}

/** Rejects edits to an order that has already left the building. */
function assertEditable(order: OrderRow, action: string): void {
  if (DISPATCHED_STATUSES.includes(order.status)) {
    throw new ConflictError(
      `Cannot ${action}: this order is already ${order.status}.`,
      ErrorCode.CONFLICT,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface OrderListResult {
  items: OrderListItemDto[];
  pagination: { page: number; perPage: number; total: number };
}

export async function list(options: {
  filters: OrderFilters;
  sort: OrderSort;
  page: number;
  perPage: number;
}): Promise<OrderListResult> {
  const { rows, total } = await listOrders(options);

  return {
    items: rows.map(toOrderListItemDto),
    pagination: { page: options.page, perPage: options.perPage, total },
  };
}

export async function statusCounts(
  range: { dateFrom?: Date; dateTo?: Date } = {},
): Promise<Record<string, number>> {
  return countOrdersByStatus(range);
}

/** Detail by uuid or order number, in one round trip. */
export async function getByIdentifier(
  identifier: string,
  options: { includeDeleted?: boolean } = {},
): Promise<OrderDto> {
  const key = UUID_PATTERN.test(identifier) ? { id: identifier } : { orderNumber: identifier };

  const detail = await findOrderDetail({
    ...key,
    ...(options.includeDeleted ? { includeDeleted: true } : {}),
  });

  if (!detail) throw new NotFoundError("Order not found.");
  return toOrderDto(detail.order, detail.items, detail.events);
}

/* -------------------------------------------------------------------------- */
/* Trash                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Moves an order to the trash.
 *
 * A soft delete on purpose. The order is the record of money owed or collected
 * and carries an audit trail that exists so history cannot be quietly rewritten;
 * removing the row would also restate every profit figure it appeared in, with
 * nothing on screen to say why the totals changed.
 *
 * Stock is deliberately NOT returned. Deleting is a tidying action — clearing a
 * test order or a duplicate — and a delete that silently moved stock would be a
 * second, invisible consequence. An order whose stock should come back is
 * CANCELLED, which does exactly that and records a reason.
 */
export async function moveToTrash(orderId: string, actor: Actor): Promise<void> {
  const order = await requireOrder(orderId);

  if (order.deletedAt) return;

  await getDb()
    .update(orders)
    .set({
      deletedAt: sql`now()`,
      deletedBy: actor.adminId ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(orders.id, orderId));

  /* Recorded on the order itself, so a restored order shows why it vanished. */
  await recordEvent({
    orderId,
    type: "note_added",
    note: `Moved to trash by ${actor.name}`,
    actor,
  });
}

export async function restoreFromTrash(orderId: string, actor: Actor): Promise<void> {
  const rows = await getDb()
    .select({ id: orders.id, deletedAt: orders.deletedAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  const order = rows[0];
  if (!order) throw new NotFoundError("Order not found.");
  if (!order.deletedAt) return;

  await getDb()
    .update(orders)
    .set({ deletedAt: null, deletedBy: null, updatedAt: sql`now()` })
    .where(eq(orders.id, orderId));

  await recordEvent({
    orderId,
    type: "note_added",
    note: `Restored from trash by ${actor.name}`,
    actor,
  });
}

/**
 * Removes an order for good.
 *
 * The only path in this system that destroys an order, which is why it is
 * separate from the delete button rather than a confirmation on it: the trash
 * screen is the one place somebody is already looking at what they are about to
 * lose.
 */
export async function purgeFromTrash(orderId: string): Promise<void> {
  const rows = await getDb()
    .select({ id: orders.id, deletedAt: orders.deletedAt })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  const order = rows[0];
  if (!order) throw new NotFoundError("Order not found.");
  if (!order.deletedAt) {
    /* Refusing rather than deleting: reaching here with a live order means a
       caller got its ids crossed, and the safe answer is to do nothing. */
    throw new BadRequestError("That order is not in the trash.");
  }

  /* Items and events cascade from the order's own foreign keys. */
  await getDb().delete(orders).where(eq(orders.id, orderId));
}

/** How long a deleted order is kept before the sweep takes it. */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Empties anything that has sat in the trash past the retention window.
 *
 * Runs on a timer. Bounded per pass so a large clear-out cannot hold a
 * connection for minutes; whatever is left is taken on the next one.
 */
export async function purgeExpiredTrash(): Promise<number> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60_000);

  const expired = await getDb()
    .select({ id: orders.id })
    .from(orders)
    .where(and(isNotNull(orders.deletedAt), lt(orders.deletedAt, cutoff)))
    .limit(200);

  for (const row of expired) {
    await getDb().delete(orders).where(eq(orders.id, row.id));
  }

  return expired.length;
}

/**
 * The order's audit log on its own.
 *
 * The same entries appear inline on the order detail, but a long-running order
 * accumulates dozens of them and an operator investigating a dispute wants
 * only the history. Serving it separately keeps the detail response small.
 */
export async function getTimeline(orderId: string): Promise<OrderEventDto[]> {
  await requireOrder(orderId);
  const events = await listOrderEvents(orderId);
  return events.map(toOrderEventDto);
}

/* -------------------------------------------------------------------------- */
/* Customer information                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Updates customer details.
 *
 * Changing the area re-derives the delivery zone unless one is given
 * explicitly, and any zone change recomputes the delivery charge and the grand
 * total — the requirement that an address edit must not leave a stale charge.
 *
 * One event per changed field, so the timeline reads as a list of specific
 * corrections rather than a vague "customer updated".
 */
export async function updateCustomer(
  orderId: string,
  input: UpdateCustomerInput,
  actor: Actor,
): Promise<OrderDto> {
  const existing = await requireOrder(orderId);
  assertEditable(existing, "change customer details");

  const changedFields: string[] = [];

  const updated = await getDb().transaction(async (tx) => {
    const events: RecordEventInput[] = [];
    const patch: Record<string, unknown> = {};

    if (input.customerName !== undefined && input.customerName !== existing.customerName) {
      patch.customerName = input.customerName;
      changedFields.push("customerName");
      events.push({
        orderId,
        type: "customer_updated",
        field: "customer.name",
        previousValue: existing.customerName,
        newValue: input.customerName,
        actor,
        note: input.note,
      });
    }

    if (input.phone !== undefined && input.phone !== existing.phone) {
      patch.phone = input.phone;
      changedFields.push("phone");
      events.push({
        orderId,
        type: "phone_updated",
        field: "customer.phone",
        previousValue: existing.phone,
        newValue: input.phone,
        actor,
        note: input.note,
      });
    }

    if (input.address !== undefined && input.address !== existing.address) {
      patch.address = input.address;
      changedFields.push("address");
      events.push({
        orderId,
        type: "address_updated",
        field: "customer.address",
        previousValue: existing.address,
        newValue: input.address,
        actor,
        note: input.note,
      });
    }

    /* Zone resolution: an explicit value wins; otherwise a changed area is
       re-inferred. An unrecognised new area leaves the existing zone alone
       rather than guessing — guessing undercharges rural orders. */
    let nextZone: DeliveryZone = existing.deliveryZone;

    if (input.areaText !== undefined && input.areaText !== existing.areaText) {
      patch.areaText = input.areaText;
      changedFields.push("areaText");
      events.push({
        orderId,
        type: "address_updated",
        field: "customer.areaText",
        previousValue: existing.areaText,
        newValue: input.areaText,
        actor,
        note: input.note,
      });

      if (!input.deliveryZone) {
        const suggestion = suggestDeliveryZone(input.areaText);
        if (suggestion) nextZone = suggestion.zone;
      }
    }

    if (input.deliveryZone) nextZone = input.deliveryZone;

    let zoneChanged = false;
    if (nextZone !== existing.deliveryZone) {
      patch.deliveryZone = nextZone;
      zoneChanged = true;
      changedFields.push("deliveryZone");
      events.push({
        orderId,
        type: "address_updated",
        field: "customer.deliveryZone",
        previousValue: existing.deliveryZone,
        newValue: nextZone,
        actor,
        note: input.note,
      });
    }

    if (Object.keys(patch).length === 0) {
      /* Nothing actually differs. Returning early keeps the timeline free of
         no-op entries, which are noise in an audit log. */
      return existing;
    }

    let order = await applyUpdate(existing, patch, input.expectedVersion, tx);

    /* A zone change moves the delivery charge, which moves the grand total. */
    if (zoneChanged) {
      const settings = await getSettings(tx);
      const previousCharge = order.deliveryCharge;
      const nextCharge = calculateDeliveryCharge(settings, nextZone, order.subtotal);

      if (nextCharge !== previousCharge) {
        const recalculated = await recalculateOrderTotals(orderId, nextCharge, tx);
        if (recalculated) order = recalculated;

        events.push({
          orderId,
          type: "delivery_charge_updated",
          field: "deliveryCharge",
          previousValue: previousCharge,
          newValue: nextCharge,
          actor,
          note: "Recalculated automatically after the delivery area changed.",
        });
        events.push({
          orderId,
          type: "totals_recalculated",
          field: "grandTotal",
          previousValue: existing.grandTotal,
          newValue: order.grandTotal,
          actor,
        });
      }
    }

    for (const event of events) await recordEvent(event, tx);
    return order;
  });

  if (changedFields.length > 0) {
    log.info({ orderId, fields: changedFields }, "Order customer details updated");

    orderEventBus.emit("order.customer_updated", {
      orderId,
      orderNumber: updated.orderNumber,
      phone: updated.phone,
      changedFields,
      adminId: actor.adminId ?? null,
      updatedAt: new Date(),
    });
  }

  return getByIdentifier(orderId);
}

/* -------------------------------------------------------------------------- */
/* Line items                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Changes a line's quantity.
 *
 * Stock is adjusted by the delta rather than released-then-reserved: an
 * increase that cannot be satisfied fails without first having handed the
 * original units back.
 */
export async function updateItemQuantity(
  orderId: string,
  itemId: string,
  input: UpdateItemQuantityInput,
  actor: Actor,
): Promise<OrderDto> {
  const existing = await requireOrder(orderId);
  assertEditable(existing, "change quantities");

  const item = await findOrderItemById(itemId);
  if (!item || item.orderId !== orderId) {
    throw new NotFoundError("That item is not part of this order.");
  }

  if (item.quantity === input.quantity) return getByIdentifier(orderId);

  await getDb().transaction(async (tx) => {
    /* Take the version lock first: if another operator has touched this order,
       fail before moving any inventory. */
    await applyUpdate(existing, {}, input.expectedVersion, tx);

    const delta = input.quantity - item.quantity;
    await adjustStock(stockLineOf(item, 0), delta, tx);

    await updateOrderItemRow(
      itemId,
      { quantity: input.quantity, lineTotal: item.unitPrice * input.quantity },
      tx,
    );

    const settings = await getSettings(tx);
    /* Recompute the subtotal from the items first, then price delivery
       against it — a free-delivery threshold means the charge itself can
       change when a quantity does. */
    const items = await listOrderItems(orderId, tx);
    const subtotal = items.reduce(
      (sum, row) => sum + (row.id === itemId ? item.unitPrice * input.quantity : row.lineTotal),
      0,
    );
    const charge = calculateDeliveryCharge(settings, existing.deliveryZone, subtotal);
    const recalculated = await recalculateOrderTotals(orderId, charge, tx);

    await recordEvent(
      {
        orderId,
        type: "quantity_updated",
        field: `items.${item.sku}.quantity`,
        previousValue: item.quantity,
        newValue: input.quantity,
        actor,
        note: input.note,
      },
      tx,
    );

    await recordEvent(
      {
        orderId,
        type: "totals_recalculated",
        field: "grandTotal",
        previousValue: existing.grandTotal,
        newValue: recalculated?.grandTotal ?? existing.grandTotal,
        actor,
      },
      tx,
    );
  });

  log.info({ orderId, itemId, quantity: input.quantity }, "Order item quantity updated");
  return getByIdentifier(orderId);
}

/**
 * Swaps a line to a different variant of the same product.
 *
 * Restores the previous variant's stock and reserves the new one — in that
 * order internally, but the new reservation is attempted first so a failure
 * leaves the customer holding the variant they had.
 *
 * The new variant's CURRENT price is applied, and the timeline records both
 * the variant and the price change. Silently keeping the old price would mean
 * an invoice whose line does not match the item being shipped.
 */
export async function updateItemVariant(
  orderId: string,
  itemId: string,
  input: UpdateItemVariantInput,
  actor: Actor,
): Promise<OrderDto> {
  const existing = await requireOrder(orderId);
  assertEditable(existing, "change variants");

  const item = await findOrderItemById(itemId);
  if (!item || item.orderId !== orderId) {
    throw new NotFoundError("That item is not part of this order.");
  }

  if (item.variantId === input.variantId) return getByIdentifier(orderId);

  await getDb().transaction(async (tx) => {
    await applyUpdate(existing, {}, input.expectedVersion, tx);

    const rows = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId))
      .limit(1);

    const nextVariant: ProductVariantRow | undefined = rows[0];

    if (!nextVariant) {
      throw new ValidationError([
        { field: "body.variantId", message: "That variant does not exist." },
      ]);
    }

    /* Swapping to a different product would silently change what was ordered. */
    if (nextVariant.productId !== item.productId) {
      throw new ValidationError([
        {
          field: "body.variantId",
          message: `That variant belongs to a different product. Remove the line and add the correct product instead.`,
        },
      ]);
    }

    if (!nextVariant.isActive) {
      throw new ConflictError("That variant is no longer sold.", ErrorCode.CONFLICT);
    }

    const nextLabel = variantLabelOf(nextVariant);

    await moveReservation(
      stockLineOf(item, item.quantity),
      {
        productId: item.productId,
        variantId: nextVariant.id,
        quantity: item.quantity,
        label: `${item.productName} (${nextLabel})`,
      },
      tx,
    );

    await updateOrderItemRow(
      itemId,
      {
        variantId: nextVariant.id,
        variantLabel: nextLabel,
        sku: nextVariant.sku,
        unitPrice: nextVariant.price,
        lineTotal: nextVariant.price * item.quantity,
      },
      tx,
    );

    const settings = await getSettings(tx);
    const items = await listOrderItems(orderId, tx);
    const subtotal = items.reduce(
      (sum, row) =>
        sum + (row.id === itemId ? nextVariant.price * item.quantity : row.lineTotal),
      0,
    );
    const charge = calculateDeliveryCharge(settings, existing.deliveryZone, subtotal);
    const recalculated = await recalculateOrderTotals(orderId, charge, tx);

    await recordEvent(
      {
        orderId,
        type: "variant_updated",
        field: `items.${item.sku}.variant`,
        previousValue: { variantId: item.variantId, label: item.variantLabel, sku: item.sku },
        newValue: { variantId: nextVariant.id, label: nextLabel, sku: nextVariant.sku },
        actor,
        note: input.note,
      },
      tx,
    );

    if (nextVariant.price !== item.unitPrice) {
      await recordEvent(
        {
          orderId,
          type: "totals_recalculated",
          field: `items.${nextVariant.sku}.unitPrice`,
          previousValue: item.unitPrice,
          newValue: nextVariant.price,
          actor,
          note: "Unit price follows the newly selected variant.",
        },
        tx,
      );
    }

    await recordEvent(
      {
        orderId,
        type: "totals_recalculated",
        field: "grandTotal",
        previousValue: existing.grandTotal,
        newValue: recalculated?.grandTotal ?? existing.grandTotal,
        actor,
      },
      tx,
    );
  });

  log.info({ orderId, itemId, variantId: input.variantId }, "Order item variant updated");
  return getByIdentifier(orderId);
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

/** Timestamp column stamped when a status is first reached. */
const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof OrderRow>> = {
  confirmed: "confirmedAt",
  shipped: "shippedAt",
  delivered: "deliveredAt",
  cancelled: "cancelledAt",
  returned: "returnedAt",
};

/**
 * Moves an order through its lifecycle.
 *
 * The transition table is the authority — an illegal move is a 409 naming what
 * is allowed instead. Three side effects hang off specific transitions:
 *
 *   → cancelled / returned : reserved stock goes back to the catalogue
 *   → delivered            : the sale is recorded against product metrics,
 *                            which is what makes Best Selling and Trending
 *                            reflect reality (the Phase 2 integration point)
 *   returned (from delivered) : that sale is reversed again
 */
export async function updateStatus(
  orderId: string,
  input: UpdateStatusInput,
  actor: Actor,
  /** Written in the same transaction as the status change — see `cancel`. */
  options: { cancellationReason?: string } = {},
): Promise<OrderDto> {
  const existing = await requireOrder(orderId);

  if (existing.status === input.status) return getByIdentifier(orderId);

  const allowed = ORDER_STATUS_TRANSITIONS[existing.status];
  if (!allowed.includes(input.status)) {
    throw new ConflictError(
      allowed.length === 0
        ? `This order is ${existing.status} and can no longer change status.`
        : `Cannot move an order from ${existing.status} to ${input.status}. ` +
          `Allowed: ${allowed.join(", ")}.`,
      ErrorCode.CONFLICT,
    );
  }

  const releasesStock =
    input.status === "cancelled" ||
    (input.status === "returned" && existing.status !== "cancelled");

  await getDb().transaction(async (tx) => {
    const items = await listOrderItems(orderId, tx);

    if (releasesStock) {
      /* Items whose catalogue row was permanently deleted are skipped rather
         than failing the cancellation — the order state matters more than a
         stock counter for a product that no longer exists. */
      const lines = items
        .filter((item) => item.productId)
        .map((item) => stockLineOf(item, item.quantity));

      if (lines.length > 0) await releaseStock(lines, tx);
    }

    const timestampField = STATUS_TIMESTAMP[input.status];

    await applyUpdate(
      existing,
      {
        status: input.status,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
        ...(options.cancellationReason !== undefined
          ? { cancellationReason: options.cancellationReason }
          : {}),
      },
      input.expectedVersion,
      tx,
    );

    await recordEvent(
      {
        orderId,
        type:
          input.status === "cancelled"
            ? "order_cancelled"
            : input.status === "delivered"
              ? "order_delivered"
              : input.status === "returned"
                ? "order_returned"
                : "status_changed",
        field: "status",
        previousValue: existing.status,
        newValue: input.status,
        actor,
        note: input.note,
      },
      tx,
    );

    /* Product sales metrics — the seam Phase 2 documented. Revenue on a
       cash-on-delivery store is recognised at delivery, not at placement. */
    if (input.status === "delivered") {
      for (const item of items) {
        if (item.productId) {
          await recordProductSale({ productId: item.productId, units: item.quantity }, tx);
        }
      }
    }

    if (input.status === "returned" && existing.status === "delivered") {
      for (const item of items) {
        if (item.productId) {
          await reverseProductSale({ productId: item.productId, units: item.quantity }, tx);
        }
      }
    }
  });

  log.info(
    { orderId, from: existing.status, to: input.status, adminId: actor.adminId },
    "Order status changed",
  );

  orderEventBus.emit("order.status_changed", {
    orderId,
    orderNumber: existing.orderNumber,
    customerName: existing.customerName,
    phone: existing.phone,
    previousStatus: existing.status,
    newStatus: input.status,
    adminId: actor.adminId ?? null,
    changedAt: new Date(),
  });

  return getByIdentifier(orderId);
}

/**
 * Cancels an order.
 *
 * Delegates entirely to `updateStatus` so cancellation cannot take a different
 * path through the state machine, passing the reason down to be written in the
 * SAME transaction as the status change.
 *
 * Writing the reason first and then changing the status would be wrong: a
 * cancellation refused by the transition rules — a shipped order, say — would
 * leave a live order carrying a cancellation reason it never acted on.
 *
 * The reason is required here, unlike a generic status change: on a
 * cash-on-delivery store it is the only thing separating "customer changed
 * their mind" from "suspected fake order" when the numbers are reviewed later.
 */
export async function cancel(
  orderId: string,
  input: CancelOrderInput,
  actor: Actor,
): Promise<OrderDto> {
  return updateStatus(
    orderId,
    {
      status: "cancelled",
      note: input.reason,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
    },
    actor,
    { cancellationReason: input.reason },
  );
}

/* -------------------------------------------------------------------------- */
/* Internal notes                                                             */
/* -------------------------------------------------------------------------- */

export async function updateInternalNotes(
  orderId: string,
  input: InternalNotesInput,
  actor: Actor,
): Promise<OrderDto> {
  const existing = await requireOrder(orderId);

  if ((existing.internalNotes ?? null) === (input.internalNotes ?? null)) {
    return getByIdentifier(orderId);
  }

  await getDb().transaction(async (tx) => {
    await applyUpdate(
      existing,
      { internalNotes: input.internalNotes },
      input.expectedVersion,
      tx,
    );

    await recordEvent(
      {
        orderId,
        type: "note_added",
        field: "internalNotes",
        previousValue: existing.internalNotes,
        newValue: input.internalNotes,
        actor,
        note: input.note,
      },
      tx,
    );
  });

  log.info({ orderId }, "Internal notes updated");
  return getByIdentifier(orderId);
}
