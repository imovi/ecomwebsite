import { ROLE_RANK, type AdminRole } from "../../db/schema/enums.js";
import {
  callListSize,
  parcelHealth,
  returnRate,
  shopDayBounds,
  sourceBreakdown,
  twoDayMoney,
  type DayMoney,
  type ParcelHealth,
  type ReturnRate,
  type SourceCount,
} from "./overview.repository.js";

/**
 * The dashboard summary.
 *
 * MONEY IS GATED HERE, NOT IN THE UI
 * ----------------------------------
 * The overview screen is what a `manager` on the order desk opens all day, and
 * revenue is not theirs to read — the reports module sits at `admin` for exactly
 * that reason. So the takings are omitted from the response for anyone below
 * `admin` rather than sent and hidden with CSS, because a field that reaches the
 * browser has been disclosed no matter what is drawn.
 */

/** How long a shipment may go unsynced before it counts as stuck. */
const PARCEL_STALE_HOURS = 24;

/** Window for the source split and the return rate. */
const TREND_DAYS = 30;
const RETURN_WINDOW_DAYS = 7;

export interface OverviewDto {
  /** Present only for `admin` and above. */
  money?: {
    today: DayMoney;
    yesterday: DayMoney;
  };
  sources: {
    windowDays: number;
    breakdown: SourceCount[];
  };
  parcels: ParcelHealth;
  callList: { abandonedOpen: number };
  returns: ReturnRate & { windowDays: number };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export async function summary(role: AdminRole): Promise<OverviewDto> {
  const showMoney = ROLE_RANK[role] >= ROLE_RANK.admin;

  /* Every aggregate is independent, so they go together rather than in a
     waterfall — this is the first screen of the panel and it should not take
     four round trips of database latency to draw. Both money days come from one
     query: the windows are contiguous, and reading the same rows twice on a
     two-core box is the kind of waste that only shows up under load. */
  const [money, sources, parcels, callList, returns] = await Promise.all([
    showMoney ? twoDayMoney(shopDayBounds(-1), shopDayBounds(0)) : Promise.resolve(null),
    sourceBreakdown(daysAgo(TREND_DAYS)),
    parcelHealth(new Date(Date.now() - PARCEL_STALE_HOURS * 3_600_000)),
    callListSize(),
    returnRate(daysAgo(RETURN_WINDOW_DAYS)),
  ]);

  return {
    ...(money ? { money } : {}),
    sources: { windowDays: TREND_DAYS, breakdown: sources },
    parcels,
    callList,
    returns: { ...returns, windowDays: RETURN_WINDOW_DAYS },
  };
}
