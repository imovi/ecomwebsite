import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { adCampaigns } from "../../db/schema/ad-campaigns.js";
import { products } from "../../db/schema/products.js";
import { orders } from "../../db/schema/orders.js";
import { orderItems } from "../../db/schema/order-items.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import { shopDay, type DateRange } from "../reports/profit.service.js";
import {
  campaignInsights,
  campaignMeta,
  MetaAdsError,
  testConnection,
  type CampaignInsights,
} from "./meta-ads.client.js";

/**
 * The campaigns a shop is running, and what they actually returned.
 *
 * WHAT THIS ADDS OVER ADS MANAGER
 * Meta can tell the shop what it spent and how many purchases it counted. It
 * cannot tell the shop how many of those purchases survived the doorstep,
 * because it never hears about a refused parcel. This service puts the two
 * halves together: spend from Meta, delivery from the shop's own orders.
 *
 * ATTRIBUTION IS BY PRODUCT, AND THE SCREEN SAYS SO
 * There is no honest way to tie an individual order back to a campaign id — an
 * order carries a click id, not the campaign that click came from. So a
 * campaign linked to a product is measured against that product's delivered
 * orders. It is a good answer for the common case (one campaign per product,
 * which is how these shops run) and it is an estimate for any other, which is
 * exactly how it is labelled.
 *
 * A campaign with no product linked reports Meta's numbers and nothing else,
 * rather than being quietly credited with a share of everything.
 */

const log = createLogger("ads");

/**
 * How long Meta's answer is reused.
 *
 * Insights do not settle for hours, so a fresher number is not a truer one, and
 * every render costs an API call against an account-wide rate limit shared with
 * whatever else the shop uses. Ten minutes is short enough that a budget change
 * shows up the same session.
 */
const CACHE_MS = 10 * 60 * 1000;

interface CacheEntry {
  at: number;
  value: CampaignInsights;
}

const insightsCache = new Map<string, CacheEntry>();

function cacheKey(campaignId: string, range: DateRange, rate: number): string {
  return `${campaignId}:${range.from}:${range.to}:${rate}`;
}

/** Dropped whenever the credentials or the rate change. */
export function clearInsightsCache(): void {
  insightsCache.clear();
}

/* -------------------------------------------------------------------------- */
/* Registered campaigns                                                       */
/* -------------------------------------------------------------------------- */

export interface AdCampaignDto {
  id: string;
  metaId: string;
  label: string;
  productId: string | null;
  productName: string | null;
  isActive: boolean;
  createdAt: string;
}

