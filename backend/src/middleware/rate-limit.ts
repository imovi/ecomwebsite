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

/** Applied to the whole API. */
export const globalRateLimit: RequestHandler = rateLimit({
  ...shared,
  windowMs: config.rateLimit.global.windowMs,
  limit: config.rateLimit.global.max,
  handler: rejectWithAppError(config.rateLimit.global.windowMs),
  /* Health probes must never be throttled — a limited probe reads as an
     outage and can take a healthy instance out of rotation. */
  skip: (req) => req.path.startsWith("/health"),
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
