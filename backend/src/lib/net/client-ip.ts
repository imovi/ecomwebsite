import type { Request } from "express";

/**
 * Who the shopper is, as far as this API can tell.
 *
 * There is exactly one correct answer to that question in this deployment and
 * it is subtle, so it lives here and everything else calls it: the rate
 * limiter, the address recorded on an order, and the block guard. Three
 * different opinions about "the client address" is how one of them ends up
 * wrong without anyone noticing.
 *
 * THE TRUST RULE
 * --------------
 * Nothing on the storefront reaches this API directly. A shopper placing an
 * order posts to the Next.js server, which calls us over the private Docker
 * network — so `req.ip` is the storefront container for every customer alive.
 * The storefront therefore forwards the real address in `x-customer-ip`.
 *
 * That header is honoured ONLY when the socket peer is a private address.
 * Without that condition anyone on the internet could name themselves, and
 * since the rate limits key on this, a spoofed header would mint a fresh
 * bucket per request — worse than having no limiter at all. It would also
 * poison `orders.customer_ip` and Meta's attribution, which is precisely the
 * bug the `X-Forwarded-For` fix in `lib/api/client-hints.ts` was written for.
 */

const CUSTOMER_IP_HEADER = "x-customer-ip";

/**
 * Loopback, RFC1918, link-local and IPv6 unique-local, including IPv4-mapped
 * forms — everything that must never be treated as a customer's address.
 *
 * Two jobs, and the second is why the odd entries are here. It decides whether
 * to trust a forwarded header, and it decides what an admin is forbidden to
 * block. For the second job, `0.0.0.0`, `255.255.255.255` and `::` are not
 * addresses any shopper arrives from — but they are values a person can type
 * into a box, and a block on one of them is at best dead weight in the table.
 * Refusing them costs nothing and removes a way to be confused later.
 *
 * Lower-cased first: IPv6 is case-insensitive by specification, so `::FFFF:`
 * and `::ffff:` are one address, and matching only the lower form would let the
 * IPv4-mapped unwrap silently miss.
 *
 * Deliberately NOT here: `100.64.0.0/10`, the carrier-grade NAT range. That is
 * exactly where a real Bangladeshi customer — or a real abuser — appears from,
 * and calling it private would make the one address that matters unblockable.
 */
export function isPrivateAddress(address: string): boolean {
  const lowered = address.trim().toLowerCase();
  const ip = lowered.startsWith("::ffff:") ? lowered.slice(7) : lowered;

  if (ip === "::1" || ip === "::" || ip === "localhost") return true;
  if (ip === "0.0.0.0" || ip === "255.255.255.255") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  return /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip);
}

/**
 * One spelling per address, so a value written by one code path matches the
 * same address read by another.
 *
 * Only unwraps the IPv4-mapped IPv6 form — `::ffff:103.80.3.19` and
 * `103.80.3.19` are the same machine, and Node hands back the first form on a
 * dual-stack socket. Everything else is left to Postgres's `inet`, which
 * canonicalises properly and knows far more about IPv6 spelling than a regular
 * expression ever will.
 */
export function normalizeIp(value: string): string {
  const trimmed = value.trim();
  /* Case-insensitive, because IPv6 is: `::FFFF:` is the same prefix as
     `::ffff:`, and matching only one form would leave a mapped IPv4 address
     wearing its wrapper. */
  return trimmed.toLowerCase().startsWith("::ffff:") && trimmed.includes(".")
    ? trimmed.slice(7)
    : trimmed;
}

/**
 * The shopper's own address, or null when there is nothing trustworthy.
 *
 * Returns the raw address rather than a rate-limit bucket key — see
 * `customerKey` for the bucketed form, which collapses IPv6 to a /64 so the
 * limiter cannot be walked around by incrementing host bits.
 */
export function clientIp(req: Request): string | null {
  const declared = req.headers[CUSTOMER_IP_HEADER];

  if (typeof declared === "string" && declared.trim() !== "") {
    if (isPrivateAddress(req.socket.remoteAddress ?? "")) {
      return normalizeIp(declared);
    }
  }

  const direct = req.ip;
  return direct ? normalizeIp(direct) : null;
}

/**
 * What a block is recorded and matched against.
 *
 * IPv4 becomes a /32 — itself. IPv6 becomes its /64.
 *
 * WHY THE /64 IS COMPUTED HERE RATHER THAN BORROWED
 * -------------------------------------------------
 * `ipKeyGenerator` from express-rate-limit looks like the obvious thing to
 * reuse, and it was, until a test proved it returns a 56-bit prefix — the block
 * on `2001:db8:1:2:3:4:5:6` came out as `2001:db8:1::/56`. That is a defensible
 * choice for a rate limiter, where an ISP hands a household a /56 and an
 * attacker can rotate through the /64s inside it. It is the wrong choice for a
 * punitive block: a /56 is sixteen times the collateral, and this control
 * already errs toward hurting bystanders in a country where one address fronts
 * a carrier's worth of customers.
 *
 * So the prefix is derived explicitly — narrower on purpose, and immune to the
 * library changing its mind again.
 *
 * Returns null for anything unparseable, which the caller must treat as
 * "cannot block this", never as "blocks nothing".
 */
export function toBlockableCidr(value: string): string | null {
  const ip = normalizeIp(value);
  if (ip === "") return null;

  if (!ip.includes(":")) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
    return ip.split(".").every((part) => Number(part) <= 255) ? `${ip}/32` : null;
  }

  const prefix = v6NetworkPrefix(ip);
  return prefix ? `${prefix}::/64` : null;
}

/**
 * The first four hextets of an IPv6 address — its /64 network — normalised.
 *
 * Expands `::` so that every spelling of one prefix produces one string, and
 * zero-pads so `2001:db8` and `2001:0db8` are not two different networks.
 */
export function v6NetworkPrefix(address: string): string | null {
  const withoutZone = address.split("%")[0] ?? "";
  if (!/^[0-9a-fA-F:]+$/.test(withoutZone)) return null;

  const halves = withoutZone.split("::");
  if (halves.length > 2) return null;

  const head = (halves[0] ?? "").split(":").filter(Boolean);
  const tail = (halves[1] ?? "").split(":").filter(Boolean);

  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail]
      : head;

  if (groups.length < 4) return null;

  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, "").toLowerCase())
    .join(":");
}
