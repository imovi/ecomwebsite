import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Order enumerations.
 */

/**
 * Order lifecycle.
 *
 * The two terminal failure states are distinct on purpose: `cancelled` means
 * the order never shipped, `returned` means it shipped and came back. They
 * have different stock consequences, different reporting meaning, and — on a
 * cash-on-delivery store — very different cost.
 */
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
]);

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

/**
 * Legal transitions.
 *
 * Encoded as data rather than scattered `if` statements so the rules are
 * auditable in one place and the API can tell a client exactly which moves are
 * available from the current state.
 *
 * Notable edges:
 *   - Cancellation is possible up to and including `packed`. Once `shipped`,
 *     the parcel is with the courier and the only failure path is `returned`.
 *   - `delivered` can still become `returned` — a customer can refuse or send
 *     an item back after a successful delivery.
 *   - `cancelled` and `returned` are terminal.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

/**
 * Statuses at which the goods have left the building.
 *
 * Stock was already decremented at placement; these are the states where
 * cancelling can no longer simply put it back, and where editing quantities
 * stops being safe.
 */
export const DISPATCHED_STATUSES: readonly OrderStatus[] = ["shipped", "delivered", "returned"];

/** Statuses that release reserved stock back to the catalogue. */
export const STOCK_RELEASING_STATUSES: readonly OrderStatus[] = ["cancelled", "returned"];

/** Terminal states — no further transition is possible. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ["delivered", "cancelled", "returned"];

/**
 * Payment methods.
 *
 * Only cash on delivery today. Modelled as an enum from the start so adding
 * bKash or a card gateway later is an `ALTER TYPE` plus a settlement column,
 * not a migration of every existing row from a boolean.
 */
export const paymentMethodEnum = pgEnum("payment_method", ["cod"]);
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];

/**
 * Delivery zones.
 *
 * The whole delivery-charge model for a Bangladeshi store reduces to this one
 * distinction, and couriers price on exactly it.
 */
export const deliveryZoneEnum = pgEnum("delivery_zone", ["inside_dhaka", "outside_dhaka"]);
export type DeliveryZone = (typeof deliveryZoneEnum.enumValues)[number];

/**
 * Timeline actions.
 *
 * An enum rather than free text: the timeline is an audit record, and a typo
 * in an action name silently creates a category nobody can filter on later.
 */
export const orderEventTypeEnum = pgEnum("order_event_type", [
  "order_created",
  "status_changed",
  "customer_updated",
  "address_updated",
  "phone_updated",
  "quantity_updated",
  "variant_updated",
  "item_removed",
  "delivery_charge_updated",
  "totals_recalculated",
  "note_added",
  "order_cancelled",
  "order_delivered",
  "order_returned",
]);

export type OrderEventType = (typeof orderEventTypeEnum.enumValues)[number];
