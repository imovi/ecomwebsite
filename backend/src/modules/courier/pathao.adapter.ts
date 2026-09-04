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
 * Pathao Courier.
 *
 * Two things make this harder than Steadfast, and both are handled here so
 * nothing outside this file has to care:
 *
 * 1. OAUTH. Access tokens expire. The token is cached in memory and re-minted
 *    a minute before expiry, so a parcel created at 3am does not fail because
 *    nobody refreshed anything.
 *
 * 2. NUMERIC AREAS. Pathao will not take a written address — it wants city,
 *    zone and area ids from its own tables. A Bangladeshi shopper types
 *    "Dhanmondi, Dhaka" in free text, so the address is resolved against
 *    Pathao's own lists by name, and the failure is reported as something the
 *    operator can fix ("Pathao does not recognise that area") rather than a
 *    validation error they cannot act on.
 */

const log = createLogger("courier:pathao");

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
  let cleaned = (address || "").trim();
  if (cleaned.length < 10) {
    const area = (areaText || "").trim();
    if (area && !cleaned.toLowerCase().includes(area.toLowerCase())) {
      cleaned = `${cleaned}, ${area}`;
    }
    if (cleaned.length < 10) {
      cleaned = cleaned ? `${cleaned}, Bangladesh` : "Dhaka, Bangladesh";
    }
  }
  return cleaned;
}

const DEFAULT_BASE_URL = "https://api-hermes.pathao.com";

