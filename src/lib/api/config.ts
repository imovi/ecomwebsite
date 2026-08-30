import "server-only";

/**
 * Frontend runtime configuration.
 *
 * Validated once at module load and cached. A misconfigured deployment should
 * fail loudly on the first render rather than silently serve an empty
 * catalogue — an empty shop that returns HTTP 200 is the worst possible
 * outcome when you are paying for traffic.
 *
 * Hand-rolled rather than Zod: the storefront has four variables and no other
 * use for a schema library, and every kilobyte on the server bundle is a
 * kilobyte of cold-start.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value.trim();
}

/** Strips a trailing slash so path joining never produces a double slash. */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export const apiConfig = {
  /**
   * Backend base URL, server-side only.
   *
   * Deliberately NOT `NEXT_PUBLIC_`: the browser never talks to the backend
   * directly. Everything goes through this Next server, which means the API
   * can sit on a private network and the storefront needs no CORS at all.
   */
  baseUrl: normalizeUrl(required("API_URL", process.env.API_URL)),

  /** Fail a request rather than let a hung backend hold a page render open. */
  timeoutMs: Number(process.env.API_TIMEOUT_MS ?? 8000),

  /**
   * Default ISR window for catalogue reads. Product pages are also revalidated
   * on demand when the admin edits them, so this is a safety net rather than
   * the primary freshness mechanism.
   */
  revalidateSeconds: Number(process.env.API_REVALIDATE_SECONDS ?? 300),
} as const;

export const siteConfig = {
  url: normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),

  /**
   * Meta's proof that this shop owns the domain it advertises.
   *
   * Without it the Business Manager cannot claim hinarbd.com, and an unclaimed
   * domain is what stops a catalogue from linking to it, blocks Aggregated
   * Event Measurement, and leaves the pixel's conversions unattributable.
   *
   * NOT AN ENV VAR, ON PURPOSE
   * --------------------------
   * It is not a secret — it is served in the HTML of every page to anybody who
   * views source, which is precisely how Meta checks it. What it IS is
   * load-bearing: Meta re-checks periodically and un-verifies a domain whose
   * tag has gone. An unset variable would delete the tag silently on the next
   * deploy and the shop would learn about it from a rejected ad weeks later,
   * so the value lives here where removing it is a visible code change.
   *
   * Tied to one domain and one business portfolio (DESHI CART). A different
   * domain needs its own token from Business settings → Brand safety → Domains.
   */
  facebookDomainVerification: "j94h5y60ulq5lppnx9xyfqiy5j7l7n",
} as const;

export const isProduction = process.env.NODE_ENV === "production";
