import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { blockedIps, type BlockedIpRow } from "../../db/schema/blocked-ips.js";
import { createLogger } from "../../core/logger.js";
import { BadRequestError, ConflictError } from "../../core/errors.js";
import { isPrivateAddress, toBlockableCidr } from "../../lib/net/client-ip.js";

/**
 * The block list, and the cache that makes it free to consult.
 *
 * A checkout must not pay for a database round trip so the shop can catch a
 * rare abuser — every honest customer would carry that cost. The live set is
 * held in memory, rebuilt whenever it changes and refreshed on a timer so
 * expiries take effect without anyone doing anything.
 */

const log = createLogger("security:blocked-ips");

/** Expiries land within this long even if nothing writes. */
const REFRESH_INTERVAL_MS = 5 * 60_000;

/** Ranges currently in force, as CIDR strings. */
let live: string[] = [];
let loaded = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Matching, done here rather than in SQL.
 *
 * The set is small — a shop blocks a handful of addresses, not thousands — and
 * doing it in memory is what keeps `isBlocked` off the database entirely.
 */
function covers(cidrRange: string, candidate: string): boolean {
  const [network, bitsText] = cidrRange.split("/");
  if (!network) return false;

  const bits = Number(bitsText ?? "32");

  /* Exact match covers the common case — an IPv4 /32 — without any parsing. */
  if (network === candidate) return true;

  /* IPv4 prefix arithmetic. */
  if (!network.includes(":") && !candidate.includes(":")) {
    const toInt = (ip: string): number | null => {
      const parts = ip.split(".").map(Number);
      if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part > 255)) {
        return null;
      }
      return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
    };

    const a = toInt(network);
    const b = toInt(candidate);
    if (a === null || b === null) return false;
    if (bits === 0) return true;

    const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }

  /* IPv6, always stored as a /64 by `toBlockableCidr`, so comparing the
     network half is the whole test. Compared on the expanded form so that two
     spellings of one prefix do not read as different. */
  if (network.includes(":") && candidate.includes(":")) {
    return expandV6Prefix(network) === expandV6Prefix(candidate);
  }

  return false;
}

/** First four hextets, zero-padded, so `2001:db8::` and `2001:0db8:0:0::` agree. */
function expandV6Prefix(address: string): string {
  const [head = "", tail = ""] = address.split("::");
  const headParts = head.split(":").filter(Boolean);
  const tailParts = tail.split(":").filter(Boolean);

  const missing = 8 - headParts.length - tailParts.length;
  const full = address.includes("::")
    ? [...headParts, ...Array<string>(Math.max(0, missing)).fill("0"), ...tailParts]
    : headParts;

  return full
    .slice(0, 4)
    .map((part) => part.padStart(4, "0").toLowerCase())
    .join(":");
}

/**
 * Reloads the live set.
 *
 * Wrapped so a failure can never propagate. This runs on a timer, and an
 * unhandled rejection in a timer callback takes the whole process down in
 * current Node — turning a momentary database hiccup into an outage of the
 * entire shop, over a feature that was working a second ago. On failure the
 * previous set stays in force, which is the safe direction: blocks keep
 * applying, and the log says why nothing changed.
 */
export async function refreshBlockedIps(): Promise<void> {
  try {
    const rows = await getDb()
      .select({ ip: blockedIps.ip })
      .from(blockedIps)
      .where(
        and(
          isNull(blockedIps.unblockedAt),
          sql`(${blockedIps.expiresAt} is null or ${blockedIps.expiresAt} > now())`,
        ),
      );

    live = rows.map((row) => row.ip);
    loaded = true;
  } catch (error) {
    log.error({ err: error }, "Could not refresh the blocked IP list — keeping the previous one");
  }
}

/**
 * Whether this address is currently refused.
 *
 * Fails OPEN until the first load succeeds. On a cash-on-delivery shop an
 * order that should have been refused is worth far less than every order
 * being refused during the second it takes to boot.
 */
export function isBlocked(ip: string | null): boolean {
  if (!ip || !loaded || live.length === 0) return false;
  return live.some((range) => covers(range, ip));
}

export function startBlockedIpRefresh(): void {
  if (timer) return;

  void refreshBlockedIps();

  timer = setInterval(() => {
    void refreshBlockedIps();
    /* Same tick, so refusals reach the panel without their own schedule. */
    void flushBlockHits();
  }, REFRESH_INTERVAL_MS);

  /* Never holds a deploy open — same discipline as the other schedulers. */
  timer.unref();
}

