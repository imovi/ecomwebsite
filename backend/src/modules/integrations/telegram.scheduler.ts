import { and, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { abandonedCheckouts } from "../../db/schema/abandoned-checkouts.js";
import { orders } from "../../db/schema/orders.js";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import { backupToTelegram } from "./backup.service.js";
import { alertLowStock } from "./stock-alert.service.js";
import { notifyDatabaseQueue } from "./telegram.service.js";
import { getPoolStats } from "../../db/client.js";
import { sweepExpired as sweepCoupons } from "../orders/recovery-coupon.service.js";
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from "../orders/order.service.js";
import * as telegram from "./telegram.service.js";

/**
 * The background work that nothing else triggers.
 *
 * Two Telegram messages and the trash sweep share one timer. They have nothing
 * to do with each other beyond that, but a second unref'd interval would be a
 * second thing to remember to stop on shutdown, for work that amounts to a few
 * queries a day.
 *
 *
 * A lead alert waits deliberately: the row is written the moment a phone number
 * is typed, and announcing that someone left while they are still entering their
 * address would be wrong on both counts. A few quiet minutes is what turns
 * "still shopping" into "gone".
 *
 * The daily summary is the one message that answers "how did yesterday go"
 * without opening anything.
 *
 * `unref()` on both timers: a live timer holds the process open and turns every
 * deploy into a shutdown that has to be forced.
 */

const log = createLogger("telegram:scheduler");

/** How often the sweep looks. Cheap — the index makes it a handful of rows. */
const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * How long a checkout has to be quiet before it counts as abandoned.
 *
 * Long enough that somebody typing an address is not announced as lost, short
 * enough that the call still lands while they remember the shop.
 */
const QUIET_MINUTES = 15;

/** Dhaka. The summary has to mean the day the person reading it is living in. */
const SHOP_OFFSET_MS = 6 * 60 * 60_000;

function shopDay(at: Date = new Date()): string {
  return new Date(at.getTime() + SHOP_OFFSET_MS).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Abandoned checkout sweep                                                   */
/* -------------------------------------------------------------------------- */

interface CartLine {
  name?: string;
  quantity?: number;
}

function summariseCart(contents: unknown): string {
  if (!Array.isArray(contents) || contents.length === 0) return "Cart contents unknown";

  return (contents as CartLine[])
    .map((line) => `${line.name ?? "Item"} × ${line.quantity ?? 1}`)
    .join(", ");
}

async function sweepAbandoned(): Promise<void> {
  const settings = await getSettings();
  /* Cheap exit before touching the database — the usual state for a shop that
     has not connected Telegram. */
  if (telegram.configProblem(settings) !== null) return;

  const quietBefore = new Date(Date.now() - QUIET_MINUTES * 60_000);

  const rows = await getDb()
    .select({
      id: abandonedCheckouts.id,
      phone: abandonedCheckouts.phone,
      customerName: abandonedCheckouts.customerName,
      contents: abandonedCheckouts.contents,
      estimatedValue: abandonedCheckouts.estimatedValue,
    })
    .from(abandonedCheckouts)
    .where(
      and(
        isNull(abandonedCheckouts.alertedAt),
        isNull(abandonedCheckouts.recoveredOrderId),
        lt(abandonedCheckouts.lastSeenAt, quietBefore),
      ),
    )
    /* Bounded. A burst of traffic must not turn into a hundred pushes at once,
       and what is left over is picked up on the next pass. */
    .limit(10);

  for (const row of rows) {
    /* Stamped BEFORE sending. A crash between the two costs one alert; the
       other order costs the same customer being rung on every sweep forever. */
    await getDb()
      .update(abandonedCheckouts)
      .set({ alertedAt: sql`now()` })
      .where(and(sql`${abandonedCheckouts.id} = ${row.id}`, isNull(abandonedCheckouts.alertedAt)));

    await telegram.notifyAbandonedCheckout(
      {
        phone: row.phone,
        customerName: row.customerName,
        itemSummary: summariseCart(row.contents),
        value: row.estimatedValue,
      },
      settings,
    );
  }

  if (rows.length > 0) {
    log.info({ count: rows.length }, "Abandoned checkout alerts sent");
  }
}

/* -------------------------------------------------------------------------- */
/* Daily summary                                                              */
/* -------------------------------------------------------------------------- */

/** Sent once per Dhaka day, the first time the timer fires after this hour. */
const SUMMARY_HOUR = 22;

let lastSummaryDay = "";

async function maybeSendSummary(): Promise<void> {
  const now = new Date();
  const day = shopDay(now);
  const shopHour = new Date(now.getTime() + SHOP_OFFSET_MS).getUTCHours();

  if (shopHour < SUMMARY_HOUR || lastSummaryDay === day) return;

  const settings = await getSettings();
  if (telegram.configProblem(settings) !== null) return;

  /* Claimed before the work, so a slow send cannot let the next tick start a
     second one. */
  lastSummaryDay = day;

  const from = new Date(`${day}T00:00:00+06:00`);
  const to = new Date(`${day}T23:59:59.999+06:00`);

  const db = getDb();

  const placed = await db
    .select({
      status: orders.status,
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(orders)
    .where(sql`${orders.createdAt} between ${from} and ${to}`)
    .groupBy(orders.status);

  const delivered = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${orders.grandTotal}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(sql`${orders.deliveredAt} between ${from} and ${to}`);

  /* Pending is counted across all time, not just today: an order from three
     days ago that nobody has rung is exactly what this message exists to
     surface. */
  const pending = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(orders)
    .where(sql`${orders.status} = 'pending'`);

  const countOf = (status: string) => placed.find((row) => row.status === status)?.total ?? 0;

  await telegram.notifyDailySummary(
    {
      day,
      ordersPlaced: placed.reduce((sum, row) => sum + row.total, 0),
      delivered: delivered[0]?.total ?? 0,
      revenue: delivered[0]?.value ?? 0,
      pending: pending[0]?.total ?? 0,
      cancelled: countOf("cancelled"),
      returned: countOf("returned"),
    },
    settings,
  );

  log.info({ day }, "Daily summary sent");
}

/* -------------------------------------------------------------------------- */
/* Trash                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Empties orders that have sat in the trash past the retention window.
 *
 * Rides the same timer rather than getting its own: it is a once-a-day amount of
 * work, and a second unref'd interval would be a second thing to remember to
 * stop on shutdown for no benefit.
 */
async function sweepTrash(): Promise<void> {
  const purged = await purgeExpiredTrash();
  if (purged > 0) {
    log.info({ purged, afterDays: TRASH_RETENTION_DAYS }, "Expired orders purged from the trash");
  }
}

/* -------------------------------------------------------------------------- */
/* Backup                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The hour the database is sent, in the shop's own time.
 *
 * Half past three in the morning: after the last order of the night has been
 * placed and long before the first of the day, so the file is a clean edge
 * rather than a snapshot of a shop mid-sale.
 */
const BACKUP_HOUR = 3;

let lastBackupDay = "";

/**
 * Sends one backup a day, and says so in the log either way.
 *
 * The previous backup on this server failed every night for days without
 * anyone noticing, because nothing said it had. A failure here is logged at
 * error level with the reason, so `docker compose logs api | grep backup`
 * answers "is my data safe" in one line.
 */
async function maybeSendBackup(): Promise<void> {
  const day = shopDay();
  const shopHour = Number(
    new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", hour12: false }),
  );

  if (shopHour < BACKUP_HOUR || lastBackupDay === day) return;

  /* Marked before the attempt, not after. A Telegram outage at 3am must not
     turn into a retry every five minutes for the rest of the day. */
  lastBackupDay = day;

  const outcome = await backupToTelegram();
  if (outcome.sent) {
    log.info({ day, bytes: outcome.bytes }, "Database backup sent");
  } else if (outcome.reason !== "No backup chat is configured.") {
    /* Not configured is not a failure — it is a shop that has not set it up,
       and logging it as an error every night would train the owner to ignore
       the one message that matters. */
    log.error({ day, reason: outcome.reason }, "Database backup FAILED");
  }
}

/**
 * Warns once when a product runs down, and again only after it is restocked.
 *
 * Its own state lives in the database, not here, so a restart does not re-send
 * everything the shop was already told about — see `stock-alert.service.ts`.
 */
async function checkStock(): Promise<void> {
  const outcome = await alertLowStock();
  if (outcome.sent) log.info({ count: outcome.count }, "Low stock warning sent");
}

/**
 * Watches for a database queue that will not clear.
 *
 * WHAT THIS CAN AND CANNOT SEE
 * It samples once per pass — every five minutes. A burst that saturates the
 * pool for two seconds is invisible to it, and that is fine: a two-second queue
 * is the pool doing its job. What it catches is saturation that PERSISTS, which
 * is the shape that means shoppers are sitting on a spinner.
 *
 * Three consecutive samples before it says anything, so one unlucky moment does
 * not wake anybody. Then silent until the queue clears, because an alert that
 * repeats every five minutes for an hour is an alert that gets muted.
 */
const QUEUE_SAMPLES_BEFORE_ALERT = 3;

let queuedSamples = 0;
let queueReported = false;

async function watchDatabaseQueue(): Promise<void> {
  const stats = getPoolStats();
  /* pglite has no pool. Development is not the place this matters. */
  if (!stats) return;

  if (stats.waiting > 0) {
    queuedSamples += 1;
  } else {
    if (queueReported) {
      log.info({ pool: stats }, "Database queue cleared");
    }
    queuedSamples = 0;
    queueReported = false;
    return;
  }

  if (queuedSamples < QUEUE_SAMPLES_BEFORE_ALERT || queueReported) return;

  queueReported = true;
  const minutes = Math.round((queuedSamples * SWEEP_INTERVAL_MS) / 60_000);

  log.error(
    { waiting: stats.waiting, total: stats.total, minutes },
    "Database connection pool has a standing queue",
  );

  try {
    await notifyDatabaseQueue({ waiting: stats.waiting, total: stats.total, minutes });
  } catch (error) {
    log.error({ err: error }, "Could not send the database queue alert");
  }
}

/**
 * Retires recovery coupons whose 24 hours are up.
 *
 * Tidiness only. Nothing about money waits on this: redemption tests the
 * coupon's own `expires_at`, so a coupon is refused the second it runs out
 * whether or not this pass has been anywhere near it. What this buys is a panel
 * that says "Expired" instead of "Active", and the room for the shop to issue
 * that lead a fresh offer — the one-active-per-lead index counts a timed-out
 * row as live until it is retired.
 *
 * Deliberately not given its own timer or its own hour. A second scheduled job
 * is a second thing that can quietly stop, and this shop has already been
 * bitten by exactly that.
 */
async function sweepExpiredCoupons(): Promise<void> {
  try {
    await sweepCoupons();
  } catch (error) {
    log.error({ err: error }, "Could not retire expired recovery coupons");
  }
}

/* -------------------------------------------------------------------------- */

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;

  try {
    await sweepAbandoned();
    await sweepExpiredCoupons();
    await checkStock();
    await watchDatabaseQueue();
    await maybeSendSummary();
    await maybeSendBackup();
    await sweepTrash();
  } catch (error) {
    /* Swallowed: this runs unattended, and an unhandled rejection would take
       the API down over Telegram being briefly unreachable. */
    log.error({ err: error }, "Telegram scheduler pass failed");
  } finally {
    running = false;
  }
}

export function startTelegramScheduler(): void {
  if (timer) return;

  /* Today's summary is not sent on boot: a restart at 11pm would otherwise
     repeat it, and a restart at 9am would send yesterday's under today's date. */
  lastSummaryDay = shopDay();
  /* Same reasoning as the summary: a restart must not re-send today's. */
  lastBackupDay = shopDay();

  timer = setInterval(() => void tick(), SWEEP_INTERVAL_MS);
  timer.unref();

  log.info(
    { everyMinutes: SWEEP_INTERVAL_MS / 60_000, summaryHour: SUMMARY_HOUR },
    "Telegram scheduler started",
  );
}

export function stopTelegramScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
