import { z } from "zod";

/**
 * Environment schema.
 *
 * Parsed once, at import time, before anything else boots. A container with a
 * missing secret or a malformed URL dies on startup with a readable message
 * instead of throwing at 2am on the first request that happens to need it.
 *
 * Everything downstream consumes the frozen, typed `config` object exported
 * from `./index.ts` — `process.env` is never read anywhere else in the app.
 */

/** `"true"`/`"1"`/`"yes"` → true. Env vars are always strings. */
const booleanish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === "") return defaultValue;
      return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
    });

const integer = (defaultValue: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === "" ? defaultValue : Number(value),
    )
    .pipe(z.number().int().min(min).max(max));

const csv = (defaultValue: string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ""
        ? defaultValue
        : value
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
    );

export const envSchema = z
  .object({
    // --- Runtime ---------------------------------------------------------
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: integer(4000, 1, 65535),
    API_URL: z.url().default("http://localhost:4000"),
    CORS_ORIGINS: csv(["http://localhost:3000"]),
    TRUST_PROXY_HOPS: integer(0, 0, 10),

    /**
     * Declares that nothing proxies this API — its port is published directly.
     *
     * `TRUST_PROXY_HOPS` must match reality, and the config cannot see what is
     * in front of it, so the production guard assumes the documented shape: a
     * reverse proxy. That assumption is wrong when the API is reachable on its
     * own published port, and there the correct value is 0.
     *
     * Raising it to 1 to satisfy the guard would be actively harmful, not
     * merely untidy: Express would then trust an `X-Forwarded-For` header that
     * any caller can write, so anyone could spoof an address and walk straight
     * past the rate limits protecting login and checkout.
     */
    NO_REVERSE_PROXY: booleanish(false),

    /**
     * Public origin of the storefront.
     *
     * Used as the `event_source_url` on conversion events — Meta compares it
     * against the verified domain, and a mismatch degrades attribution. Defaults
     * to the first CORS origin, which is the storefront in every deployment
     * shape this app supports, so it rarely needs setting explicitly.
     */
    STOREFRONT_URL: z.url().optional(),

    // --- Logging ---------------------------------------------------------
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    LOG_PRETTY: booleanish(false),

    // --- Database --------------------------------------------------------
    DATABASE_DRIVER: z.enum(["postgres", "pglite"]).default("postgres"),
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: booleanish(false),
    DATABASE_POOL_MAX: integer(10, 1, 100),
    DATABASE_POOL_IDLE_TIMEOUT_MS: integer(30_000, 1_000),
    DATABASE_CONNECTION_TIMEOUT_MS: integer(10_000, 1_000),
    PGLITE_DATA_DIR: z.string().default("./.pglite"),

    // --- Authentication --------------------------------------------------
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_ISSUER: z.string().min(1).default("gng-api"),
    JWT_AUDIENCE: z.string().min(1).default("gng-admin"),
    ACCESS_TOKEN_TTL_MINUTES: integer(15, 1, 1_440),
    REFRESH_TOKEN_TTL_DAYS: integer(14, 1, 365),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: booleanish(false),

    /**
     * Lets `COOKIE_SECURE=false` through in production. A DELIBERATE downgrade.
     *
     * There is one honest reason to want it: the shop is being brought up on a
     * bare IP before a domain is pointed at it, and Let's Encrypt will not issue
     * a certificate for an IP — so there is no HTTPS to be secure over. A Secure
     * cookie is never sent back on a plain-HTTP request, so without this the
     * admin login appears to succeed and then bounces straight back to the
     * sign-in page with nothing on screen explaining why.
     *
     * It is a separate variable rather than a relaxed rule because the guard is
     * right: a session cookie travelling in clear text can be read by anyone on
     * the path. Making it opt-in means nobody arrives here by accident, and the
     * server says so loudly on every boot.
     */
    ALLOW_INSECURE_COOKIES: booleanish(false),

    /* --- Rate limiting -----------------------------------------------------
     *
     * AN ADDRESS IS NOT A PERSON HERE.
     *
     * Every public limiter keys on the shopper's IP. In most countries that is
     * near enough to "one visitor". In Bangladesh it is not: the mobile carriers
     * almost all run carrier-grade NAT, so hundreds of real customers on
     * Grameenphone or Robi reach this shop from a handful of public addresses.
     * On a store whose traffic arrives from a Facebook ad, on phones, that is
     * the normal case rather than the exception.
     *
     * So these ceilings are sized for a SHARED address carrying many genuine
     * shoppers at once, not for one. Sizing them per-person is what turns a
     * successful ad into a wall of "too many requests" for customers who did
     * nothing wrong — and it fails at the worst possible moment, because the
     * endpoints that count are the ones at the end of the funnel: pricing a
     * cart, placing the order.
     *
     * WHAT ACTUALLY COUNTS. Browsing does not: catalogue reads reach the API
     * from the storefront container with no forwarded address, and the global
     * limiter exempts them as infrastructure. Only the five endpoints the
     * storefront forwards a shopper address for are counted — search, quote,
     * the incomplete-checkout save, placing an order, and order tracking.
     *
     * THE ARITHMETIC. One heavy shopper spends roughly 70 of those in fifteen
     * minutes and an extreme one about 150 — the checkout re-quotes on load and
     * on every address change, and the lead record saves on a debounce while
     * they type. Assume up to ~25 such shoppers behind one carrier address at
     * peak and the defaults below follow, with headroom on top.
     *
     * WHAT STILL BOUNDS ABUSE. Order spam is not held back by this number and
     * never was — an attacker rotates addresses. It is held back by the
     * idempotency key, by stock that is really reserved, and by the fact that
     * every order is confirmed by a phone call before it ships. Rejecting real
     * buyers to slow down a spammer who is not slowed down is a bad trade.
     */
    RATE_LIMIT_WINDOW_MINUTES: integer(15, 1),
    /* A backstop, not a business rule. Catalogue traffic never reaches it. */
    RATE_LIMIT_MAX: integer(4_000, 1),

    /* Credentials are the exception: keyed by address AND submitted email, so
       it is effectively per-account, and a shared carrier address cannot push a
       real admin over it. Tight is right here. */
    AUTH_RATE_LIMIT_WINDOW_MINUTES: integer(15, 1),
    AUTH_RATE_LIMIT_MAX: integer(10, 1),

    /* Checkout is the only unauthenticated write in the API. The ceiling is a
       hundred and fifty orders from ONE address in fifteen minutes — far beyond
       anything this shop has done in a day, and still a bound. */
    CHECKOUT_RATE_LIMIT_WINDOW_MINUTES: integer(15, 1),
    CHECKOUT_RATE_LIMIT_MAX: integer(150, 1),
    /* Shared by three read-ish endpoints, each with its own budget: pricing a
       cart, searching, and the incomplete-checkout save. Pricing is the busiest
       — a shopper correcting their address re-quotes each time. */
    QUOTE_RATE_LIMIT_MAX: integer(600, 1),
    /* Order tracking. A lookup against a guessable number, so it stays the
       tightest of the customer-facing limits — but not so tight that a carrier
       full of customers checking their parcels runs it out. */
    TRACK_RATE_LIMIT_MAX: integer(300, 1),
    /* The integration "test connection" buttons. Each one makes an outbound
       call, so an unbounded button is a way to burn the shop's Google quota or
       have Telegram throttle the bot for everyone. Ten a minute is generous for
       a human setting things up. */
    INTEGRATION_TEST_RATE_LIMIT_MAX: integer(10, 1),
    LOGIN_MAX_FAILED_ATTEMPTS: integer(5, 1, 100),
    LOGIN_LOCKOUT_MINUTES: integer(15, 1),

    // --- Uploads ---------------------------------------------------------
    STORAGE_DRIVER: z.enum(["local"]).default("local"),
    UPLOAD_DIR: z.string().default("./uploads"),
    UPLOAD_MAX_FILE_SIZE_MB: integer(5, 1, 100),
    UPLOAD_MAX_FILES: integer(10, 1, 50),

    // --- Seeding ---------------------------------------------------------
    SEED_ADMIN_EMAIL: z.email().optional(),

    /**
     * Blank is normalised to `undefined`, meaning "generate one".
     *
     * `SEED_ADMIN_PASSWORD=` with no value — which is what both env templates
     * ship — otherwise arrives as `""`, and `""` is not nullish. A `??` fallback
     * would keep it, and the seeder would create a super admin whose password is
     * the empty string while reporting that it generated a strong one.
     *
     * The value itself is never trimmed: leading or trailing spaces in a real
     * password are the operator's business, and silently stripping them would
     * mean the printed credential is not the one that was stored.
     */
    SEED_ADMIN_PASSWORD: z
      .string()
      .optional()
      .transform((value) => (value !== undefined && value.trim() !== "" ? value : undefined)),

    SEED_ADMIN_NAME: z.string().optional(),
  })
  /* Postgres is required unless the embedded driver is explicitly selected. */
  .refine(
    (env) => env.DATABASE_DRIVER !== "postgres" || Boolean(env.DATABASE_URL),
    {
      message: "DATABASE_URL is required when DATABASE_DRIVER=postgres",
      path: ["DATABASE_URL"],
    },
  )
  /* Guard rails that only bite in production, where mistakes are expensive. */
  .refine((env) => env.NODE_ENV !== "production" || env.DATABASE_DRIVER === "postgres", {
    message: "DATABASE_DRIVER=pglite is a development-only driver",
    path: ["DATABASE_DRIVER"],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" || env.COOKIE_SECURE || env.ALLOW_INSECURE_COOKIES,
    {
      message:
        "COOKIE_SECURE must be true in production. " +
        "Set ALLOW_INSECURE_COOKIES=true only while testing on a bare IP with no certificate.",
      path: ["COOKIE_SECURE"],
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== "production" || env.TRUST_PROXY_HOPS > 0 || env.NO_REVERSE_PROXY,
    {
      message:
        "TRUST_PROXY_HOPS must be > 0 in production, otherwise every client " +
        "appears to share the proxy's IP and rate limiting collapses. " +
        "If nothing proxies this API, set NO_REVERSE_PROXY=true instead of raising the hops.",
      path: ["TRUST_PROXY_HOPS"],
    },
  )
  /* The two are contradictory: hops only mean something when a proxy is there
     to add the header. Left unchecked, one of them is silently ignored and
     which one depends on reading the middleware. */
  .refine((env) => !env.NO_REVERSE_PROXY || env.TRUST_PROXY_HOPS === 0, {
    message: "NO_REVERSE_PROXY=true requires TRUST_PROXY_HOPS=0",
    path: ["NO_REVERSE_PROXY"],
  })
  .refine((env) => env.NODE_ENV !== "production" || !env.LOG_PRETTY, {
    message: "LOG_PRETTY must be false in production",
    path: ["LOG_PRETTY"],
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses `process.env`. Exits the process on failure — there is no sensible
 * degraded mode for an app that does not know its own database URL.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    // Logger depends on config, so this one message predates it and must use
    // stderr directly.
    process.stderr.write(
      `\nInvalid environment configuration:\n${issues}\n\n` +
        `See .env.example for the full list of supported variables.\n\n`,
    );
    process.exit(1);
  }

  return result.data;
}
