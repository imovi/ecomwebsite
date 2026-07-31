import { config } from "../../config/index.js";
import { createLogger } from "../../core/logger.js";
import { orderEvents } from "../../lib/events/order-events.js";
import { trackPurchase } from "./meta-capi.service.js";

/**
 * Meta Conversions API transport.
 *
 * This is the first real subscriber on the order event bus, and it is
 * deliberately shaped the way that file describes: it attaches to the seam and
 * touches nothing in the order service.
 *
 * Registered once at boot. The event bus already isolates handler failures — a
 * rejected event is logged and swallowed — so an outage at Meta cannot turn a
 * placed order into a failed request.
 */

const log = createLogger("meta-subscriber");

let unsubscribe: (() => void) | null = null;

export function registerMetaTracking(): void {
  if (unsubscribe) return;

  unsubscribe = orderEvents.on("order.created", async (event) => {
    /* Settings are read per event rather than cached at boot: the owner turns
       tracking on from the dashboard, and that must take effect on the next
       order rather than after a restart. One indexed single-row read. */
    const outcome = await trackPurchase({
      orderNumber: event.orderNumber,
      value: event.grandTotal,
      phone: event.phone,
      contents: event.contents.map((line) => ({
        id: line.sku,
        quantity: line.quantity,
        itemPrice: line.unitPrice,
      })),
      eventTime: event.placedAt,
      /* The conversion happened on the storefront, not on this API. */
      sourceUrl: `${config.marketing.storefrontUrl}/checkout`,
    });

    if (outcome.sent) {
      log.info({ orderNumber: event.orderNumber }, "Purchase reported to Meta");
    } else {
      /* Not an error when tracking is simply switched off — that is the normal
         state of a shop that has not connected an ad account yet. */
      log.debug(
        { orderNumber: event.orderNumber, reason: outcome.reason },
        "Purchase not reported to Meta",
      );
    }
  });

  log.info("Meta Conversions API transport registered");
}

/** Test seam. */
export function unregisterMetaTracking(): void {
  unsubscribe?.();
  unsubscribe = null;
}
