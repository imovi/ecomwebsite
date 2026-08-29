import { createLogger } from "../../core/logger.js";

/**
 * Reading spend and results back out of Meta.
 *
 * The Conversions API client in `marketing` writes events TO Meta. This one
 * reads FROM it, needs a different permission (`ads_read`) and therefore a
 * different token, and is treated with more suspicion: everything it returns is
 * somebody else's data, arriving over somebody else's network, and none of it
 * is allowed to take a report down.
 *
 * THREE RULES
 *
 * 1. A failure is reported, never guessed at. An unreachable Meta, an expired
 *    token and a campaign that does not exist are three different problems with
 *    three different fixes, and collapsing them into "no data" leaves an owner
 *    with a blank screen and nothing to do about it.
 *
 * 2. Money arrives as a decimal string in the account's currency and is
 *    converted to whole taka HERE, once, at the shop's own recorded rate.
 *    Nothing downstream ever sees a float or a dollar.
 *
 * 3. Every call has a deadline. The report is rendered inside an admin request,
 *    and a Meta that accepts the connection and then thinks about it for a
 *    minute would hold the page open for a minute.
 */

const log = createLogger("meta-ads");

/** Pinned. A version Meta retires stops working loudly rather than drifting. */
const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Longer than the storefront's, shorter than a shop owner's patience. */
const TIMEOUT_MS = 12_000;

export type MetaAdsFailure =
  | "not_configured"
  | "unauthorised"
  | "not_found"
  | "rate_limited"
  | "unreachable"
  | "bad_response";

export class MetaAdsError extends Error {
  constructor(
    readonly kind: MetaAdsFailure,
    message: string,
  ) {
    super(message);
    this.name = "MetaAdsError";
  }
}

/** What one campaign did over one date range, already in taka. */
export interface CampaignInsights {
  /** Whole taka, converted at the shop's recorded rate. */
  spend: number;
  /** The untouched figure Meta returned, and what currency it was in. */
  spendRaw: number;
  currency: string;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  /** Percent, one decimal. */
  ctr: number | null;
  /** Taka. */
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  /** Purchases as Meta counts them — at order placement, not delivery. */
  purchases: number;
  purchaseValueRaw: number;
}

export interface CampaignMeta {
  id: string;
  name: string;
  status: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
}

/* -------------------------------------------------------------------------- */

async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  /* In the query string because Meta's API takes it there, and this request
     never leaves the server — it is not a URL anybody can see or log-scrape. */
  url.searchParams.set("access_token", token);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    /* A timeout and a DNS failure are the same thing to the shop: Meta could
       not be asked. The distinction is in the log, not on the screen. */
    log.warn({ err: error, path }, "Meta ads request did not complete");
    throw new MetaAdsError("unreachable", "Could not reach Meta. Try again in a moment.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MetaAdsError("bad_response", "Meta returned something that was not a report.");
  }

  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: number; type?: string } }).error;
    const code = error?.code;

    /* Meta's own codes, mapped to what the shop can actually do about it. */
    if (response.status === 401 || code === 190) {
      throw new MetaAdsError(
        "unauthorised",
        "Meta rejected the access token. It may have expired or lost its ads_read permission.",
      );
    }
    if (code === 4 || code === 17 || code === 613 || response.status === 429) {
      throw new MetaAdsError(
        "rate_limited",
        "Meta is rate limiting this ad account. The figures shown are the last ones fetched.",
      );
    }
    if (response.status === 404 || code === 803) {
      throw new MetaAdsError(
        "not_found",
        "Meta does not know that campaign id, or this token cannot see it.",
      );
    }

    log.warn({ status: response.status, error, path }, "Meta ads request refused");
    throw new MetaAdsError("bad_response", error?.message ?? "Meta refused the request.");
  }

  return body as T;
}

/* -------------------------------------------------------------------------- */

/** A decimal string from Meta to whole taka, at the shop's own rate. */
function toTaka(amount: string | number | undefined, usdRatePaisa: number): number {
  const value = typeof amount === "number" ? amount : Number.parseFloat(amount ?? "0");
  if (!Number.isFinite(value)) return 0;
  /* Rate is paisa per dollar, so dividing by 100 once puts the product back in
     taka. Rounded at the end rather than per component — rounding a per-day
     figure and then summing thirty of them drifts by up to thirty taka. */
  return Math.round((value * usdRatePaisa) / 100);
}

