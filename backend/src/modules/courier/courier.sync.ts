import { createLogger } from "../../core/logger.js";
import { syncOpenShipments } from "./courier.service.js";

/**
 * Keeps parcel statuses fresh without anyone clicking.
 *
 * This is the half of the courier integration that fixes the accounting rather
 * than the typing. The profit report counts revenue from `delivered_at`, so
 * before this existed an order that really was delivered but never marked
 * showed as zero income and sat in "on the way" indefinitely. Now the courier
 * decides, on a timer.
 *
 * WHY POLLING RATHER THAN WEBHOOKS
 * Neither Steadfast nor Pathao can be relied on to call an arbitrary URL for a
 * small merchant, and a webhook needs a publicly reachable endpoint plus
 * signature verification to be safe. Polling every few minutes is unglamorous,
 * costs a handful of requests, and cannot silently stop working because someone
 * changed a URL.
 *
 * `unref()` matters: a live timer would hold the process open and turn every
 * deploy into a shutdown that has to be forced.
 */

const log = createLogger("courier:sync");

/** Frequent enough that a delivery shows up within the hour it happened. */
const INTERVAL_MS = 10 * 60_000;

/** Nothing is re-checked more often than this, however often the timer fires. */
const STALE_MINUTES = 20;

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  /* A slow courier must not let two passes overlap and double the request
     count against an API that is already struggling. */
  if (running) return;
  running = true;

  try {
    await syncOpenShipments({ staleMinutes: STALE_MINUTES });
  } catch (error) {
    /* Swallowed on purpose: this runs unattended, and an unhandled rejection
       here would take the whole API down over a courier being briefly
       unreachable. */
    log.error({ err: error }, "Courier sync pass failed");
  } finally {
    running = false;
  }
}

export function startCourierSync(): void {
  if (timer) return;

  timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref();

  log.info({ everyMinutes: INTERVAL_MS / 60_000 }, "Courier status sync started");
}

export function stopCourierSync(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
