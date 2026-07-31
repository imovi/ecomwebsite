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

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body) {
      throw new CourierError(`Steadfast returned an unreadable response (${response.status}).`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new CourierError("Steadfast rejected the API key and secret. Check both in Settings.");
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
      const body = await call("/create_order", {
        method: "POST",
        body: {
          /* Their invoice field is our order number, which is what makes their
             panel and ours reconcilable by eye. */
          invoice: parcel.orderNumber,
          recipient_name: parcel.customerName,
          recipient_phone: parcel.phone,
          recipient_address: `${parcel.address}, ${parcel.areaText}`,
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
