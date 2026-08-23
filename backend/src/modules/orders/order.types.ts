import { getStorage } from "../../lib/storage/index.js";
import type { OrderRow } from "../../db/schema/orders.js";
import type { OrderItemRow } from "../../db/schema/order-items.js";
import type { OrderEventRow } from "../../db/schema/order-events.js";
import {
  ORDER_STATUS_TRANSITIONS,
  orderStatusEnum,
  type DeliveryZone,
  type OrderStatus,
  type PaymentMethod,
} from "../../db/schema/order-enums.js";
import { pickUndoableStatusEvent } from "./order-event.repository.js";

/** Every legal status, for narrowing a value read back out of the timeline. */
const ORDER_STATUS_VALUES: readonly string[] = orderStatusEnum.enumValues;

/**
 * Order response shapes.
 *
 * Two DTOs: a slim one for the list (which returns 20–50 rows and must not
 * ship every line item and timeline entry) and a full one for the detail view.
 */

export interface OrderItemDto {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  productSlug: string;
  sku: string;
  variantLabel: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /**
   * What this unit cost the shop, frozen at order time. Admin responses only.
   *
   * Null means no cost was recorded for the product when the order was placed —
   * which the profit reports show as unknown rather than as free.
   */
  unitCost?: number | null;
}

export interface OrderEventDto {
  id: string;
  type: string;
  field: string | null;
  previousValue: unknown;
  newValue: unknown;
  actorName: string;
  adminId: string | null;
  note: string | null;
  createdAt: string;
}

export interface OrderListItemDto {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  areaText: string;
  deliveryZone: DeliveryZone;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
  /** When it was moved to the trash. Null on every live order. */
  deletedAt: string | null;
}

/** One of the other orders that came from the same address. */
export interface SameIpOrderDto {
  orderNumber: string;
  customerName: string;
  phone: string;
  status: OrderStatus;
  grandTotal: number;
  createdAt: string;
}

/**
 * What else has arrived from this order's address.
 *
 * `distinctPhones` is the number that matters and the reason this exists. In
 * Bangladesh the carriers run carrier-grade NAT, so one public address fronts
 * hundreds of real customers — four orders from ONE phone number is somebody
 * gaming the shop, and four orders from FOUR numbers is an ordinary mobile
 * tower. Without that split, "4 orders from this IP" reads as guilt either way,
 * and blocking on it takes out a district.
 */
export interface SameIpSummary {
  /** Other orders from this address, excluding the one being viewed. */
  total: number;
  distinctPhones: number;
  /** The most recent few, for the panel. */
  recent: SameIpOrderDto[];
}

export interface OrderDto extends OrderListItemDto {
  address: string;
  /**
   * Where the order was placed from. Admin detail only — never the public
   * confirmation or tracking response.
   */
  customerIp: string | null;
  /** Null when no address was recorded. */
  sameIp: SameIpSummary | null;
  /** The live block covering this address, if there is one. */
  blocked: { id: string; reason: string; expiresAt: string | null } | null;
  internalNotes: string | null;
  /**
   * Where the order came from, when the desk typed it in — "WhatsApp",
   * "Facebook page". NULL means the customer checked out themselves, which is
   * the answer for every order the storefront placed.
   */
  source: string | null;
  cancellationReason: string | null;
  version: number;
  items: OrderItemDto[];
  timeline: OrderEventDto[];
  /** Which statuses this order may legally move to next. */
  allowedTransitions: OrderStatus[];
  /**
   * Where "undo the last change" would put this order, or null when there is
   * nothing left to take back.
   *
   * Computed here rather than in the browser so the undo stack has one
   * implementation. A panel that worked it out from the timeline itself would
   * be a second copy of the rule, free to disagree with the server about which
   * moves have already been undone — and the disagreement would only show up
   * as a button that says one thing and does another.
   */
  undoableTo: OrderStatus | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  returnedAt: string | null;
  updatedAt: string;
}

/**
 * What a customer gets back after placing an order.
 *
 * Deliberately minimal: an order number, the totals and what they bought. No
 * internal notes, no version token, no timeline. The response to an
 * unauthenticated POST is not a place to leak operational data.
 */
