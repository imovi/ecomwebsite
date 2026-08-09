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
 * Every field that identifies a person — phone, name, city — is SHA-256 hashed
 * before it leaves this process. That is what Meta matches on, so the plaintext
 * never crosses the wire.
 *
 * Four fields are sent raw, and deliberately: the shopper's IP, their user
 * agent, and the `fbc` / `fbp` cookies. None of those is a hashed identifier
 * Meta holds a copy of — they are values Meta issued or observed itself and
 * compares literally. Hashing them would not protect anyone; it would silently
 * void the field.
 *
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

  /* --- Match keys ---------------------------------------------------------
     Every one of these is optional and every one that is present raises the
     chance Meta can tell whose order this was. See `buildUserData`. */

  /** As the customer wrote it. Split into first and last before hashing. */
  customerName?: string | null;
  /** Resolved city token — see `resolveCity`, not the raw area text. */
  city?: string | null;
  /** The SHOPPER's address, never this server's. Sent RAW. */
  clientIp?: string | null;
  /** The shopper's browser. Sent RAW. */
  userAgent?: string | null;
  /** `_fbc` cookie — the click that brought them. Sent RAW. */
  fbc?: string | null;
  /** `_fbp` cookie — the browser the pixel knows. Sent RAW. */
  fbp?: string | null;
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

/**
 * Hashes a plain-text match key.
 *
 * Deliberately NOT a generalisation of `hashPhone`. A phone is normalised to
 * E.164 without the plus; text is normalised by case and punctuation. Merging
 * the two into one clever function is how the phone rule quietly acquires an
 * extra `.replace()` one day and every phone match in the account stops
 * matching, with nothing to show for it but a number that drifted down.
 *
 * `removeSpaces` is the city rule: Meta compares a city after stripping spaces
 * as well as punctuation, so "Cox's Bazar" has to become `coxsbazar` here or it
 * is compared against a list it can never be on. Names keep their spaces.
 *
 * Returns null for anything that normalises to nothing. An empty string must
 * never be sent — it counts as a supplied key that cannot match, which is
 * strictly worse than not supplying one.
 */
export function hashField(
  value: string,
  options: { removeSpaces?: boolean } = {},
): string | null {
  const cleaned = value
    .toLowerCase()
    /* Keep letters and digits from any script — a name written in Bangla is
       still the customer's name — and drop everything else. */
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, options.removeSpaces ? "" : " ")
    .trim();

  return cleaned === "" ? null : createHash("sha256").update(cleaned).digest("hex");
}

/**
 * Splits a single free-text name into the two fields Meta matches on.
 *
 * The form collects one name, because that is how a person introduces
 * themselves on the phone, and Meta wants two. First token and LAST token: for
 * "Habibur Rahman" that is exactly right, and for a three-part name it is the
 * best available guess — the middle is the part a Facebook profile is least
 * likely to carry.
 *
 * A single-word name yields no surname, and that field is then omitted rather
 * than sent as a copy of the first.
 */
function splitName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

/**
 * Assembles the match keys.
 *
 * WHAT IS HASHED AND WHAT IS NOT
 * ------------------------------
 * Everything that identifies the person is hashed — Meta matches on the digest,
 * so the plaintext never has to leave this process.
 *
 * `client_ip_address`, `client_user_agent`, `fbc` and `fbp` are the exceptions
 * and they are sent RAW, because they are not personal identifiers Meta holds a
 * hashed copy of — they are things Meta issued or observed itself and compares
 * literally. Hashing them does not protect anyone; it silently destroys the
 * field, and the score falls for a change that looked like caution.
 *
 * Empty and unresolvable values are dropped entirely. A key that cannot match
 * is not a neutral addition.
 */
function buildUserData(event: PurchaseEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  const phone = hashPhone(event.phone);
  if (phone) {
    data.ph = [phone];
    /**
     * The same number again, as a stable customer identifier.
     *
     * This shop has no accounts — the phone IS the identity, and it is the only
     * thing that is the same person across two orders a month apart. Meta scores
     * `external_id` as its own match key, and it is what would let a future
     * browser-side event be stitched to this purchase.
     */
    data.external_id = [phone];
  }

  if (event.customerName) {
    const { first, last } = splitName(event.customerName);
    const fn = first ? hashField(first) : null;
    const ln = last ? hashField(last) : null;
    if (fn) data.fn = [fn];
    if (ln) data.ln = [ln];
  }

  if (event.city) {
    const ct = hashField(event.city, { removeSpaces: true });
    if (ct) data.ct = [ct];
  }

  /* Every order this shop takes is delivered inside Bangladesh — the delivery
     zones are "inside Dhaka" and "outside Dhaka". A constant, but a real one. */
  const country = hashField("bd", { removeSpaces: true });
  if (country) data.country = [country];

  /* RAW from here down. See the note above. */
  if (event.clientIp) data.client_ip_address = event.clientIp;
  if (event.userAgent) data.client_user_agent = event.userAgent;
  if (event.fbc) data.fbc = event.fbc;
  if (event.fbp) data.fbp = event.fbp;

  return data;
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
  /**
   * The event went to the Test Events console instead of counting.
   *
   * Reported because "sent" and "counted" are not the same thing, and a caller
   * that logs the first as if it were the second is telling the operator their
   * sales are being reported when they are not.
   */
  testMode?: boolean;
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

  /**
   * A test code diverts EVERY event, not just the dashboard's test button.
   *
   * That is what makes it useful — it is how an operator watches a real order
   * arrive in the Test Events console during setup — and it is also the most
   * expensive thing to leave switched on, because Meta does not count a test
   * event toward delivery or reporting. Every real sale placed while it is set
   * is a sale the campaign never learns from.
   *
   * The admin panel warns while it is on. This flag is so the outcome can say so
   * too: "sent" and "counted" are not the same thing, and a caller that reports
   * the first as the second hides the loss.
   */
  const testMode = config.metaTestEventCode.trim() !== "";

  const body = {
    data: [event],
    ...(testMode ? { test_event_code: config.metaTestEventCode.trim() } : {}),
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
    testMode,
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

  return send(resolved, {
    event_name: "Purchase",
    event_time: Math.floor(event.eventTime.getTime() / 1000),
    /* The order number is stable and unique, so a duplicate send — a retry, a
       replayed request — is collapsed by Meta into one conversion. */
    event_id: event.orderNumber,
    action_source: "website",
    ...(event.sourceUrl ? { event_source_url: event.sourceUrl } : {}),
    user_data: buildUserData(event),
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
