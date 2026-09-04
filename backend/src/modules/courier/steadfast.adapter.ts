import { createLogger } from "../../core/logger.js";
import {
  COURIER_TIMEOUT_MS,
  CourierError,
  mapStatus,
  type CourierProviderAdapter,
  type ParcelCreated,
  type ParcelRequest,
  type ParcelStatus,
} from "./provider.js";

/**
 * Steadfast Courier.
 *
 * The simplest of the Bangladeshi couriers to integrate: two static headers, a
 * written address rather than numeric area ids, and one endpoint each for
 * creating a parcel and reading its status. No token to refresh, which means
 * nothing to go stale at 3am.
 *
 * The one sharp edge is that it answers HTTP 200 with `status: 400` in the body
 * for validation failures, so the body has to be read on every response — a
 * check on `response.ok` alone would treat a rejected parcel as accepted and
 * leave an order marked shipped that no courier is carrying.
 */

const log = createLogger("courier:steadfast");

/**
 * Narrows a courier's id field to something storable.
 *
 * Couriers return the consignment id as a number or a string depending on the
 * endpoint, and occasionally nested inside another object. A bare `String()`
 * would turn that last case into "[object Object]" and the parcel could never
 * be tracked again — so anything that is not a number or a non-empty string is
 * treated as absent.
 */
function idOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

export function cleanPhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("01")) return digits;
  if (digits.length === 13 && digits.startsWith("8801")) return digits.slice(2);
  if (digits.length === 14 && digits.startsWith("8801")) return digits.slice(3);
  return digits;
}

export function normalizeAddress(address: string, areaText?: string): string {
  const parts = [address?.trim(), areaText?.trim()].filter(
    (s): s is string => Boolean(s && s !== "undefined"),
  );
  let combined = parts.join(", ");
  if (combined.length < 10) {
    combined = combined ? `${combined}, Bangladesh` : "Dhaka, Bangladesh";
  }
  return combined;
}

const DEFAULT_BASE_URL = "https://portal.packzy.com/api/v1";

interface SteadfastConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string | undefined;
}

export function createSteadfastAdapter(config: SteadfastConfig): CourierProviderAdapter {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");

  async function call(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<Record<string, unknown>> {
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          "Api-Key": config.apiKey.trim(),
          "Secret-Key": config.apiSecret.trim(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(COURIER_TIMEOUT_MS),
      });
    } catch (error) {
      /* Network-level: worth retrying later, so the sync does not give up on
         an otherwise healthy parcel. */
      throw new CourierError(
        error instanceof Error ? `Could not reach Steadfast: ${error.message}` : "Network error",
        true,
      );
    }

    /* Read as text first, then attempt JSON.
       Steadfast does not always answer in JSON: a refusal can arrive as a bare
       sentence like `Account is not active!` with a 401. Parsing straight to
       JSON discarded that sentence and left the panel saying "unreadable
       response (401)" — which reads like an outage and hides the one thing the
       owner needed to know. */
    const rawText = await response.text();

    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(rawText);
      body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }

    /* Whatever the courier said, in whichever shape it said it. HTML is
       excluded — an error page's markup is noise, not a message. */
    const courierMessage =
      typeof body?.message === "string" && body.message.trim() !== ""
        ? body.message.trim()
        : !rawText.trimStart().startsWith("<") && rawText.trim() !== "" && rawText.length <= 200
          ? rawText.trim()
          : "";

    if (response.status === 401 || response.status === 403) {
      /* A 401 here is NOT always a bad key pair — an account that authenticates
         fine for reads can still be barred from creating parcels, and telling
         the owner to re-check credentials that are correct sends them in
         circles. So the courier's own words lead when there are any. */
      throw new CourierError(
        courierMessage
          ? `Steadfast refused: ${courierMessage}. If the key pair is right, this is your Steadfast account rather than the settings here — contact them to activate it.`
          : "Steadfast rejected the API key and secret. Check both in Settings.",
      );
    }

    if (!body) {
      throw new CourierError(
        courierMessage
          ? `Steadfast refused: ${courierMessage}`
          : `Steadfast returned an unreadable response (${response.status}).`,
      );
    }

    /* The sharp edge: 200 with an error status inside. */
    const inner = typeof body.status === "number" ? body.status : response.status;
    if (inner >= 400) {
      const message =
        typeof body.message === "string"
          ? body.message
          : `Steadfast refused the request (${inner}).`;
      throw new CourierError(message, inner >= 500);
    }

    return body;
  }

  return {
    name: "steadfast",

    async createParcel(parcel: ParcelRequest): Promise<ParcelCreated> {
      const phone = cleanPhone(parcel.phone);
      if (phone.length !== 11 || !phone.startsWith("01")) {
        throw new CourierError(
          `Recipient phone must be an 11-digit Bangladeshi mobile number starting with 01 (got "${parcel.phone}").`,
        );
      }

      const address = normalizeAddress(parcel.address, parcel.areaText);

      const body = await call("/create_order", {
        method: "POST",
        body: {
          /* Their invoice field is our order number, which is what makes their
             panel and ours reconcilable by eye. */
          invoice: parcel.orderNumber,
          recipient_name: parcel.customerName.trim(),
          recipient_phone: phone,
          recipient_address: address,
          cod_amount: parcel.codAmount,
          note: parcel.note ?? parcel.itemDescription,
        },
      });

      const consignment = body.consignment as Record<string, unknown> | undefined;
      const consignmentId = idOf(consignment?.consignment_id);
      const trackingCode = consignment?.tracking_code;

      if (consignmentId === null) {
        throw new CourierError("Steadfast accepted the request but returned no consignment id.");
      }

      log.info({ orderNumber: parcel.orderNumber, consignmentId }, "Parcel created");

      return {
        consignmentId,
        trackingCode: typeof trackingCode === "string" ? trackingCode : "",
        codAmount:
          typeof consignment?.cod_amount === "number"
            ? consignment.cod_amount
            : parcel.codAmount,
      };
    },

    async fetchStatus(consignmentId: string): Promise<ParcelStatus> {
      const body = await call(`/status_by_cid/${encodeURIComponent(consignmentId)}`, {
        method: "GET",
      });

      const raw = typeof body.delivery_status === "string" ? body.delivery_status : "";
      return { raw, mapped: mapStatus(raw) };
    },

    async verifyCredentials() {
      try {
        /* The balance endpoint is the cheapest authenticated call they have —
           it proves the key pair without creating anything. */
        const body = await call("/get_balance", { method: "GET" });
        const balance = body.current_balance;

        return {
          ok: true,
          detail:
            typeof balance === "number"
              ? `Connected. Current Steadfast balance: ৳${balance.toLocaleString("en-US")}.`
              : "Connected.",
        };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof CourierError ? error.message : "Could not reach Steadfast.",
        };
      }
    },
  };
}
