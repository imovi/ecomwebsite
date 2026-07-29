import path from "node:path";
import { loadEnv, type Env } from "./env.js";

/**
 * Application configuration.
 *
 * Raw env vars are reshaped once into a nested, domain-shaped, frozen object.
 * Consumers read `config.auth.accessTokenTtlSeconds`, never
 * `process.env.ACCESS_TOKEN_TTL_MINUTES` — which means unit conversions and
 * defaults live in exactly one place, and swapping the config source later
 * (Vault, SSM, a config service) touches only this file.
 */

const MINUTE = 60;
const DAY = 86_400;

function build(env: Env) {
  const isProduction = env.NODE_ENV === "production";
  const rootDir = process.cwd();

  return {
    env: env.NODE_ENV,
    isProduction,
    isDevelopment: env.NODE_ENV === "development",
    isTest: env.NODE_ENV === "test",

    server: {
      port: env.PORT,
      apiUrl: env.API_URL.replace(/\/+$/, ""),
      /** Express `trust proxy` value. See TRUST_PROXY_HOPS in .env.example. */
      trustProxy: env.TRUST_PROXY_HOPS,
      /** Body size ceiling. Uploads bypass this via multer's own limits. */
      bodyLimit: "100kb",
      /** Grace period for in-flight requests during shutdown. */
      shutdownTimeoutMs: 10_000,
    },

    cors: {
      origins: env.CORS_ORIGINS,
      credentials: true,
    },

    logging: {
      level: env.LOG_LEVEL,
      pretty: env.LOG_PRETTY,
    },

    database: {
      driver: env.DATABASE_DRIVER,
      url: env.DATABASE_URL,
      ssl: env.DATABASE_SSL,
      pool: {
        max: env.DATABASE_POOL_MAX,
        idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
      },
      pgliteDataDir: env.PGLITE_DATA_DIR.startsWith("memory://")
        ? env.PGLITE_DATA_DIR
        : path.resolve(rootDir, env.PGLITE_DATA_DIR),
      /* Top-level, not under `src`: a production image ships `dist/` and
         `migrations/` but usually not the TypeScript sources. */
      migrationsDir: path.resolve(rootDir, "migrations"),
    },

    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_MINUTES * MINUTE,
      refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_DAYS * DAY,
      maxFailedLoginAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS,
      lockoutSeconds: env.LOGIN_LOCKOUT_MINUTES * MINUTE,
      cookie: {
        /** Refresh token cookie name. */
        name: "gng_refresh_token",
        /** Scoped to the auth routes so it is not sent on every API call. */
        path: "/api/v1/auth",
        domain: env.COOKIE_DOMAIN || undefined,
        secure: env.COOKIE_SECURE,
        httpOnly: true,
        /** Strict: the admin panel is same-site; no cross-site POST needs it. */
        sameSite: "strict" as const,
      },
    },

    rateLimit: {
      global: {
        windowMs: env.RATE_LIMIT_WINDOW_MINUTES * MINUTE * 1000,
        max: env.RATE_LIMIT_MAX,
      },
      auth: {
        windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * MINUTE * 1000,
        max: env.AUTH_RATE_LIMIT_MAX,
      },
      /** Public checkout — placing an order and pricing a cart. */
      checkout: {
        windowMs: env.CHECKOUT_RATE_LIMIT_WINDOW_MINUTES * MINUTE * 1000,
        max: env.CHECKOUT_RATE_LIMIT_MAX,
        quoteMax: env.QUOTE_RATE_LIMIT_MAX,
      },
    },

    upload: {
      driver: env.STORAGE_DRIVER,
      dir: path.resolve(rootDir, env.UPLOAD_DIR),
      maxFileSizeBytes: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
      maxFiles: env.UPLOAD_MAX_FILES,
      /** Public path prefix under which stored files are served. */
      publicPath: "/uploads",
    },

    seed: {
      adminEmail: env.SEED_ADMIN_EMAIL,
      adminPassword: env.SEED_ADMIN_PASSWORD,
      adminName: env.SEED_ADMIN_NAME ?? "Super Admin",
    },
  } as const;
}

export type Config = ReturnType<typeof build>;

export const config: Config = Object.freeze(build(loadEnv()));
