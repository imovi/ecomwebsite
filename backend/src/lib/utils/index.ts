import { randomBytes } from "node:crypto";

/**
 * Small, dependency-free helpers.
 *
 * The bar for adding something here: used by at least two modules, pure, and
 * genuinely non-obvious. A one-line wrapper around a standard library call
 * does not belong.
 */

/* -------------------------------------------------------------------------- */
/* Async                                                                      */
/* -------------------------------------------------------------------------- */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an operation with exponential backoff and jitter.
 *
 * Jitter is not decoration: without it, every client that failed at the same
 * moment retries at the same moment, and the thundering herd knocks over the
 * dependency that was recovering.
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5_000,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) break;

      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(backoff / 2 + Math.random() * (backoff / 2));
    }
  }

  throw lastError;
}

/** Rejects if a promise outruns `ms`. Guards against a hung dependency. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = "Operation timed out",
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Objects                                                                    */
/* -------------------------------------------------------------------------- */

/** Keeps only the listed keys. Use when building a response from a row. */
export function pick<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in source) result[key] = source[key];
  }
  return result;
}

/** Drops the listed keys. Prefer `pick` for anything user-facing — omit is a
 *  denylist, and a new sensitive column added later is exposed by default. */
export function omit<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Omit<T, K> {
  const result = { ...source };
  for (const key of keys) delete result[key];
  return result;
}

/** Strips undefined values — useful before a partial database update. */
export function compact<T extends Record<string, unknown>>(source: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/* -------------------------------------------------------------------------- */
/* Strings and identifiers                                                    */
/* -------------------------------------------------------------------------- */

/** URL-safe random string, for tokens and one-off codes. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Human-readable reference, e.g. `ORD-7F3K9Q`.
 *
 * The alphabet omits 0/O/1/I/L — these get read aloud over the phone, and
 * "zero or oh?" is a support call nobody needs.
 */
const UNAMBIGUOUS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function referenceCode(prefix: string, length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += UNAMBIGUOUS[bytes[i]! % UNAMBIGUOUS.length];
  }
  return `${prefix}-${code}`;
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(new RegExp("[\\u0300-\\u036F]", "g"), "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Masks all but the last `visible` characters — for logging identifiers. */
export function maskSecret(value: string, visible = 4): string {
  if (value.length <= visible) return "*".repeat(value.length);
  return "*".repeat(value.length - visible) + value.slice(-visible);
}

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

export const seconds = (n: number): number => n * 1000;
export const minutes = (n: number): number => n * 60_000;
export const hours = (n: number): number => n * 3_600_000;
export const days = (n: number): number => n * 86_400_000;

export function addSeconds(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * 1000);
}

export function isPast(date: Date): boolean {
  return date.getTime() <= Date.now();
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

/** Converts page/perPage into the limit/offset a query needs. */
export function toLimitOffset(pagination: { page: number; perPage: number }): {
  limit: number;
  offset: number;
} {
  return {
    limit: pagination.perPage,
    offset: (pagination.page - 1) * pagination.perPage,
  };
}
