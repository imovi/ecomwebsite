import { getStorage } from "../../lib/storage/index.js";
import type { OrderRow } from "../../db/schema/orders.js";
import type { OrderItemRow } from "../../db/schema/order-items.js";
import type { OrderEventRow } from "../../db/schema/order-events.js";
import {
  ORDER_STATUS_TRANSITIONS,
  type DeliveryZone,
  type OrderStatus,
  type PaymentMethod,
} from "../../db/schema/order-enums.js";

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
}

export interface OrderDto extends OrderListItemDto {
  address: string;
  internalNotes: string | null;
  cancellationReason: string | null;
  version: number;
  items: OrderItemDto[];
  timeline: OrderEventDto[];
  /** Which statuses this order may legally move to next. */
  allowedTransitions: OrderStatus[];
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

export function toOrderItemDto(row: OrderItemRow): OrderItemDto {
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
  };
}

export function toOrderListItemDto(row: OrderRow): OrderListItemDto {
  return listFields(row);
}

export function toOrderDto(
  row: OrderRow,
  items: OrderItemRow[],
  events: OrderEventRow[],
): OrderDto {
  return {
    ...listFields(row),
    address: row.address,
    internalNotes: row.internalNotes,
    cancellationReason: row.cancellationReason,
    version: row.version,
    items: items.map(toOrderItemDto),
    /* Oldest first — a timeline reads as a story, not a feed. Sorted by the
       monotonic sequence: events from one edit can share a timestamp. */
    timeline: [...events].sort((a, b) => a.seq - b.seq).map(toOrderEventDto),
    allowedTransitions: ORDER_STATUS_TRANSITIONS[row.status],
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
