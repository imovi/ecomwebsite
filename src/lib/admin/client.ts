"use client";

import { revalidateStorefront, type RevalidateScope } from "@/lib/admin/revalidate";
import type { ApiEnvelope } from "@/lib/api/types";

/**
 * Browser-side API access for the admin panel.
 *
 * Every call goes to `/api/admin/...` on this origin. The proxy there attaches
 * the bearer token and handles refresh, so nothing in this file knows a token
 * exists — which is the point: no credential is ever reachable from client
 * JavaScript.
 */

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** Field-level messages from the API's validation layer, when present. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** A 401 means the session ended; the panel sends the admin back to sign in. */
function handleExpired(): never {
  const next = window.location.pathname + window.location.search;
  window.location.href = `/admin/login?next=${encodeURIComponent(next)}`;
  /* Navigation is asynchronous, so throw to stop the caller from rendering
     against a failed response in the meantime. */
  throw new AdminApiError("Session expired.", 401, "UNAUTHENTICATED");
}

interface ApiFieldIssue {
  field?: string;
  message: string;
}

/**
 * Turns the API's `[{ field: "body.price", message }]` into `{ price: message }`.
 *
 * The `body.` / `query.` / `params.` prefix tells the API which part of the
 * request failed; a form only cares about the field name, so it is stripped and
 * the mapping stays a plain lookup by input name.
 */
function collectFields(details: unknown): Record<string, string> | undefined {
  if (!Array.isArray(details)) return undefined;

  const fields: Record<string, string> = {};
  for (const issue of details as ApiFieldIssue[]) {
    if (!issue.field || !issue.message) continue;
    const key = issue.field.replace(/^(body|query|params)\./, "");
    /* First message wins — a field with several failing rules should show the
       first, not whichever happened to be last in the array. */
    fields[key] ??= issue.message;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

export interface Pagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Which storefront caches a write invalidates, from the endpoint it targeted.
 *
 * Order writes map to nothing on purpose — no storefront page caches an order,
 * so evicting the catalogue after confirming a phone number would be pure waste
 * on the busiest screen in the panel.
 */
function scopeFor(path: string): RevalidateScope | null {
  if (path.startsWith("admin/products")) return "products";
  if (path.startsWith("admin/categories")) return "categories";
  if (path.startsWith("admin/banners")) return "banners";
  if (path.startsWith("admin/settings")) return "settings";
  return null;
}

async function request<T>(
  path: string,
  init: RequestInit & { rawBody?: BodyInit } = {},
): Promise<{ data: T; pagination?: Pagination }> {
  const { rawBody, ...rest } = init;
  const normalizedPath = path.replace(/^\/+/, "");

  const response = await fetch(`/api/admin/${normalizedPath}`, {
    ...rest,
    /* Multipart bodies must keep the browser-generated boundary, so the caller
       passes them through `rawBody` and no content-type is set here. */
    ...(rawBody ? { body: rawBody } : {}),
    headers: {
      ...(rawBody ? {} : rest.body ? { "content-type": "application/json" } : {}),
      accept: "application/json",
      ...rest.headers,
    },
    cache: "no-store",
  });

  if (response.status === 401) handleExpired();

  /* Only once the API has accepted the write. Dropping the storefront cache on a
     rejected request would evict good data for nothing. Awaited so a caller that
     navigates straight to the shop cannot beat the invalidation. */
  const method = rest.method ?? "GET";
  if (response.ok && method !== "GET") {
    const scope = scopeFor(normalizedPath);
    if (scope) await revalidateStorefront(scope);
  }

  /* Deletes answer 204 with no body, so parsing one would throw and turn a
     success into an error. */
  if (response.status === 204) return { data: undefined as T };

  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok || !body || !body.success) {
    const error = body && !body.success ? body.error : null;
    throw new AdminApiError(
      error?.message ?? "Something went wrong. Please try again.",
      response.status,
      error?.code ?? "UNKNOWN",
      collectFields(error?.details),
    );
  }

  return {
    data: body.data,
    ...(body.meta?.pagination ? { pagination: body.meta.pagination } : {}),
  };
}

/** Unwraps to the payload. Use `list` instead when pagination matters. */
async function data<T>(
  path: string,
  init?: RequestInit & { rawBody?: BodyInit },
): Promise<T> {
  return (await request<T>(path, init)).data;
}

export const adminApi = {
  get: <T>(path: string) => data<T>(path),

  /**
   * Paginated read.
   *
   * The API's paginated envelope puts the array directly in `data` and the page
   * counts in `meta`, so `get` would silently drop the total — which is exactly
   * the number a listing header needs.
   */
  list: async <T>(path: string): Promise<{ items: T[]; pagination?: Pagination }> => {
    const result = await request<T[]>(path);
    return { items: result.data, ...(result.pagination ? { pagination: result.pagination } : {}) };
  },

  post: <T>(path: string, body: unknown) =>
    data<T>(path, { method: "POST", body: JSON.stringify(body) }),

  patch: <T>(path: string, body: unknown) =>
    data<T>(path, { method: "PATCH", body: JSON.stringify(body) }),

  /**
   * Idempotent replace.
   *
   * Used where saving the same thing twice must correct it rather than add a
   * second one — daily ad spend being the case that matters, since it is
   * entered by hand and corrected often.
   */
  put: <T>(path: string, body: unknown) =>
    data<T>(path, { method: "PUT", body: JSON.stringify(body) }),

  delete: <T>(path: string) => data<T>(path, { method: "DELETE" }),

  /**
   * Multipart upload — product photos, category pictures, the logo, banners.
   */
  upload: <T>(path: string, form: FormData, method: "POST" | "PATCH" = "POST") =>
    data<T>(path, { method, rawBody: form }),

  /**
   * Multipart upload with real-time percentage progress callback.
   */
  uploadWithProgress: <T>(
    path: string,
    form: FormData,
    onProgress?: (percent: number) => void,
    method: "POST" | "PATCH" = "POST",
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const normalizedPath = path.replace(/^\/+/, "");
      const xhr = new XMLHttpRequest();
      xhr.open(method, `/api/admin/${normalizedPath}`);
      xhr.setRequestHeader("accept", "application/json");

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
            onProgress(percent);
          }
        };
      }

      xhr.onload = async () => {
        if (xhr.status === 401) handleExpired();

        const scope = scopeFor(normalizedPath);
        if (xhr.status >= 200 && xhr.status < 300 && method !== "GET" && scope) {
          await revalidateStorefront(scope).catch(() => {});
        }

        if (xhr.status === 204) {
          resolve(undefined as T);
          return;
        }

        let body: ApiEnvelope<T> | null = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }

        if (xhr.status < 200 || xhr.status >= 300 || !body || !body.success) {
          const error = body && !body.success ? body.error : null;
          reject(
            new AdminApiError(
              error?.message ?? "Something went wrong. Please try again.",
              xhr.status,
              error?.code ?? "UNKNOWN",
              collectFields(error?.details),
            ),
          );
          return;
        }

        resolve(body.data);
      };

      xhr.onerror = () => {
        reject(new AdminApiError("Network error during upload.", 0, "NETWORK_ERROR"));
      };

      xhr.send(form);
    });
  },
};

/** Builds a query string, dropping empty values so URLs stay readable. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}