export interface OrderConfirmationDto {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  deliveryZone: DeliveryZone;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  items: Omit<OrderItemDto, "id" | "productId" | "variantId">[];
  placedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `includeCost` is opt-in, and deliberately so.
 *
 * This mapper also builds the customer's order-confirmation payload. A cost
 * field added unconditionally would ship the shop's buying price to the browser
 * of every person who checks out.
 */
export function toOrderItemDto(row: OrderItemRow, includeCost = false): OrderItemDto {
  return {
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    productName: row.productName,
    productSlug: row.productSlug,
    sku: row.sku,
    variantLabel: row.variantLabel,
    imageUrl: row.imageKey ? getStorage().url(row.imageKey) : null,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    lineTotal: row.lineTotal,
    ...(includeCost ? { unitCost: row.unitCost } : {}),
  };
}

export function toOrderEventDto(row: OrderEventRow): OrderEventDto {
  return {
    id: row.id,
    type: row.type,
    field: row.field,
    previousValue: row.previousValue,
    newValue: row.newValue,
    actorName: row.actorName,
    adminId: row.adminId,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

function listFields(row: OrderRow): OrderListItemDto {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    phone: row.phone,
    areaText: row.areaText,
    deliveryZone: row.deliveryZone,
    status: row.status,
    paymentMethod: row.paymentMethod,
    subtotal: row.subtotal,
    deliveryCharge: row.deliveryCharge,
    grandTotal: row.grandTotal,
    itemCount: row.itemCount,
    totalQuantity: row.totalQuantity,
    createdAt: row.createdAt.toISOString(),
    /* Null for every live order. The trash screen reads it to work out how
       many days are left before the purge takes it. */
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export function toOrderListItemDto(row: OrderRow): OrderListItemDto {
  return listFields(row);
}

/**
 * The status an undo would land on.
 *
 * Null unless the move to undo is the one that produced the order's current
 * status — if anything else has changed it since, the panel should not offer
 * an undo the API would refuse.
 */
function undoTargetOf(events: readonly OrderEventRow[], current: OrderStatus): OrderStatus | null {
  const undoable = pickUndoableStatusEvent(events);
  if (!undoable || undoable.newValue !== current) return null;

  const previous = undoable.previousValue;
  return typeof previous === "string" && ORDER_STATUS_VALUES.includes(previous)
    ? (previous as OrderStatus)
    : null;
}

export function toOrderDto(
  row: OrderRow,
  items: OrderItemRow[],
  events: OrderEventRow[],
  origin: { sameIp: SameIpSummary | null; blocked: OrderDto["blocked"] } = {
    sameIp: null,
    blocked: null,
  },
): OrderDto {
  return {
    ...listFields(row),
    address: row.address,
    customerIp: row.customerIp,
    sameIp: origin.sameIp,
    blocked: origin.blocked,
    internalNotes: row.internalNotes,
    source: row.source,
    cancellationReason: row.cancellationReason,
    version: row.version,
    /* Admin detail: the margin on this order is exactly the question the
       person looking at it is asking. */
    items: items.map((item) => toOrderItemDto(item, true)),
    /* Oldest first — a timeline reads as a story, not a feed. Sorted by the
       monotonic sequence: events from one edit can share a timestamp. */
    timeline: [...events].sort((a, b) => a.seq - b.seq).map(toOrderEventDto),
    allowedTransitions: ORDER_STATUS_TRANSITIONS[row.status],
    undoableTo: undoTargetOf(events, row.status),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOrderConfirmationDto(
  row: OrderRow,
  items: OrderItemRow[],
): OrderConfirmationDto {
  return {
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    phone: row.phone,
    address: row.address,
    areaText: row.areaText,
    deliveryZone: row.deliveryZone,
    status: row.status,
    paymentMethod: row.paymentMethod,
    subtotal: row.subtotal,
    deliveryCharge: row.deliveryCharge,
    grandTotal: row.grandTotal,
    items: items.map((item) => {
      const { id: _id, productId: _productId, variantId: _variantId, ...rest } =
        toOrderItemDto(item);
      return rest;
    }),
    placedAt: row.createdAt.toISOString(),
  };
}
