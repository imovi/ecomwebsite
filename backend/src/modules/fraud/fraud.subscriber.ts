import { createLogger } from "../../core/logger.js";
import { orderEvents } from "../../lib/events/order-events.js";
import { isConfigured, report } from "./fraud.service.js";

/**
 * Looks the customer up as soon as an order arrives.
 *
 * WHY HERE AND NOT WHEN THE SCREEN ASKS
 * -------------------------------------
 * The order list shows a delivery rate on every row. Fetching that when the
 * list opens would mean fifty phone numbers against five merchant panels —
 * two hundred and fifty sign-ins to draw one screen, which is both unusable
 * and the fastest way to get the shop's courier accounts locked.
 *
 * So the list only ever reads what is already stored, and this is what stores
 * it: one lookup per order, once, at the moment the order is placed. By the
 * time anyone opens the list the answer is usually already there, and the
 * numbers that are not are the ones placed seconds ago.
 *
 * Attached to the same seam the Meta and Telegram transports use. Failure is
 * contained by the bus, and deliberately invisible: the customer's order has
 * already been taken, and nothing about it depends on what the couriers say.
 */

const log = createLogger("fraud-subscriber");

let unsubscribe: (() => void) | null = null;

export function registerFraudChecks(): void {
  if (unsubscribe) return;

  unsubscribe = orderEvents.on("order.created", async (event) => {
    /* Asked per event rather than cached at boot, so switching a courier on in
       Settings takes effect on the next order rather than after a restart. */
    if (!(await isConfigured())) return;

    const result = await report(event.phone);

    if (result) {
      /* The phone number is deliberately absent from this line: it identifies a
         customer, and a log file is the easiest place for that to end up
         somewhere it should not be. The order number is enough to find it. */
      log.info(
        {
          orderNumber: event.orderNumber,
          answered: result.aggregate.answered,
          asked: result.aggregate.asked,
          successRatio: result.aggregate.successRatio,
        },
        "Courier record checked for a new order",
      );
    }
  });
}

export function stopFraudChecks(): void {
  unsubscribe?.();
  unsubscribe = null;
}
