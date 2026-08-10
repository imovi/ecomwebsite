import type { RequestHandler } from "express";
import { ForbiddenError } from "../core/errors.js";
import { clientIp } from "../lib/net/client-ip.js";
import { isBlocked, recordBlockHit } from "../modules/security/blocked-ip.service.js";
import { getSettings } from "../modules/settings/settings.service.js";
import { createLogger } from "../core/logger.js";

/**
 * Refuses the two public write endpoints for a blocked address.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER
 * -----------------------------------
 * Browsing, search, cart pricing, order tracking, and everything under /admin
 * or /auth. A blocked person can still open the shop and look at it.
 *
 * That is not leniency. In Bangladesh one public address fronts hundreds of
 * real customers — the carriers run carrier-grade NAT — so every extra route
 * this covers multiplies the collateral damage while doing nothing an abuser
 * could not walk around by reconnecting. Refusing the two endpoints that
 * actually create records is the whole of the useful effect.
 *
 * MOUNT ORDER MATTERS
 * -------------------
 * This goes AFTER the per-shopper rate limiter, never before. In front, a
 * blocked caller's flood would skip the limiter entirely and reach the hit
 * counter on every request — turning the cheapest defence in the stack into
 * the one an attacker aims at, precisely because they know it answers fast.
 */

const log = createLogger("security:block-guard");

/**
 * What a refused shopper is told.
 *
 * Not "your IP is blocked" — that is an instruction to reconnect and try
 * again. But not silence either: carrier-grade NAT means this will sometimes
 * catch somebody who has done nothing, and a real customer needs a way
 * through. The hotline is that way through.
 */
async function refusalMessage(): Promise<string> {
  const base = "We can't accept this order right now.";

  try {
    const settings = await getSettings();
    const phone = settings.storePhone.trim() || settings.storeWhatsapp.trim();
    return phone ? `${base} Please call us on ${phone} and we'll take it over the phone.` : base;
  } catch {
    /* The hotline is a nicety; refusing correctly is not. */
    return base;
  }
}

export const blockGuard: RequestHandler = (req, _res, next) => {
  const ip = clientIp(req);

  if (!isBlocked(ip)) {
    next();
    return;
  }

  /* In memory, flushed on a timer — never a database write in the request
     path. See `recordBlockHit`. */
  if (ip) recordBlockHit(ip);
  log.warn({ ip, path: req.path }, "Refused a blocked address");

  void refusalMessage().then(
    (message) => next(new ForbiddenError(message)),
    () => next(new ForbiddenError("We can't accept this order right now.")),
  );
};