function toDto(row: {
  id: string;
  metaId: string;
  label: string;
  productId: string | null;
  isActive: boolean;
  createdAt: Date;
  productName: string | null;
}): AdCampaignDto {
  return {
    id: row.id,
    metaId: row.metaId,
    label: row.label,
    productId: row.productId,
    productName: row.productName,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCampaigns(): Promise<AdCampaignDto[]> {
  const rows = await getDb()
    .select({
      id: adCampaigns.id,
      metaId: adCampaigns.metaId,
      label: adCampaigns.label,
      productId: adCampaigns.productId,
      isActive: adCampaigns.isActive,
      createdAt: adCampaigns.createdAt,
      productName: products.name,
    })
    .from(adCampaigns)
    .leftJoin(products, eq(adCampaigns.productId, products.id))
    .orderBy(asc(adCampaigns.createdAt));

  return rows.map(toDto);
}

export async function addCampaign(input: {
  metaId: string;
  label?: string;
  productId?: string | null;
}): Promise<AdCampaignDto> {
  const metaId = input.metaId.replace(/\D+/g, "");
  if (metaId.length < 5) {
    throw new BadRequestError(
      "That does not look like a Meta campaign id. Copy the numeric Campaign ID from Ads Manager.",
    );
  }

  const existing = await getDb()
    .select({ id: adCampaigns.id })
    .from(adCampaigns)
    .where(eq(adCampaigns.metaId, metaId))
    .limit(1);

  if (existing[0]) {
    /* Named rather than swallowed: silently doing nothing on a duplicate looks
       identical to the save failing. */
    throw new ConflictError("That campaign is already on the list.");
  }

  const rows = await getDb()
    .insert(adCampaigns)
    .values({
      metaId,
      label: input.label?.trim() ?? "",
      productId: input.productId ?? null,
    })
    .returning();

  const row = rows[0]!;
  const product = row.productId
    ? await getDb()
        .select({ name: products.name })
        .from(products)
        .where(eq(products.id, row.productId))
        .limit(1)
    : [];

  return toDto({ ...row, productName: product[0]?.name ?? null });
}

export async function updateCampaign(
  id: string,
  patch: { label?: string; productId?: string | null; isActive?: boolean },
): Promise<AdCampaignDto> {
  const rows = await getDb()
    .update(adCampaigns)
    .set({
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.productId !== undefined ? { productId: patch.productId } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(adCampaigns.id, id))
    .returning();

  const row = rows[0];
  if (!row) throw new NotFoundError("That campaign is not on the list.");

  const product = row.productId
    ? await getDb()
        .select({ name: products.name })
        .from(products)
        .where(eq(products.id, row.productId))
        .limit(1)
    : [];

  return toDto({ ...row, productName: product[0]?.name ?? null });
}

export async function removeCampaign(id: string): Promise<void> {
  const rows = await getDb().delete(adCampaigns).where(eq(adCampaigns.id, id)).returning();
  if (!rows[0]) throw new NotFoundError("That campaign is not on the list.");
}

/* -------------------------------------------------------------------------- */
/* Credentials                                                                */
/* -------------------------------------------------------------------------- */

interface Credentials {
  token: string;
  adAccountId: string;
  usdRatePaisa: number;
}

async function credentials(): Promise<Credentials> {
  const settings = await getSettings();
  return {
    token: settings.metaAdsToken,
    adAccountId: settings.metaAdAccountId,
    usdRatePaisa: settings.usdRatePaisa,
  };
}

export async function testAdsConnection(): Promise<{
  id: string;
  name: string;
  currency: string;
  timezone: string;
}> {
  const { token, adAccountId } = await credentials();
  if (token === "" || adAccountId === "") {
    throw new MetaAdsError(
      "not_configured",
      "Add the ad account id and an ads_read token first.",
    );
  }
  return testConnection({ adAccountId, token });
}

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

export interface CampaignReport {
  campaign: AdCampaignDto;
  /** Meta's own name and status, when it could be asked. */
  name: string | null;
  status: string | null;
  /** Null when Meta could not be reached — the row still renders. */
  insights: CampaignInsights | null;
  /** Why the insights are missing, in words the shop can act on. */
  problem: string | null;
  /**
   * What the shop's own orders say about the linked product, over the same
   * range. Null when no product is linked — there is nothing to compare to.
   */
  delivered: {
    placed: number;
    delivered: number;
    settled: number;
    deliveredValue: number;
    deliveryRatePercent: number | null;
    /** Delivered taka ÷ Meta's spend. The number that decides anything. */
    trueRoas: number | null;
    /** Meta's own purchases against its own spend, for comparison. */
    metaRoas: number | null;
    costPerDelivered: number | null;
  } | null;
}

export interface AdsOverview {
  configured: boolean;
  /** Zero means the shop has not set one; every taka figure is then unusable. */
  usdRatePaisa: number;
  campaigns: CampaignReport[];
  totals: {
    spend: number;
    deliveredValue: number;
    trueRoas: number | null;
    metaPurchases: number;
  };
  /** Set when at least one campaign could not be fetched. */
  problem: string | null;
}

async function insightsFor(
  campaignId: string,
  range: DateRange,
  creds: Credentials,
): Promise<CampaignInsights> {
  const key = cacheKey(campaignId, range, creds.usdRatePaisa);
  const hit = insightsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const value = await campaignInsights({
    campaignId,
    from: range.from,
    to: range.to,
    token: creds.token,
    usdRatePaisa: creds.usdRatePaisa,
  });

  insightsCache.set(key, { at: Date.now(), value });
  return value;
}

/** What the shop's own orders say about one product across a range. */
async function productOutcome(
  productId: string,
  range: DateRange,
): Promise<{ placed: number; delivered: number; settled: number; deliveredValue: number }> {
  const rows = await getDb()
    .select({
      placed: sql<number>`count(distinct ${orders.id})`.mapWith(Number),
      delivered:
        sql<number>`count(distinct ${orders.id}) filter (where ${orders.status} = 'delivered')`.mapWith(
          Number,
        ),
      settled:
        sql<number>`count(distinct ${orders.id}) filter (where ${orders.status} in ('delivered', 'cancelled', 'returned'))`.mapWith(
          Number,
        ),
      deliveredValue:
        sql<number>`coalesce(sum(${orderItems.lineTotal}) filter (where ${orders.status} = 'delivered'), 0)`.mapWith(
          Number,
        ),
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orderItems.productId, productId),
        isNull(orders.deletedAt),
        gte(shopDay(orders.createdAt), sql`${range.from}::date`),
        lte(shopDay(orders.createdAt), sql`${range.to}::date`),
      ),
    );

  return rows[0] ?? { placed: 0, delivered: 0, settled: 0, deliveredValue: 0 };
}

function share(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function ratio(value: number, cost: number): number | null {
  if (cost <= 0) return null;
  return Math.round((value / cost) * 100) / 100;
}

export async function adsOverview(range: DateRange): Promise<AdsOverview> {
  const creds = await credentials();
  const campaigns = await listCampaigns();
  const configured = creds.token !== "" && creds.adAccountId !== "";

  if (!configured || campaigns.length === 0) {
    return {
      configured,
      usdRatePaisa: creds.usdRatePaisa,
      campaigns: campaigns.map((campaign) => ({
        campaign,
        name: null,
        status: null,
        insights: null,
        problem: configured ? null : "Meta is not connected yet.",
        delivered: null,
      })),
      totals: { spend: 0, deliveredValue: 0, trueRoas: null, metaPurchases: 0 },
      problem: configured ? null : "Meta is not connected yet.",
    };
  }

  /* Only the active ones cost an API call. A paused campaign still appears, so
     switching it back on does not mean finding the id again. */
  const active = campaigns.filter((campaign) => campaign.isActive);
  const productIds = [...new Set(active.map((c) => c.productId).filter((id): id is string => !!id))];

  const outcomes = new Map<string, Awaited<ReturnType<typeof productOutcome>>>();
  await Promise.all(
    productIds.map(async (id) => outcomes.set(id, await productOutcome(id, range))),
  );

  let firstProblem: string | null = null;

  const reports: CampaignReport[] = await Promise.all(
    campaigns.map(async (campaign): Promise<CampaignReport> => {
      if (!campaign.isActive) {
        return { campaign, name: null, status: "PAUSED_LOCALLY", insights: null, problem: null, delivered: null };
      }

      let insights: CampaignInsights | null = null;
      let name: string | null = null;
      let status: string | null = null;
      let problem: string | null = null;

      try {
        /* Both in one go: a campaign the token cannot see fails the same way
           for either call, and asking twice would double the rate-limit cost. */
        const [fetched, meta] = await Promise.all([
          insightsFor(campaign.metaId, range, creds),
          campaignMeta({ campaignId: campaign.metaId, token: creds.token }).catch(() => null),
        ]);
        insights = fetched;
        name = meta?.name ?? null;
        status = meta?.status ?? null;
      } catch (error) {
        problem =
          error instanceof MetaAdsError
            ? error.message
            : "Could not read this campaign from Meta.";
        firstProblem ??= problem;
        log.warn({ err: error, campaignId: campaign.metaId }, "Campaign insights failed");
      }

      const outcome = campaign.productId ? outcomes.get(campaign.productId) : undefined;
      const spend = insights?.spend ?? 0;

      return {
        campaign,
        name,
        status,
        insights,
        problem,
        delivered: outcome
          ? {
              placed: outcome.placed,
              delivered: outcome.delivered,
              settled: outcome.settled,
              deliveredValue: outcome.deliveredValue,
              deliveryRatePercent: share(outcome.delivered, outcome.settled),
              trueRoas: ratio(outcome.deliveredValue, spend),
              metaRoas:
                insights === null
                  ? null
                  : ratio(
                      Math.round((insights.purchaseValueRaw * creds.usdRatePaisa) / 100),
                      spend,
                    ),
              costPerDelivered:
                outcome.delivered > 0 && spend > 0
                  ? Math.round(spend / outcome.delivered)
                  : null,
            }
          : null,
      };
    }),
  );

  const spend = reports.reduce((sum, row) => sum + (row.insights?.spend ?? 0), 0);
  const deliveredValue = reports.reduce(
    (sum, row) => sum + (row.delivered?.deliveredValue ?? 0),
    0,
  );

  return {
    configured,
    usdRatePaisa: creds.usdRatePaisa,
    campaigns: reports,
    totals: {
      spend,
      deliveredValue,
      trueRoas: ratio(deliveredValue, spend),
      metaPurchases: reports.reduce((sum, row) => sum + (row.insights?.purchases ?? 0), 0),
    },
    problem: firstProblem,
  };
}

/** One campaign, for the screen reached by clicking its row. */
export async function campaignReport(id: string, range: DateRange): Promise<CampaignReport> {
  const rows = await getDb()
    .select({
      id: adCampaigns.id,
      metaId: adCampaigns.metaId,
      label: adCampaigns.label,
      productId: adCampaigns.productId,
      isActive: adCampaigns.isActive,
      createdAt: adCampaigns.createdAt,
      productName: products.name,
    })
    .from(adCampaigns)
    .leftJoin(products, eq(adCampaigns.productId, products.id))
    .where(eq(adCampaigns.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError("That campaign is not on the list.");

  const campaign = toDto(row);
  const creds = await credentials();

  if (creds.token === "" || creds.adAccountId === "") {
    return {
      campaign,
      name: null,
      status: null,
      insights: null,
      problem: "Meta is not connected yet.",
      delivered: null,
    };
  }

  let insights: CampaignInsights | null = null;
  let name: string | null = null;
  let status: string | null = null;
  let problem: string | null = null;

  try {
    const [fetched, meta] = await Promise.all([
      insightsFor(campaign.metaId, range, creds),
      campaignMeta({ campaignId: campaign.metaId, token: creds.token }).catch(() => null),
    ]);
    insights = fetched;
    name = meta?.name ?? null;
    status = meta?.status ?? null;
  } catch (error) {
    problem =
      error instanceof MetaAdsError ? error.message : "Could not read this campaign from Meta.";
  }

  const outcome = campaign.productId ? await productOutcome(campaign.productId, range) : null;
  const spend = insights?.spend ?? 0;

  return {
    campaign,
    name,
    status,
    insights,
    problem,
    delivered: outcome
      ? {
          placed: outcome.placed,
          delivered: outcome.delivered,
          settled: outcome.settled,
          deliveredValue: outcome.deliveredValue,
          deliveryRatePercent: share(outcome.delivered, outcome.settled),
          trueRoas: ratio(outcome.deliveredValue, spend),
          metaRoas:
            insights === null
              ? null
              : ratio(Math.round((insights.purchaseValueRaw * creds.usdRatePaisa) / 100), spend),
          costPerDelivered:
            outcome.delivered > 0 && spend > 0 ? Math.round(spend / outcome.delivered) : null,
        }
      : null,
  };
}

/* Kept so a future caller can prune campaigns for deleted products in bulk. */
export async function campaignsForProducts(productIds: string[]): Promise<AdCampaignDto[]> {
  if (productIds.length === 0) return [];
  const rows = await getDb()
    .select({
      id: adCampaigns.id,
      metaId: adCampaigns.metaId,
      label: adCampaigns.label,
      productId: adCampaigns.productId,
      isActive: adCampaigns.isActive,
      createdAt: adCampaigns.createdAt,
      productName: products.name,
    })
    .from(adCampaigns)
    .leftJoin(products, eq(adCampaigns.productId, products.id))
    .where(inArray(adCampaigns.productId, productIds));
  return rows.map(toDto);
}
