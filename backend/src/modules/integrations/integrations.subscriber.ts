import { createLogger } from "../../core/logger.js";
import { orderEvents } from "../../lib/events/order-events.js";
import { getSettings } from "../settings/settings.service.js";
import { findAdminById } from "../admins/admin.repository.js";
import * as telegram from "./telegram.service.js";
import * as sheets from "./google-sheets.service.js";

/**
 * Order integrations: Telegram alerts and the Google Sheets export.
 *
 * Both hang off the order event bus, which already isolates handler failures —
 * a broken integration can never fail the checkout that triggered it. That
 * matters more here than for analytics: a shopper must not see an error because
 * a spreadsheet was unreachable.
 *
 * Settings are read once per event and shared by both destinations, so turning an
 * integration on in the dashboard takes effect on the next order rather than the
 * next restart, at the cost of one indexed single-row read.
 *
 * They run CONCURRENTLY. Sequentially, a slow Google would delay the Telegram
 * alert — and the alert is the one somebody is waiting on.
 */

const log = createLogger("integrations");

let unsubscribers: (() => void)[] = [];

export function registerOrderIntegrations(): void {
  if (unsubscribers.length > 0) return;

  unsubscribers.push(
    orderEvents.on("order.created", async (event) => {
      const settings = await getSettings();

      const [telegramOutcome, sheetsOutcome] = await Promise.all([
        telegram.notifyNewOrder(
          {
            orderNumber: event.orderNumber,
            customerName: event.customerName,
            phone: event.phone,
            address: event.address,
            areaText: event.areaText,
            deliveryZone: event.deliveryZone,
            subtotal: event.subtotal,
            deliveryCharge: event.deliveryCharge,
            grandTotal: event.grandTotal,
            items: event.contents.map((line) => ({
              name: line.name,
              variantLabel: line.variantLabel,
              quantity: line.quantity,
              lineTotal: line.lineTotal,
            })),
            note: event.customerNote,
          },
          settings,
        ),
        sheets.appendOrder(
          {
            orderNumber: event.orderNumber,
            placedAt: event.placedAt,
            customerName: event.customerName,
            phone: event.phone,
            address: event.address,
            areaText: event.areaText,
            deliveryZone: event.deliveryZone,
            items: event.contents.map((line) => ({
              name: line.name,
              variantLabel: line.variantLabel,
              quantity: line.quantity,
            })),
            subtotal: event.subtotal,
            deliveryCharge: event.deliveryCharge,
            grandTotal: event.grandTotal,
            status: "pending",
          },
          settings,
        ),
      ]);

      /* A switched-off integration is the normal state of a shop that has not
         connected one, so "not sent" is debug rather than an error. */
      log.debug(
        {
          orderNumber: event.orderNumber,
          telegram: telegramOutcome.sent ? "sent" : telegramOutcome.reason,
          sheets: sheetsOutcome.sent ? "sent" : sheetsOutcome.reason,
        },
        "Order integrations ran",
      );
    }),
  );

  unsubscribers.push(
    orderEvents.on("order.status_changed", async (event) => {
      const settings = await getSettings();

      /* Cheap exit before touching the database for the actor's name. */
      if (telegram.configProblem(settings) !== null) return;

      /* "By: …" is the point of this alert — it answers "who cancelled this?"
         without opening the panel. */
      const actor = event.adminId ? await findAdminById(event.adminId) : null;

      await telegram.notifyStatusChange(
        {
          orderNumber: event.orderNumber,
          customerName: event.customerName,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
          changedBy: actor?.name ?? "System",
        },
        settings,
      );
    }),
  );

  log.info("Order integrations registered (Telegram, Google Sheets)");
}

/** Test seam. */
export function unregisterOrderIntegrations(): void {
  for (const off of unsubscribers) off();
  unsubscribers = [];
}
