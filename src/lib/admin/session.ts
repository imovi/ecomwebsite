import "server-only";

import { cookies } from "next/headers";
import { apiConfig, isProduction } from "@/lib/api/config";
import type { ApiAdmin, ApiEnvelope, ApiLogin } from "@/lib/api/types";

/**
 * Admin session.
 *
 * The API issues a short-lived access token (in the response body) and a
 * rotating refresh token (as a cookie on ITS own domain). The browser never
 * talks to the API, so this Next server acts as the API's client: it captures
 * both credentials and stores them in its own httpOnly cookies.
 *
 * WHY TOKENS NEVER REACH THE BROWSER
 * ----------------------------------
 * An access token in `localStorage` is readable by any XSS. Here the browser
 * holds only an opaque httpOnly cookie for THIS origin, and every API call goes
 * through a server-side proxy that attaches the real bearer token. A successful
 * XSS on the storefront can make requests as the admin while the page is open,
 * but cannot exfiltrate a credential to use later.
 *
 * Refresh rotation is handled in one place — the proxy route handler — because
 * only a route handler or a server action may set cookies. A server component
 * cannot, which is why admin pages fetch through the proxy rather than calling
 * the API directly.
 */

const ACCESS_COOKIE = "gng_admin_at";
const REFRESH_COOKIE = "gng_admin_rt";
const ADMIN_COOKIE = "gng_admin_who";

/** The API's own refresh cookie name, as set on its responses. */
const API_REFRESH_COOKIE = "gng_refresh_token";

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
};

/** Access tokens are short-lived by design; the refresh token carries longevity. */
const ACCESS_MAX_AGE = 60 * 20;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14;

export interface AdminSession {
  accessToken: string;
  refreshToken: string;
  admin: ApiAdmin;
}

/* -------------------------------------------------------------------------- */
/* Cookie plumbing                                                            */
/* -------------------------------------------------------------------------- */

/** Pulls the API's refresh token out of a `Set-Cookie` header. */
export function extractRefreshToken(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = new RegExp(`${API_REFRESH_COOKIE}=([^;]+)`).exec(setCookieHeader);
  const value = match?.[1];
  /* An expired cookie carries an empty value — that is a clear, not a token. */
  return value && value !== "" ? value : null;
}

export async function readSession(): Promise<{
  accessToken?: string;
  refreshToken?: string;
  admin?: ApiAdmin;
}> {
  const store = await cookies();

  const raw = store.get(ADMIN_COOKIE)?.value;
  let admin: ApiAdmin | undefined;

  if (raw) {
    try {
      admin = JSON.parse(decodeURIComponent(raw)) as ApiAdmin;
    } catch {
      /* A corrupt identity cookie is not worth failing over; the proxy will
         re-authenticate or redirect to login. */
    }
  }

  return {
    accessToken: store.get(ACCESS_COOKIE)?.value,
    refreshToken: store.get(REFRESH_COOKIE)?.value,
    ...(admin ? { admin } : {}),
  };
}

/** Writes the session. Callable only from a route handler or server action. */
export async function writeSession(session: {
  accessToken: string;
  refreshToken?: string | null;
  admin?: ApiAdmin;
}): Promise<void> {
  const store = await cookies();

  store.set(ACCESS_COOKIE, session.accessToken, {
    ...cookieOptions,
    maxAge: ACCESS_MAX_AGE,
  });

  /* A refresh that rotates returns a new token; one that does not leaves the
     stored value alone rather than clearing it. */
  if (session.refreshToken) {
    store.set(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_MAX_AGE,
    });
  }

  if (session.admin) {
    /* Identity only — name, email, role — so the shell can render without a
       round trip. Not httpOnly-sensitive, but kept httpOnly anyway since only
       the server reads it. */
    store.set(ADMIN_COOKIE, encodeURIComponent(JSON.stringify(session.admin)), {
      ...cookieOptions,
      maxAge: REFRESH_MAX_AGE,
    });
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, ADMIN_COOKIE]) {
    store.delete(name);
  }
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

export type LoginOutcome =
  | { ok: true; admin: ApiAdmin }
  | { ok: false; error: string };

/**
 * Signs in against the API and stores the resulting session.
 *
 * Failure messages are passed through unchanged: the API already returns one
 * deliberately identical message for "no such account" and "wrong password", so
 * repeating it here preserves that property instead of accidentally leaking
 * which admin emails exist.
 */
export async function login(email: string, password: string): Promise<LoginOutcome> {
  let response: Response;

  try {
    response = await fetch(`${apiConfig.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(apiConfig.timeoutMs),
    });
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }

  const body = (await response.json().catch(() => null)) as ApiEnvelope<ApiLogin> | null;

  if (!response.ok || !body || !body.success) {
    return {
      ok: false,
      error:
        body && !body.success
          ? body.error.message
          : "Sign in failed. Please try again.",
    };
  }

  await writeSession({
    accessToken: body.data.accessToken,
    refreshToken: extractRefreshToken(response.headers.get("set-cookie")),
    admin: body.data.admin,
  });

  return { ok: true, admin: body.data.admin };
}

/**
 * Exchanges the stored refresh token for a fresh access token.
 *
 * Returns null when the refresh fails, which the caller treats as "session
 * over". A failed refresh is not always benign: the API revokes an entire token
 * family when it detects a reused refresh token, so this can mean the session
 * was hijacked. Either way the correct response is to clear and re-authenticate.
 */
export async function refreshSession(refreshToken: string): Promise<string | null> {
  let response: Response;

  try {
    response = await fetch(`${apiConfig.baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        /* The API reads its refresh token from a cookie; this server is the
           client holding it, so it is replayed by hand. */
        cookie: `${API_REFRESH_COOKIE}=${refreshToken}`,
      },
      body: JSON.stringify({}),
      cache: "no-store",
      signal: AbortSignal.timeout(apiConfig.timeoutMs),
    });
  } catch {
    return null;
  }

  const body = (await response.json().catch(() => null)) as ApiEnvelope<ApiLogin> | null;
  if (!response.ok || !body || !body.success) return null;

  await writeSession({
    accessToken: body.data.accessToken,
    refreshToken: extractRefreshToken(response.headers.get("set-cookie")),
    admin: body.data.admin,
  });

  return body.data.accessToken;
}

/** Ends the session both here and at the API, so the refresh token is revoked. */
export async function logout(): Promise<void> {
  const { accessToken, refreshToken } = await readSession();

  if (accessToken && refreshToken) {
    /* Best effort. A failure here still clears the local session — leaving a
       user apparently signed in because the API call failed would be worse. */
    await fetch(`${apiConfig.baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        cookie: `${API_REFRESH_COOKIE}=${refreshToken}`,
      },
      body: JSON.stringify({}),
      cache: "no-store",
      signal: AbortSignal.timeout(apiConfig.timeoutMs),
    }).catch(() => undefined);
  }

  await clearSession();
}

export { ACCESS_COOKIE, REFRESH_COOKIE, ADMIN_COOKIE, API_REFRESH_COOKIE };