export function stopBlockedIpRefresh(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/* -------------------------------------------------------------------------- */
/* Admin operations                                                           */
/* -------------------------------------------------------------------------- */

export interface BlockedIpDto {
  id: string;
  ip: string;
  reason: string;
  expiresAt: string | null;
  hitCount: number;
  lastHitAt: string | null;
  unblockedAt: string | null;
  createdAt: string;
  /** True when it is neither lifted nor expired. */
  active: boolean;
}

function toDto(row: BlockedIpRow): BlockedIpDto {
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();

  return {
    id: row.id,
    ip: row.ip,
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    hitCount: row.hitCount,
    lastHitAt: row.lastHitAt?.toISOString() ?? null,
    unblockedAt: row.unblockedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    active: row.unblockedAt === null && !expired,
  };
}

/**
 * Blocks an address.
 *
 * REFUSES PRIVATE ADDRESSES, and that check is the most important line here.
 * The storefront reaches this API from inside the Docker network, so a block
 * on `172.19.0.1` or `127.0.0.1` would not stop a fraudster — it would refuse
 * every checkout in the shop at once, and the panel offers no clue that this is
 * what happened. It has to be impossible rather than discouraged.
 */
export async function blockIp(input: {
  ip: string;
  reason: string;
  expiresAt: Date | null;
  adminId: string;
}): Promise<BlockedIpDto> {
  const range = toBlockableCidr(input.ip);

  if (!range) {
    throw new BadRequestError("That does not look like an IP address.");
  }

  if (isPrivateAddress(input.ip)) {
    throw new BadRequestError(
      "That is a private network address — the shop's own servers talk to each other on it. " +
        "Blocking it would refuse every order in the shop, not one customer.",
    );
  }

  /**
   * Retire a block that has already run out before inserting a new one.
   *
   * Two definitions of "live" disagreed here, and the owner is the one who
   * would have hit it. The unique index calls a row live while `unblocked_at`
   * is null; the runtime calls it live only while it is ALSO unexpired. So a
   * seven-day block that quietly lapsed still occupied the index slot, and
   * blocking that address again — the natural thing to do when the same abuser
   * came back — answered "that address is already blocked" about a block that
   * was refusing nothing.
   */
  await getDb()
    .update(blockedIps)
    .set({ unblockedAt: sql`now()` })
    .where(
      and(
        eq(blockedIps.ip, range),
        isNull(blockedIps.unblockedAt),
        sql`${blockedIps.expiresAt} is not null and ${blockedIps.expiresAt} <= now()`,
      ),
    );

  try {
    const [row] = await getDb()
      .insert(blockedIps)
      .values({
        ip: range,
        reason: input.reason,
        expiresAt: input.expiresAt,
        blockedBy: input.adminId,
      })
      .returning();

    if (!row) throw new Error("Failed to record the block.");

    await refreshBlockedIps();
    log.warn({ ip: range, adminId: input.adminId }, "IP blocked");

    return toDto(row);
  } catch (error) {
    /* `blocked_ips_live_idx` refused a second live block for one address.
       Detected by the SQL state rather than by matching the message text —
       Drizzle wraps the driver's error, so the index name is not in
       `error.message` at all, and the first version of this check silently
       turned a duplicate into a 500. */
    if (isUniqueViolation(error)) {
      throw new ConflictError("That address is already blocked.");
    }
    throw error;
  }
}

/** Walks the wrapped-error chain looking for Postgres's unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && "code" in current) {
      if ((current as { code?: unknown }).code === "23505") return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/** Lifts a block, keeping the record of it. */
export async function unblockIp(id: string, adminId: string): Promise<void> {
  await getDb()
    .update(blockedIps)
    .set({ unblockedAt: sql`now()`, unblockedBy: adminId })
    .where(and(eq(blockedIps.id, id), isNull(blockedIps.unblockedAt)));

  await refreshBlockedIps();
  log.info({ id, adminId }, "IP unblocked");
}

/** Everything ever blocked, newest first. Lifted and expired rows included. */
export async function listBlockedIps(): Promise<BlockedIpDto[]> {
  const rows = await getDb().select().from(blockedIps).orderBy(desc(blockedIps.createdAt));
  return rows.map(toDto);
}

/**
 * The live block covering an address, if any — so the order page can offer
 * "unblock" instead of "block" without a second round trip.
 */
export async function findLiveBlockFor(ip: string): Promise<BlockedIpDto | null> {
  const range = toBlockableCidr(ip);
  if (!range) return null;

  const rows = await getDb()
    .select()
    .from(blockedIps)
    .where(
      and(
        isNull(blockedIps.unblockedAt),
        sql`${blockedIps.ip} >>= ${range}::cidr`,
        sql`(${blockedIps.expiresAt} is null or ${blockedIps.expiresAt} > now())`,
      ),
    )
    .limit(1);

  return rows[0] ? toDto(rows[0]) : null;
}

/* -------------------------------------------------------------------------- */
/* Hit counting                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Counts refusals without writing one row per refused request.
 *
 * A blocked caller can hammer the endpoint, and the guard is deliberately the
 * cheapest thing in the stack. A synchronous UPDATE per refusal would turn the
 * defence into its own denial-of-service — the attacker already knows this path
 * is fast to reach, because they are blocked. Counted in memory and flushed on
 * the refresh timer instead.
 */
const pendingHits = new Map<string, number>();

/**
 * Keyed by the blocked RANGE, not by the address that hit it.
 *
 * Keying on the address looked equivalent and is not. An IPv6 block covers a
 * /64 — 2^64 addresses — so an attacker inside one can vary the host bits and
 * mint a fresh map key per request. The flush then issues one UPDATE per key,
 * all against the same row: five thousand rotated addresses in a window become
 * five thousand statements, which is exactly the per-request write this whole
 * mechanism exists to avoid, arrived at from the other direction. Collapsing to
 * the range first makes it one key and one UPDATE however the source varies.
 */
export function recordBlockHit(ip: string): void {
  const range = toBlockableCidr(ip);
  if (!range) return;
  pendingHits.set(range, (pendingHits.get(range) ?? 0) + 1);
}

export async function flushBlockHits(): Promise<void> {
  if (pendingHits.size === 0) return;

  const batch = [...pendingHits.entries()];
  pendingHits.clear();

  for (const [range, count] of batch) {
    try {
      await getDb()
        .update(blockedIps)
        .set({
          hitCount: sql`${blockedIps.hitCount} + ${count}`,
          lastHitAt: sql`now()`,
        })
        .where(and(isNull(blockedIps.unblockedAt), sql`${blockedIps.ip} >>= ${range}::cidr`));
    } catch (error) {
      log.warn({ err: error, range }, "Could not record block hits");
    }
  }
}
