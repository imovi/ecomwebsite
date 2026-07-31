import "server-only";

import { apiConfig } from "./config";
import type { ApiEnvelope } from "./types";

/**
 * Backend HTTP client. Server-side only.
 *
 * The browser never calls the API directly — every request goes through this
 * Next server. That means the backend can live on a private network, needs no
 * CORS allow-list for the storefront, and no access token ever reaches the
 * client.
 *
 * Three behaviours that matter on a Bangladeshi mobile connection:
 *
 *  - **Every request has a timeout.** A hung backend must not hold a page
 *    render open until the platform kills it; the shopper sees an error page
 *    far sooner than they see a spinner that never resolves.
 *  - **Idempotent reads retry once.** A single dropped TCP connection should
 *    not turn into an empty catalogue.
 *  - **Writes never retry.** Retrying a POST that may have succeeded is how
 *    you create two orders. The checkout path uses an idempotency key instead.
 */

/** Thrown for any non-2xx response, carrying the backend's error contract. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: { field: string; message: string }[];
  readonly requestId?: string;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: { field: string; message: string }[];
    requestId?: string;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    if (options.details) this.details = options.details;
    if (options.requestId) this.requestId = options.requestId;
  }

  /** True when the resource is simply absent — callers usually map this to a
   *  404 page rather than an error page. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Raised when the backend is unreachable or too slow, as opposed to refusing. */
export class ApiUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ApiUnavailableError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Bearer token for admin calls. Public storefront reads send none. */
  accessToken?: string | undefined;
  headers?: Record<string, string>;
  /**
   * ISR window in seconds. `0` opts out of caching entirely — correct for
   * anything user-specific or freshly mutated.
   */
  revalidate?: number;
  /** Cache tags, so an admin edit can revalidate exactly what it changed. */
  tags?: string[];
  /** Forwarded so a storefront trace can be followed into the API's logs. */
  requestId?: string;
}

function isRetryable(method: string, status?: number): boolean {
  if (method !== "GET") return false;
  /* 5xx and 429 are worth one more attempt; a 4xx will fail identically. */
  return status === undefined || status >= 500 || status === 429;
}

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  const text = await response.text();
  if (!text) {
    return {
      success: false,
      error: { code: "EMPTY_RESPONSE", message: "The API returned an empty response." },
      requestId: "",
    };
  }

  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    return {
      success: false,
      error: {
        code: "MALFORMED_RESPONSE",
        message: `The API returned a non-JSON response (${response.status}).`,
      },
      requestId: "",
    };
  }
}

async function attempt<T>(path: string, options: RequestOptions): Promise<T> {
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {
    accept: "application/json",
    ...options.headers,
  };

  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;
  if (options.requestId) headers["x-request-id"] = options.requestId;

  /* AbortSignal.timeout rather than a manual setTimeout: it cancels the
     underlying socket instead of merely abandoning the promise. */
  const signal = AbortSignal.timeout(apiConfig.timeoutMs);

  const cache =
    method === "GET" && options.revalidate !== 0
      ? {
          next: {
            revalidate: options.revalidate ?? apiConfig.revalidateSeconds,
            ...(options.tags ? { tags: options.tags } : {}),
          },
        }
      : { cache: "no-store" as const };

  let response: Response;
  try {
    response = await fetch(`${apiConfig.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
      ...cache,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? `timed out after ${apiConfig.timeoutMs}ms`
        : "could not be reached";
    throw new ApiUnavailableError(`The API ${reason} (${method} ${path}).`, error);
  }

  const envelope = await parseEnvelope<T>(response);

  if (!response.ok || !envelope.success) {
    const failure = envelope.success ? undefined : envelope;
    throw new ApiError({
      status: response.status,
      code: failure?.error.code ?? "UNKNOWN_ERROR",
      message: failure?.error.message ?? `Request failed with status ${response.status}.`,
      ...(failure?.error.details ? { details: failure.error.details } : {}),
      ...(failure?.requestId ? { requestId: failure.requestId } : {}),
    });
  }

  return envelope.data;
}

/**
 * Performs a request and unwraps the response envelope.
 *
 * Throws `ApiError` for a refusal and `ApiUnavailableError` for a transport
 * failure. Callers that treat "absent" as normal should use `apiRequestOptional`.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";

  try {
    return await attempt<T>(path, options);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    if (!isRetryable(method, status)) throw error;

    /* One retry, with a short pause. Anything more on a page render is worse
       than failing fast — the shopper is waiting. */
    await new Promise((resolve) => setTimeout(resolve, 250));
    return attempt<T>(path, options);
  }
}

/** Returns null on 404 instead of throwing. */
export async function apiRequestOptional<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T | null> {
  try {
    return await apiRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
}

/**
 * Read that degrades to a fallback instead of breaking the page.
 *
 * Used for secondary content — a related-products rail, a category strip. A
 * homepage that renders without its trending row is worth far more than one
 * that 500s because a single query failed.
 *
 * Deliberately NOT used for the cart, checkout, or anything a customer is
 * about to pay against: silently showing an empty or stale figure there would
 * be worse than an honest error.
 */
export async function apiRequestSafe<T>(
  path: string,
  fallback: T,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, options);
  } catch (error) {
    console.error(
      `[api] non-critical read failed, using fallback: ${path}`,
      error instanceof Error ? error.message : error,
    );
    return fallback;
  }
}

/** Builds a query string, omitting empty values. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}
