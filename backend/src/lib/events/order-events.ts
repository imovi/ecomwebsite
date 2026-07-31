import { EventEmitter } from "node:events";
import { createLogger } from "../../core/logger.js";
import type { DeliveryZone, OrderStatus } from "../../db/schema/order-enums.js";

/**
 * Domain event hooks.
 *
 * Notification transports — SMS, email, WhatsApp — are explicitly out of scope
 * for this phase, but the *seam* they will attach to belongs here now. Adding
 * a transport later must not mean editing the order service.
 *
 * Design points:
 *
 *  - **Typed payloads.** `on()` and `emit()` are narrowed by event name, so a
 *    future SMS subscriber cannot read a field the emitter never sends.
 *
 *  - **Emitted after commit, never inside a transaction.** A handler that
 *    sends an SMS must not be able to keep a database transaction open, and an
 *    SMS must never go out for an order that then rolls back.
 *
 *  - **Handler failures are contained.** A broken notification provider cannot
 *    fail the request that triggered it. Errors are logged and swallowed —
 *    the order is already committed and is the source of truth.
 */

const log = createLogger("events");

export interface OrderCreatedEvent {
  orderId: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  grandTotal: number;
  itemCount: number;
  /**
   * Line contents, for ad-platform conversion reporting.
   *
   * Carried on the event rather than re-queried by the subscriber: the order is
   * immutable at this instant, and a subscriber that re-reads it could pick up
   * an admin edit made moments later and report a value the customer never
   * agreed to.
   */
  contents: {
    sku: string;
    /** Product name as it was ordered, for a human-readable notification. */
    name: string;
    variantLabel: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];

  /* Delivery and money, carried for the same reason as `contents`: a subscriber
     that re-read the order could pick up an admin correction made seconds later
     and report figures the customer never agreed to. */
  address: string;
  areaText: string;
  deliveryZone: DeliveryZone;
  subtotal: number;
  deliveryCharge: number;
  customerNote: string | null;

  placedAt: Date;
}

export interface OrderStatusChangedEvent {
  orderId: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  previousStatus: OrderStatus;
  newStatus: OrderStatus;
  /** Null when the change was made by the system rather than a person. */
  adminId: string | null;
  changedAt: Date;
}

export interface OrderCustomerUpdatedEvent {
  orderId: string;
  orderNumber: string;
  phone: string;
  /** Which customer fields changed, e.g. `["phone", "address"]`. */
  changedFields: string[];
  adminId: string | null;
  updatedAt: Date;
}

export interface OrderEventMap {
  "order.created": OrderCreatedEvent;
  "order.status_changed": OrderStatusChangedEvent;
  "order.customer_updated": OrderCustomerUpdatedEvent;
}

export type OrderEventName = keyof OrderEventMap;

class TypedOrderEmitter {
  private readonly emitter = new EventEmitter();

  constructor() {
    /* Notifications will eventually mean several subscribers per event
       (SMS + email + a webhook). The default cap of 10 is a leak warning, not
       a limit we want to trip over legitimately. */
    this.emitter.setMaxListeners(50);
  }

  on<E extends OrderEventName>(
    event: E,
    handler: (payload: OrderEventMap[E]) => void | Promise<void>,
  ): () => void {
    const wrapped = (payload: OrderEventMap[E]): void => {
      /* Isolate every handler. One failing subscriber must not stop the
         others, and must never surface as a failed API request. */
      void (async () => {
        try {
          await handler(payload);
        } catch (error) {
          log.error({ err: error, event }, "Order event handler failed");
        }
      })();
    };

    this.emitter.on(event, wrapped as (...args: unknown[]) => void);
    return () => this.emitter.off(event, wrapped as (...args: unknown[]) => void);
  }

  /**
   * Publishes an event.
   *
   * Call this AFTER the transaction commits. Emitting inside one risks
   * notifying a customer about an order that is about to be rolled back.
   */
  emit<E extends OrderEventName>(event: E, payload: OrderEventMap[E]): void {
    log.debug({ event }, "Order event emitted");
    this.emitter.emit(event, payload);
  }

  /** Test seam — removes every subscriber. */
  removeAll(): void {
    this.emitter.removeAllListeners();
  }

  listenerCount(event: OrderEventName): number {
    return this.emitter.listenerCount(event);
  }
}

export const orderEvents = new TypedOrderEmitter();

/*
 * Attaching a transport later looks like this, and touches no existing file:
 *
 *   orderEvents.on("order.created", async (event) => {
 *     await sms.send(event.phone, `Order ${event.orderNumber} received.`);
 *   });
 *
 *   orderEvents.on("order.status_changed", async (event) => {
 *     if (event.newStatus === "shipped") { … }
 *   });
 */
