import { createHash } from "node:crypto";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import type { StoreSettingsRow } from "../../db/schema/store-settings.js";

/**
 * Meta Conversions API — server-side event reporting.
 *
 * WHY THE SERVER SENDS PURCHASE
 * -----------------------------
 * A browser-only pixel loses a large share of conversions in Bangladesh: ad
 * blockers, the Facebook in-app browser, iOS tracking restrictions, and phones
 * that simply drop the request on a weak connection. Meta cannot optimise a
 * campaign for a conversion it never sees, so a purchase reported only from the
 * browser means paying for traffic while starving the algorithm of the one
 * signal that matters.
 *
 * Reported from here, it is a fact rather than a hope — the order is already
 * committed when the event fires.
 *
 * WHY IN THE API RATHER THAN THE STOREFRONT
 * -----------------------------------------
 * The access token is a secret, and it is configured from the admin dashboard,
 * which means it lives in this database. Sending the event from here keeps the
 * token in the one process that already has it: it never has to be handed to the
 * storefront over an internal endpoint, and there is no second copy to rotate.
 *
 * It also means an order placed through any client is reported, not just one
 * placed through the storefront UI.
 *
 * PRIVACY
 * -------
 * The phone number is SHA-256 hashed before it leaves this process — that is
 * what Meta matches on, and it means the plaintext never crosses the wire.
 * Nothing is sent at all unless tracking is enabled and both a pixel id and a
 * token are configured, so a development environment reports nothing by
 * accident.
 */

const log = createLogger("meta-capi");

const API_VERSION = "v21.0";

/** Bounded so a slow Meta endpoint cannot pile up in-flight requests. */
const TIMEOUT_MS = 5000;

export interface PurchaseEvent {
  /** Deduplication key. A retry cannot double-count a sale. */
  orderNumber: string;
  value: number;
  phone: string;
  contents: { id: string; quantity: number; itemPrice: number }[];
  eventTime: Date;
  /** Absolute URL of the page the conversion happened on, when known. */
  sourceUrl?: string;
}

/**
 * Normalises a Bangladeshi number to E.164 without the plus, then hashes it.
 *
 * The normalisation has to be exactly right or the match rate collapses:
 * `01712345678`, `+8801712345678` and `8801712345678` are one person but hash
 * to three different values.
 */
export function hashPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits === "") return null;

  let e164: string;
  if (digits.startsWith("880")) e164 = digits;
  else if (digits.startsWith("0")) e164 = `880${digits.slice(1)}`;
  else if (digits.length === 10) e164 = `880${digits}`;
  else e164 = digits;

  return createHash("sha256").update(e164).digest("hex");
}

export type TrackingConfig = Pick<
  StoreSettingsRow,
  "metaPixelId" | "metaCapiToken" | "metaTestEventCode" | "metaTrackingEnabled"
>;

export type ConfigProblem = "disabled" | "missing_pixel_id" | "missing_token";

/** Why nothing would be sent, or null when the configuration is complete. */
export function configProblem(config: TrackingConfig): ConfigProblem | null {
  if (config.metaPixelId.trim() === "") return "missing_pixel_id";
  if (config.metaCapiToken.trim() === "") return "missing_token";
  if (!config.metaTrackingEnabled) return "disabled";
  return null;
}

export interface SendOutcome {
  sent: boolean;
  /** Present when `sent` is false. */
  reason?: string;
  /** Meta's event receipt, useful for confirming a test event arrived. */
  eventsReceived?: number;
  fbTraceId?: string;
}

/**
 * Posts one event to Meta.
 *
 * Returns an outcome rather than throwing: every caller is a fire-and-forget
 * side effect on an already-committed order, and the dashboard's test button
 * wants the failure text to show the operator.
 */
async function send(
  config: TrackingConfig,
  event: Record<string, unknown>,
): Promise<SendOutcome> {
  const problem = configProblem(config);
  if (problem) {
    return {
      sent: false,
      reason:
        problem === "disabled"
          ? "Tracking is turned off in settings."
          : problem === "missing_pixel_id"
            ? "No Meta pixel id is configured."
            : "No Conversions API token is configured.",
    };
  }

  const body = {
    data: [event],
    ...(config.metaTestEventCode.trim() !== ""
      ? { test_event_code: config.metaTestEventCode.trim() }
      : {}),
    access_token: config.metaCapiToken,
  };

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${config.metaPixelId.trim()}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    log.error({ err: error }, "Meta event not delivered");
    return { sent: false, reason };
  }

  const text = await response.text();

  if (!response.ok) {
    /* Meta's error body names the field it rejected, which is the only useful
       thing to show an operator. Truncated — it can be very long, and the token
       is never echoed back in it. */
    log.error({ status: response.status, body: text.slice(0, 500) }, "Meta rejected event");
    return { sent: false, reason: `Meta rejected the event (${response.status}): ${text.slice(0, 300)}` };
  }

  let parsed: { events_received?: number; fbtrace_id?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    /* A 200 with an unparseable body still means delivered. */
  }

  return {
    sent: true,
    ...(parsed.events_received !== undefined ? { eventsReceived: parsed.events_received } : {}),
    ...(parsed.fbtrace_id !== undefined ? { fbTraceId: parsed.fbtrace_id } : {}),
  };
}

/** Reports a completed purchase. Never throws. */
export async function trackPurchase(
  event: PurchaseEvent,
  config?: TrackingConfig,
): Promise<SendOutcome> {
  const resolved = config ?? (await getSettings());

  const hashedPhone = hashPhone(event.phone);

  return send(resolved, {
    event_name: "Purchase",
    event_time: Math.floor(event.eventTime.getTime() / 1000),
    /* The order number is stable and unique, so a duplicate send — a retry, a
       replayed request — is collapsed by Meta into one conversion. */
    event_id: event.orderNumber,
    action_source: "website",
    ...(event.sourceUrl ? { event_source_url: event.sourceUrl } : {}),
    user_data: hashedPhone ? { ph: [hashedPhone] } : {},
    custom_data: {
      currency: "BDT",
      value: event.value,
      num_items: event.contents.reduce((sum, item) => sum + item.quantity, 0),
      contents: event.contents.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        item_price: item.itemPrice,
      })),
    },
  });
}

/**
 * Sends a harmless diagnostic event so the dashboard can prove the connection
 * works before any real money is spent on ads.
 *
 * Uses `TestEvent`, not `Purchase`: a fake purchase sent to a live pixel
 * pollutes the conversion data the campaign optimises on, and there is no way to
 * retract it.
 */
export async function sendTestEvent(config?: TrackingConfig): Promise<SendOutcome> {
  const resolved = config ?? (await getSettings());

  return send(resolved, {
    event_name: "TestEvent",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `gng-test-${Date.now()}`,
    action_source: "website",
    user_data: {},
  });
}
