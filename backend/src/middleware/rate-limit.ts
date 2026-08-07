import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { config } from "../config/index.js";
import { TooManyRequestsError } from "../core/errors.js";

/**
 * Rate limiting.
 *
 * Two tiers: a broad ceiling on the whole API, and a much tighter one on the
 * credential endpoints, because the threat models differ. General traffic
 * needs protection from runaway clients; `/auth/login` needs protection from
 * credential stuffing, where even a few hundred attempts an hour is an attack.
 *
 * SCALING NOTE — the default store is per-process memory. With more than one
 * replica the effective limit multiplies by the replica count. Before scaling
 * horizontally, swap in a shared store (`rate-limit-redis`) via the `store`
 * option below; nothing else here changes.
 */

/** Rejecting through the normal error pipeline keeps the envelope consistent. */
function rejectWithAppError(windowMs: number): Options["handler"] {
  return (_req, _res, next) => {
    next(new TooManyRequestsError(Math.ceil(windowMs / 1000)));
  };
}

/**
 * Normalises a client address into a rate-limit key.
 *
 * `ipKeyGenerator` collapses IPv6 addresses to their /64 prefix. This is not
 * cosmetic: a residential IPv6 allocation gives one attacker 2^64 source
 * addresses, so keying on the full address means the login limiter can be
 * bypassed by simply incrementing the host bits.
 */
function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? "unknown");
}

/**
 * Key by authenticated admin when known, otherwise by client address.
 *
 * Without the admin branch, everyone behind one office NAT shares a bucket and
 * one busy user throttles the whole team.
 */
function keyGenerator(req: Request): string {
  if (req.auth?.adminId) return `admin:${req.auth.adminId}`;
  return `ip:${ipKey(req)}`;
}

const shared = {
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator,
} satisfies Partial<Options>;

/** Loopback, RFC1918 and IPv6 unique-local, including IPv4-mapped forms. */
function isPrivateAddress(address: string): boolean {
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (ip === "::1" || ip === "localhost") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  return /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip);
}

/**
 * The storefront's own server-side calls, which must not be counted.
 *
 * Public traffic arrives through the reverse proxy, which stamps
 * `X-Forwarded-For`, so each visitor gets their own bucket. The Next.js
 * container talks to this API directly over the Docker network: no proxy, no
 * header, and one client address for the whole shop. Counted, that means every
 * server-rendered page — category listings, search, the checkout quote, placing
 * an order — draws down a single bucket. One busy minute empties it and the
 * entire storefront starts answering 429 at once, for everybody, with checkout
 * included. The limit meant to survive a traffic spike is what fails first.
 *
 * It is infrastructure rather than a client. The limiter exists to bound
 * untrusted callers, and this one is neither untrusted nor reachable from
 * outside — the API port is published on loopback only.
 *
 * Both conditions are required. The missing header alone would be enough today,
 * but if the proxy in front is ever swapped for one that forgets to set it,
 * that single condition would silently exempt the whole internet.
 */
function isInternalCaller(req: Request): boolean {
  if (req.headers["x-forwarded-for"] !== undefined) return false;
  return isPrivateAddress(req.socket.remoteAddress ?? "");
}

/** Applied to the whole API. */
export const globalRateLimit: RequestHandler = rateLimit({
  ...shared,
  windowMs: config.rateLimit.global.windowMs,
  limit: config.rateLimit.global.max,
  handler: rejectWithAppError(config.rateLimit.global.windowMs),
  /**
   * Two exemptions, both for the same reason: neither is an API call, and
   * counting them against an API budget breaks the thing it was meant to
   * protect.
   *
   * `/health` — a throttled probe reads as an outage and can take a healthy
   * instance out of rotation.
   *
   * `/uploads` — static image files. One product page fetches the same photo at
   * eight widths, so a handful of page views can spend a budget sized for API
   * calls. When it runs out the storefront's image optimiser starts receiving
   * 429 and EVERY picture on the shop disappears, while the HTML keeps
   * rendering perfectly — which looks like the catalogue emptied itself rather
   * than like a rate limit. Serving a file off disk is cheap; it does not need
   * this defence, and the reverse proxy is the right place to bound it if it
   * ever does.
   */
  skip: (req) =>
    req.path.startsWith("/health") ||
    req.path.startsWith("/uploads") ||
    isInternalCaller(req),
});

/**
 * Applied to credential endpoints.
 *
 * Keyed by IP *and* submitted email, so one attacker cannot lock out a real
 * admin by hammering their address from many IPs, and cannot dodge the limit
 * by rotating through many addresses from one IP.
 */
export const authRateLimit: RequestHandler = rateLimit({
  ...shared,
  windowMs: config.rateLimit.auth.windowMs,
  limit: config.rateLimit.auth.max,
  handler: rejectWithAppError(config.rateLimit.auth.windowMs),
  keyGenerator: (req: Request) => {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    return `auth:${ipKey(req)}:${email}`;
  },
  /* A successful login should not consume budget — only failures matter. */
  skipSuccessfulRequests: true,
});

/**
 * Applied to the courier webhook.
 *
 * Generous, because a real courier can legitimately burst: a day's parcels all
 * scanned at one depot arrive as a rush of notifications, and throttling those
 * would lose delivery confirmations the profit report is built on. Tight enough
 * that an anonymous caller guessing at the bearer token cannot do so quickly.
 *
 * Only rejected calls count. A courier delivering real updates should never be
 * throttled by its own success.
 */
export const webhookRateLimit: RequestHandler = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 300,
  handler: rejectWithAppError(60_000),
  skipSuccessfulRequests: true,
});