/**
 * A field from Meta's JSON as a string.
 *
 * Anything that is not already a string or a number becomes "" rather than
 * "[object Object]": a shape change at Meta should leave a field blank on the
 * screen, not print an implementation detail into the shop's admin panel.
 */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(str(value) || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Pulls out one action type from Meta's `actions` array.
 *
 * The array is a list of `{ action_type, value }` and the purchase entry is
 * named differently depending on how the pixel was set up — `purchase` for the
 * standard event, `offsite_conversion.fb_pixel_purchase` for the pixel one.
 * Both are checked because a shop that fires the standard event and a shop
 * using the pixel event should both see their purchases.
 */
function actionValue(actions: unknown, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  /* Narrowed before use rather than cast at the point of reading: `find` on an
     `unknown[]` hands back `any`, and one `any` escaping here would disable
     type checking on everything downstream of it. */
  const entries = actions as { action_type?: unknown; value?: unknown }[];
  for (const type of types) {
    const hit = entries.find((entry) => str(entry?.action_type) === type);
    if (hit) return num(hit.value);
  }
  return 0;
}

/* -------------------------------------------------------------------------- */

/**
 * What a campaign did between two dates.
 *
 * `time_range` rather than a preset, so the range matches the rest of the
 * report exactly. Meta interprets those dates in the AD ACCOUNT's timezone,
 * which for a shop here is set to Dhaka — the same day boundary the orders use.
 */
export async function campaignInsights(input: {
  campaignId: string;
  from: string;
  to: string;
  token: string;
  usdRatePaisa: number;
}): Promise<CampaignInsights> {
  const data = await graph<{ data?: Record<string, unknown>[] }>(
    `/${input.campaignId}/insights`,
    {
      fields:
        "spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,cpm,frequency,actions,action_values,account_currency",
      time_range: JSON.stringify({ since: input.from, until: input.to }),
      level: "campaign",
    },
    input.token,
  );

  /* No rows is a real answer, not a failure: a campaign that spent nothing in
     the range returns an empty array. Zeroes are the honest reading. */
  const row = data.data?.[0];
  if (!row) {
    return {
      spend: 0,
      spendRaw: 0,
      currency: "",
      impressions: 0,
      reach: 0,
      clicks: 0,
      linkClicks: 0,
      ctr: null,
      cpc: null,
      cpm: null,
      frequency: null,
      purchases: 0,
      purchaseValueRaw: 0,
    };
  }

  const spendRaw = num(row.spend);

  return {
    spend: toTaka(spendRaw, input.usdRatePaisa),
    spendRaw,
    currency: str(row.account_currency),
    impressions: Math.round(num(row.impressions)),
    reach: Math.round(num(row.reach)),
    clicks: Math.round(num(row.clicks)),
    linkClicks: Math.round(num(row.inline_link_clicks)),
    ctr: row.ctr === undefined ? null : Math.round(num(row.ctr) * 10) / 10,
    cpc: row.cpc === undefined ? null : toTaka(num(row.cpc), input.usdRatePaisa),
    cpm: row.cpm === undefined ? null : toTaka(num(row.cpm), input.usdRatePaisa),
    frequency: row.frequency === undefined ? null : Math.round(num(row.frequency) * 100) / 100,
    purchases: Math.round(
      actionValue(row.actions, ["purchase", "offsite_conversion.fb_pixel_purchase"]),
    ),
    purchaseValueRaw: actionValue(row.action_values, [
      "purchase",
      "offsite_conversion.fb_pixel_purchase",
    ]),
  };
}

/** The campaign's own name and status, so the panel is not a list of digits. */
export async function campaignMeta(input: {
  campaignId: string;
  token: string;
}): Promise<CampaignMeta> {
  const row = await graph<Record<string, unknown>>(
    `/${input.campaignId}`,
    { fields: "id,name,effective_status,daily_budget,lifetime_budget" },
    input.token,
  );

  return {
    id: str(row.id) || input.campaignId,
    name: str(row.name),
    status: str(row.effective_status),
    /* Budgets come back in minor units of the account currency — cents — so
       they are NOT run through toTaka, which expects a major-unit decimal. */
    dailyBudget: row.daily_budget === undefined ? null : Math.round(num(row.daily_budget)),
    lifetimeBudget:
      row.lifetime_budget === undefined ? null : Math.round(num(row.lifetime_budget)),
  };
}

/**
 * Proves a token works, without changing anything.
 *
 * Asks the ad account for its own name and currency: the cheapest call that
 * fails in all the ways a misconfiguration can — bad token, wrong account,
 * missing permission — and returns something an owner can recognise as theirs
 * when it succeeds.
 */
export async function testConnection(input: {
  adAccountId: string;
  token: string;
}): Promise<{ id: string; name: string; currency: string; timezone: string }> {
  const row = await graph<Record<string, unknown>>(
    `/${input.adAccountId}`,
    { fields: "id,name,currency,timezone_name,account_status" },
    input.token,
  );

  return {
    id: str(row.id) || input.adAccountId,
    name: str(row.name),
    currency: str(row.currency),
    timezone: str(row.timezone_name),
  };
}
