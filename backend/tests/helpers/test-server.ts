import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Integration test harness.
 *
 * Boots the real application — real middleware chain, real error handler, real
 * Argon2, real SQL — against PGlite, an actual Postgres engine compiled to
 * WebAssembly. The migrations that run here are the same files that run in
 * production, so this exercises the schema rather than a mock of it.
 *
 * Environment is set before any application module is imported, because
 * `config` parses `process.env` at import time.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "pglite";
process.env.PGLITE_DATA_DIR = "memory://test";
process.env.JWT_ACCESS_SECRET = "test-secret-that-is-definitely-long-enough-32+";
process.env.LOG_LEVEL = "silent";
process.env.LOG_PRETTY = "false";
process.env.COOKIE_SECURE = "false";
process.env.TRUST_PROXY_HOPS = "0";
process.env.ACCESS_TOKEN_TTL_MINUTES = "15";
process.env.REFRESH_TOKEN_TTL_DAYS = "14";
process.env.LOGIN_MAX_FAILED_ATTEMPTS = "3";
process.env.LOGIN_LOCKOUT_MINUTES = "15";
process.env.AUTH_RATE_LIMIT_MAX = "5";
process.env.RATE_LIMIT_MAX = "10000";
/* The order suite places far more orders than any real customer would, so the
   public checkout limits are lifted here. The limiter itself is covered by the
   auth-rate-limit test, which asserts the mechanism works. */
process.env.CHECKOUT_RATE_LIMIT_MAX = "10000";
process.env.QUOTE_RATE_LIMIT_MAX = "10000";
/* Same reasoning for the integration "test connection" buttons: the suite
   presses them far more often than a human setting the shop up would. */
process.env.INTEGRATION_TEST_RATE_LIMIT_MAX = "10000";
process.env.UPLOAD_DIR = "./.test-uploads";

const { createApp } = await import("../../src/app.js");
const { initDatabase, getDb, closeDatabase } = await import("../../src/db/client.js");
const { createAdmin } = await import("../../src/modules/admins/admin.repository.js");
const { hashPassword } = await import("../../src/lib/security/password.js");
const { config } = await import("../../src/config/index.js");

export interface TestContext {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestContext> {
  await initDatabase();

  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await (migrate as (db: unknown, options: { migrationsFolder: string }) => Promise<void>)(
    getDb(),
    { migrationsFolder: config.database.migrationsDir },
  );

  const app = createApp();

  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDatabase();
    },
  };
}

export async function seedAdmin(input: {
  email: string;
  password: string;
  role?: "manager" | "admin" | "super_admin";
  isActive?: boolean;
}) {
  return createAdmin({
    email: input.email,
    name: "Test Admin",
    passwordHash: await hashPassword(input.password),
    role: input.role ?? "admin",
    isActive: input.isActive ?? true,
  });
}

/** Seeds an admin and returns a usable access token. */
export async function seedAdminAndLogin(
  baseUrl: string,
  input: {
    email: string;
    password: string;
    role?: "manager" | "admin" | "super_admin";
  },
): Promise<string> {
  await seedAdmin(input);

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password }),
  });

  const body = (await response.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

/**
 * Produces a real PNG of the requested size.
 *
 * Upload tests must exercise the actual decode → validate → re-encode path, so
 * a fixture has to be a genuine image. A buffer of random bytes would only
 * prove the rejection branch works.
 */
export async function makeTestImage(
  width = 800,
  height = 800,
  colour: { r: number; g: number; b: number } = { r: 20, g: 120, b: 200 },
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width, height, channels: 3, background: colour },
  })
    .png()
    .toBuffer();
}

/**
 * Multipart upload helper — `fetch` builds the boundary from a FormData.
 *
 * `fields` carries the text parts that travel WITH the files. Banners need it:
 * their artwork, link and description are one request, because splitting them
 * would make a half-applied edit possible.
 */
export async function uploadFiles<T = unknown>(
  baseUrl: string,
  path: string,
  files: { field: string; buffer: Buffer; filename: string; contentType?: string }[],
  options: {
    accessToken?: string;
    method?: string;
    fields?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  const form = new FormData();
  for (const file of files) {
    form.append(
      file.field,
      new Blob([new Uint8Array(file.buffer)], { type: file.contentType ?? "image/png" }),
      file.filename,
    );
  }
  for (const [name, value] of Object.entries(options.fields ?? {})) {
    form.append(name, value);
  }

  const headers: Record<string, string> = {};
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: form,
  });

  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: response.headers,
  };
}

/* -------------------------------------------------------------------------- */

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  /** Refresh cookie value parsed out of Set-Cookie, when present. */
  refreshCookie?: string;
}

export async function api<T = unknown>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    accessToken?: string;
    refreshCookie?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...options.headers };

  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;
  if (options.refreshCookie) {
    headers.cookie = `gng_refresh_token=${options.refreshCookie}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const body = (text ? JSON.parse(text) : null) as T;

  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /gng_refresh_token=([^;]+)/.exec(setCookie);
  const cookieValue = match?.[1];

  return {
    status: response.status,
    body,
    headers: response.headers,
    ...(cookieValue && cookieValue !== "" ? { refreshCookie: cookieValue } : {}),
  };
}
