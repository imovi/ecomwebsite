import { createLogger } from "../../core/logger.js";
import { recomputeTrendingScores, resetRecentSalesWindow } from "./metrics.service.js";

/**
 * Keeps the trending score meaning something.
 *
 * `recomputeTrendingScores()` was written to run on a schedule and nothing ran
 * it. `trending_score` therefore stayed at its column default of zero for every
 * product ever created, and the homepage rail — which orders by that score and
 * falls back to `created_at` — quietly served "newest" under the heading
 * "Trending", forever. Nothing errored, no query was slow, and the only way to
 * notice was to observe that a product nobody had bought or viewed still ranked
 * above one that was selling.
 *
 * The score is a decay function of age, so it is wrong the moment it is written
 * and has to be refreshed rather than computed once. Hourly is ample: the
 * freshness term halves over three weeks, and sales move the ranking far faster
 * than an hour of drift can.
 *
 * WHY THE WINDOW IS RESET
 * -----------------------
 * `units_sold_recent` is the dominant term and it only ever grows. Left
 * unreset it converges on the all-time total, and "Trending" degenerates into
 * "Best Selling with a freshness bonus" — last winter's hit outranking the
 * thing selling today. Zeroing it weekly is what makes "recent" true.
 *
 * The tradeoff is deliberate and visible: for a day or so after each reset the
 * ranking is driven by freshness and views alone, until sales accumulate again.
 * That is the behaviour the scoring was designed around; the alternative — a
 * gradual decay of the window — ranks more smoothly but no longer matches what
 * `units_sold_recent` claims to be.
 *
 * `unref()` on the timer, like the courier sync and the Telegram scheduler: a
 * live timer holds the process open and turns every deploy into a shutdown that
 * has to be forced.
 */

const log = createLogger("products:metrics");

/** Often enough that the age decay never visibly lags, cheap enough to ignore. */
const RECOMPUTE_INTERVAL_MS = 60 * 60_000;

/** Dhaka, so "a week" turns over during the shop's own quiet hours. */
const SHOP_OFFSET_MS = 6 * 60 * 60_000;

/** Rolling window length. */
const WINDOW_DAYS = 7;

/**
 * Reset at 4am local, the quietest hour on a Bangladeshi storefront.
 *
 * Doing it on a fixed weekday-and-hour rather than "every 168 hours since boot"
 * keeps the schedule predictable across restarts — otherwise a redeploy silently
 * moves the reset to whenever the container happened to come up, which on a busy
 * afternoon is exactly when the ranking should not be flattened.
 */
const RESET_HOUR = 4;

function shopTime(at: Date = new Date()): Date {
  return new Date(at.getTime() + SHOP_OFFSET_MS);
}

function shopDay(at: Date = new Date()): string {
  return shopTime(at).toISOString().slice(0, 10);
}

/** Days since the epoch, in shop time — the unit the weekly cadence counts in. */
function shopDayNumber(at: Date = new Date()): number {
  return Math.floor(shopTime(at).getTime() / 86_400_000);
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * The day the window was last cleared.
 *
 * Seeded on start rather than left null, so a container that restarts on reset
 * day does not clear the window a second time.
 */
let lastResetDay: number | null = null;

async function maybeResetWindow(): Promise<void> {
  const now = new Date();
  if (shopTime(now).getUTCHours() !== RESET_HOUR) return;

  const today = shopDayNumber(now);
  if (lastResetDay !== null && today - lastResetDay < WINDOW_DAYS) return;

  await resetRecentSalesWindow();
  lastResetDay = today;

  log.info({ day: shopDay(now), windowDays: WINDOW_DAYS }, "Recent sales window reset");
}

async function tick(): Promise<void> {
  /* A recompute that outruns the interval must not stack. */
  if (running) return;
  running = true;

  try {
    /* Reset first, so the recompute that follows already reflects the cleared
       window rather than publishing scores that are an hour out of date the
       moment they are written. */
    await maybeResetWindow();
    await recomputeTrendingScores();
  } catch (error) {
    /* Swallowed on purpose: this runs unattended, and an unhandled rejection
       would take the whole API down over a ranking refresh. Yesterday's scores
       are a perfectly serviceable homepage. */
    log.error({ err: error }, "Trending recompute failed");
  } finally {
    running = false;
  }
}

export function startMetricsScheduler(): void {
  if (timer) return;

  /* Today counts as the last reset: a restart must not clear the window simply
     because the process is new. */
  lastResetDay = shopDayNumber();

  /* Once at boot, so a fresh database — or one that has been sitting since the
     previous deploy — has real scores before the first shopper arrives rather
     than after the first hour. */
  void tick();

  timer = setInterval(() => void tick(), RECOMPUTE_INTERVAL_MS);
  timer.unref();

  log.info(
    { everyMinutes: RECOMPUTE_INTERVAL_MS / 60_000, windowDays: WINDOW_DAYS },
    "Trending score scheduler started",
  );
}

export function stopMetricsScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
