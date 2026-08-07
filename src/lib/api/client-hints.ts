import "server-only";

/**
 * The shopper's address, forwarded to the API.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Nothing on the storefront reaches the API directly. A shopper pricing a cart,
 * searching, tracking a parcel or placing an order posts to THIS server, which
 * calls the API over the private Docker network — so as far as the API is
 * concerned every shopper in the country shares one address. Its public rate
 * limits, keyed on that, are not per-visitor limits at all but a single
 * allowance for the whole shop, and the first busy hour spends it for everyone.
 *
 * So the address travels explicitly. `x-customer-ip` is a name only this pair of
 * services uses, and the API honours it only from a caller on the private
 * network — otherwise anyone on the internet could mint a fresh bucket per
 * request, which is worse than having no limiter at all.
 *
 * WHY THE LAST ENTRY, NOT THE FIRST
 * ---------------------------------
 * `X-Forwarded-For` is a list, appended to by each proxy: `client, proxy1, …`.
 * The leftmost entry is the conventional "original client" — and it is also the
 * only entry a client can write themselves, because the reverse proxy APPENDS
 * the address it saw rather than replacing what arrived. Reading `[0]` therefore
 * reads a value under the caller's control: a shopper sending
 * `X-Forwarded-For: 9.9.9.9` had that echoed on to the API as their address, and
 * since the limiters key on it, every request minted a fresh bucket. On a
 * cash-on-delivery store that means order spam, and each spam order reserves
 * real stock. The same value is written to `orders.customer_ip` and sent to
 * Meta, so the fraud trail and the ad attribution were poisoned too.
 *
 * The last entry is the one the nearest proxy wrote about a connection it
 * actually terminated, so it cannot be forged from outside. Correct for the
 * deployment this app documents: exactly one proxy in front of this server. Add
 * a second — Cloudflare, a load balancer — and the outermost one must overwrite
 * the header rather than append, as `deploy/Caddyfile.example` shows.
 */
export function forwardClientHints(requestHeaders: Headers): Record<string, string> {
  const forwarded: Record<string, string> = {};

  const chain =
    requestHeaders
      .get("x-forwarded-for")
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  const ip = chain.at(-1) ?? requestHeaders.get("x-real-ip")?.trim() ?? undefined;

  if (ip) {
    forwarded["x-forwarded-for"] = ip;
    forwarded["x-customer-ip"] = ip;
  }

  const userAgent = requestHeaders.get("user-agent");
  if (userAgent) forwarded["user-agent"] = userAgent;

  return forwarded;
}