interface PathaoConfig {
  clientId: string;
  clientSecret: string;
  storeId: string;
  baseUrl?: string | undefined;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export function createPathaoAdapter(config: PathaoConfig): CourierProviderAdapter {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");

  /* Per-adapter rather than module-level, so replacing the credentials in
     Settings cannot serve a token minted for the old ones. */
  let cached: CachedToken | null = null;

  async function request(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; token?: string },
  ): Promise<Record<string, unknown>> {
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(COURIER_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CourierError(
        error instanceof Error ? `Could not reach Pathao: ${error.message}` : "Network error",
        true,
      );
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    /* Status first, body second: a rejected credential comes back as HTML
       rather than JSON, and reporting that as "unreadable response (401)"
       reads like an outage instead of pointing at Settings. */
    if (response.status === 401) {
      /* Force a fresh token on the next call rather than failing every
         subsequent one with a stale credential. */
      cached = null;
      throw new CourierError("Pathao rejected the credentials. Check them in Settings.", true);
    }

    if (!body) {
      throw new CourierError(`Pathao returned an unreadable response (${response.status}).`);
    }

    if (!response.ok) {
      const message =
        typeof body.message === "string"
          ? body.message
          : `Pathao refused the request (${response.status}).`;

      /* Their field errors are the actionable part — usually a bad phone or an
         unrecognised area. */
      const errors = body.errors;
      const detail =
        errors && typeof errors === "object"
          ? Object.values(errors as Record<string, unknown>)
              .flat()
              .join(" ")
          : "";

      throw new CourierError(
        detail ? `${message} ${detail}`.trim() : message,
        response.status >= 500,
      );
    }

    return body;
  }

  async function accessToken(): Promise<string> {
    const now = Date.now();
    /* 60s of slack, so a token that expires mid-flight is replaced first. */
    if (cached && cached.expiresAt > now + 60_000) return cached.token;

    const body = await request("/aladdin/api/v1/issue-token", {
      method: "POST",
      body: {
        client_id: config.clientId.trim(),
        client_secret: config.clientSecret.trim(),
        grant_type: "client_credentials",
      },
    });

    const token = body.access_token;
    if (typeof token !== "string") {
      throw new CourierError("Pathao did not return an access token.");
    }

    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
    cached = { token, expiresAt: now + expiresIn * 1000 };

    return token;
  }

  /**
   * Turns free text into Pathao's numeric ids.
   *
   * Matches on name, longest-first, so "Dhanmondi" wins over a shorter zone
   * whose name happens to be a substring. A miss is reported plainly: the
   * operator can correct the area on the order and try again, which they cannot
   * do with "422 zone_id required".
   */
  async function resolveArea(
    areaText: string,
    addressText: string,
    token: string,
  ): Promise<{ cityId: number; zoneId: number; areaId: number | null }> {
    const areaHaystack = (areaText || "").toLowerCase();
    const fullHaystack = `${areaHaystack} ${(addressText || "").toLowerCase()}`;

    const cityBody = await request("/aladdin/api/v1/city-list", { method: "GET", token });
    const cities = extractList(cityBody);

    const city =
      cities.find((entry) => fullHaystack.includes(String(entry.name).toLowerCase())) ??
      /* Almost every order outside a recognised city is still served from
         Dhaka's hub, and that is a better guess than refusing outright. */
      cities.find((entry) => String(entry.name).toLowerCase() === "dhaka");

    if (!city) {
      throw new CourierError(`Pathao does not recognise a city in "${areaText}".`);
    }

    const zoneBody = await request(`/aladdin/api/v1/cities/${city.id}/zone-list`, {
      method: "GET",
      token,
    });
    const zones = extractList(zoneBody)
      .slice()
      .sort((a, b) => String(b.name).length - String(a.name).length);

    let zone = zones.find((entry) => areaHaystack.includes(String(entry.name).toLowerCase()));
    if (!zone) {
      zone = zones.find((entry) => fullHaystack.includes(String(entry.name).toLowerCase()));
    }

    if (!zone) {
      throw new CourierError(
        `Pathao does not recognise a delivery zone in "${areaText}". ` +
          "Edit the area on this order to a Pathao zone name and try again.",
      );
    }

    let areaId: number | null = null;
    try {
      const areaBody = await request(`/aladdin/api/v1/zones/${zone.id}/area-list`, {
        method: "GET",
        token,
      });
      const areas = extractList(areaBody);
      areaId = areas.find((entry) => fullHaystack.includes(String(entry.name).toLowerCase()))?.id ?? null;
    } catch {
      /* The area is optional for Pathao — the zone is enough to dispatch. */
      areaId = null;
    }

    return { cityId: city.id, zoneId: zone.id, areaId };
  }

  return {
    name: "pathao",

    async createParcel(parcel: ParcelRequest): Promise<ParcelCreated> {
      const phone = cleanPhone(parcel.phone);
      if (phone.length !== 11 || !phone.startsWith("01")) {
        throw new CourierError(
          `Recipient phone must be an 11-digit Bangladeshi mobile number starting with 01 (got "${parcel.phone}").`,
        );
      }

      const token = await accessToken();
      const area = await resolveArea(parcel.areaText, parcel.address, token);
      const address = normalizeAddress(parcel.address, parcel.areaText);

      const body = await request("/aladdin/api/v1/orders", {
        method: "POST",
        token,
        body: {
          store_id: Number(config.storeId),
          merchant_order_id: parcel.orderNumber,
          recipient_name: parcel.customerName.trim(),
          recipient_phone: phone,
          recipient_address: address,
          recipient_city: area.cityId,
          recipient_zone: area.zoneId,
          ...(area.areaId === null ? {} : { recipient_area: area.areaId }),
          delivery_type: 48,
          item_type: 2,
          item_quantity: parcel.totalQuantity,
          /* Their minimum billable weight. Anything lighter is charged as this
             anyway, so declaring less would only cause a reconciliation gap. */
          item_weight: 0.5,
          amount_to_collect: parcel.codAmount,
          item_description: parcel.itemDescription,
          ...(parcel.note ? { special_instruction: parcel.note } : {}),
        },
      });

      const data = (body.data ?? body) as Record<string, unknown>;
      const consignmentId = idOf(data.consignment_id);

      if (consignmentId === null) {
        throw new CourierError("Pathao accepted the request but returned no consignment id.");
      }

      log.info({ orderNumber: parcel.orderNumber, consignmentId }, "Parcel created");

      return {
        consignmentId,
        /* Pathao has no separate tracking code — the consignment id is what a
           customer types into their site. */
        trackingCode: consignmentId,
        codAmount:
          typeof data.amount_to_collect === "number"
            ? data.amount_to_collect
            : parcel.codAmount,
      };
    },

    async fetchStatus(consignmentId: string): Promise<ParcelStatus> {
      const token = await accessToken();
      const body = await request(
        `/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}/info`,
        { method: "GET", token },
      );

      const data = (body.data ?? body) as Record<string, unknown>;
      const raw =
        typeof data.order_status === "string"
          ? data.order_status
          : typeof data.status === "string"
            ? data.status
            : "";

      return { raw, mapped: mapStatus(raw) };
    },

    async verifyCredentials() {
      try {
        const token = await accessToken();
        /* Listing stores proves the token AND that the store id is usable —
           a valid token with the wrong store fails only at parcel creation
           otherwise, which is the worst moment to find out. */
        const body = await request("/aladdin/api/v1/stores", { method: "GET", token });
        const stores = extractList(body);
        const match = stores.find((entry) => String(entry.id) === config.storeId.trim());

        if (stores.length > 0 && !match) {
          return {
            ok: false,
            detail:
              `Connected, but store id ${config.storeId} was not found. ` +
              `Available: ${stores.map((s) => `${s.name} (${s.id})`).join(", ")}.`,
          };
        }

        return { ok: true, detail: match ? `Connected to "${match.name}".` : "Connected." };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof CourierError ? error.message : "Could not reach Pathao.",
        };
      }
    },
  };
}

/**
 * Pulls the list out of whichever envelope Pathao used.
 *
 * Their endpoints variously return `data`, `data.data`, or a bare array, and
 * the shape differs between the city, zone and store endpoints. One tolerant
 * reader beats three brittle ones.
 */
function extractList(body: Record<string, unknown>): { id: number; name: string }[] {
  const candidates: unknown[] = [
    body.data,
    (body.data as Record<string, unknown> | undefined)?.data,
    body,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    const mapped = candidate
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const id = row.city_id ?? row.zone_id ?? row.area_id ?? row.store_id ?? row.id;
        const name = row.city_name ?? row.zone_name ?? row.area_name ?? row.store_name ?? row.name;
        return typeof name === "string" && (typeof id === "number" || typeof id === "string")
          ? { id: Number(id), name }
          : null;
      })
      .filter((entry): entry is { id: number; name: string } => entry !== null);

    if (mapped.length > 0) return mapped;
  }

  return [];
}
