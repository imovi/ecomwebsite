/**
 * Meta's click and browser identifiers, read from the browser.
 *
 * WHAT THEY ARE
 * -------------
 * `_fbc` encodes the ad click that brought this visitor: Facebook appends
 * `?fbclid=…` to the landing URL and the pixel stores it. It names the exact ad
 * and the exact click, which is the difference between a sale Meta can attribute
 * and one it has to guess at from a name and a phone number.
 *
 * `_fbp` is the browser the pixel already knows, set by the pixel itself.
 *
 * WHY THIS FILE WRITES `_fbc` RATHER THAN ONLY READING IT
 * ------------------------------------------------------
 * The pixel sets that cookie — when it loads. It is loaded `afterInteractive`
 * and it is a third-party script, so on a cheap Android phone with a blocker, or
 * on a connection that drops it, the cookie is never written. Those are exactly
 * the visitors the server-side Conversions API exists to recover, and for them a
 * read-only implementation contributes nothing at all.
 *
 * So the click id is captured on arrival, from the URL, in first-party code that
 * cannot be blocked separately from the shop itself. If the pixel got there
 * first its cookie is left alone — the pixel's own value is authoritative.
 *
 * The format is Meta's: `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>`, with a
 * subdomain index of 1 for an apex domain.
 */

const FBC_COOKIE = "_fbc";
const FBP_COOKIE = "_fbp";

/** Ninety days, matching what the pixel itself uses. */
const FBC_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;

  /* Split rather than regex: a cookie value can contain regex metacharacters,
     and the name is a known constant, so there is nothing to escape. */
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      const value = rest.join("=");
      return value === "" ? null : decodeURIComponent(value);
    }
  }

  return null;
}

/**
 * Records the click id from the current URL, if there is one and nothing has
 * recorded it yet.
 *
 * Idempotent and safe to call on every page: it writes only when `fbclid` is
 * present AND no `_fbc` exists, which is once per campaign visit at most.
 */
export function captureClickId(): void {
  if (typeof window === "undefined") return;

  try {
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (!fbclid) return;

    /* The pixel's own cookie wins. Overwriting it with a freshly stamped
       creation time would misreport when the click happened. */
    if (readCookie(FBC_COOKIE)) return;

    const value = `fb.1.${Date.now()}.${fbclid}`;

    /* `SameSite=Lax` so it survives the arrival from facebook.com, which is a
       cross-site top-level navigation — `Strict` would drop it on the very
       request that carries the click. Not `Secure`-only-in-production: the
       shop is HTTPS, and a cookie that silently fails to set on a bare-IP
       deployment is worse than one flag out of place. */
    document.cookie =
      `${FBC_COOKIE}=${encodeURIComponent(value)}; ` +
      `Max-Age=${FBC_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  } catch {
    /* A blocked cookie store or an unparseable URL. Attribution is a bonus on
       top of the order — nothing here may ever interrupt a shopper. */
  }
}

/**
 * The identifiers to send with a conversion.
 *
 * Null for most shoppers, and that is the ordinary case: someone who found the
 * shop without clicking an ad has no click to report. Both fields are additive
 * everywhere downstream.
 */
export function getClickIds(): { fbc: string | null; fbp: string | null } {
  return {
    fbc: readCookie(FBC_COOKIE),
    fbp: readCookie(FBP_COOKIE),
  };
}
