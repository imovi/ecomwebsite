import { asJson, pick, request } from "./http.js";
import { credentialsRejected, upstreamFailed } from "./errors.js";
import {
  count,
  ratio,
  type CourierStat,
  type FraudCredentials,
  type FraudProvider,
} from "./types.js";

const NAME = "BD Courier";
const URL = "https://api.bdcourier.com/courier-check";

/**
 * BD Courier aggregator API integration.
 *
 * Checks delivery history across all major couriers (Pathao, Steadfast,
 * RedX, PaperFly, CarryBee, ParcelDex, CourrierFast) with a single API call.
 */
export const bdcourier: FraudProvider = {
  name: NAME,
  identifierLabel: "BD Courier API Key",
  secretLabel: "API Key (or leave blank if entered above)",
  hint: "Bearer API key from api.bdcourier.com (Profile -> API Key)",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    const rawKey = (credentials.secret || credentials.identifier || "").trim();
    const apiKey = rawKey.replace(/^Bearer\s+/i, "");

    if (!apiKey) {
      throw credentialsRejected(NAME, "BD Courier API Key is required.");
    }

    const res = await request(NAME, URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ phone }),
    });

    if (res.status === 401 || res.status === 403) {
      throw credentialsRejected(NAME, "Invalid BD Courier API Key or subscription inactive.");
    }

    if (res.status !== 200) {
      throw upstreamFailed(NAME, `BD Courier returned HTTP ${res.status}`);
    }

    const json = asJson(NAME, res.body);
    if (json.status && json.status !== "success") {
      const msg = typeof json.message === "string" ? json.message : "BD Courier check failed.";
      throw upstreamFailed(NAME, msg);
    }

    const data = (pick(json, "data") || {}) as Record<string, unknown>;
    const summary = (data.summary || {}) as Record<string, unknown>;

    const total = count(summary.total_parcel);
    const success = count(summary.success_parcel);
    const cancel = count(summary.cancelled_parcel);
    const successRatio =
      typeof summary.success_ratio === "number"
        ? Math.round(summary.success_ratio * 100) / 100
        : ratio(success, total);

    // Extract sub-courier breakdowns
    const breakdown: {
      courier: string;
      label: string;
      success: number;
      cancel: number;
      total: number;
      successRatio: number;
    }[] = [];

    const courierKeys = [
      { key: "steadfast", label: "SteadFast" },
      { key: "pathao", label: "Pathao" },
      { key: "redx", label: "RedX" },
      { key: "paperfly", label: "PaperFly" },
      { key: "carrybee", label: "CarryBee" },
      { key: "parceldex", label: "ParcelDex" },
      { key: "courrierfast", label: "CourierFast" },
    ];

    for (const c of courierKeys) {
      const item = data[c.key];
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const cTotal = count(row.total_parcel);
        const cSuccess = count(row.success_parcel);
        const cCancel = count(row.cancelled_parcel);
        const cRatio =
          typeof row.success_ratio === "number"
            ? Math.round(row.success_ratio * 100) / 100
            : ratio(cSuccess, cTotal);

        if (cTotal > 0 || cSuccess > 0 || cCancel > 0) {
          breakdown.push({
            courier: c.key,
            label: typeof row.name === "string" ? row.name : c.label,
            success: cSuccess,
            cancel: cCancel,
            total: cTotal,
            successRatio: cRatio,
          });
        }
      }
    }

    // Extract merchant fraud complaints
    const rawReports = Array.isArray(json.reports) ? json.reports : [];
    const reports = rawReports.map((r: unknown) => {
      const row = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return {
        details: String(row.details || row.name || "Reported by merchant"),
        courierName: typeof row.courierName === "string" ? row.courierName : undefined,
        createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
      };
    });

    let rating: string | undefined = undefined;
    if (reports.length > 0) {
      rating = `${reports.length} Merchant Report${reports.length > 1 ? "s" : ""}`;
    }

    return {
      success,
      cancel,
      total,
      successRatio,
      rating,
      breakdown,
      reports,
    };
  },
};
