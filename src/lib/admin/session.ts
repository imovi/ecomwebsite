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
const ROLE_COOKIE = "gng_admin_role";

/** The API's own refresh cookie name, as set on its responses. */
const API_REFRESH_COOKIE = "gng_refresh_token";

const cookieOptions = {
  httpOnly: true,
  /**
   * Off only when the deployment has explicitly said it has no HTTPS.
   *
   * These are the panel's OWN session cookies, separate from the refresh cookie
   * the API sets — so the API's flag alone does not cover them. Without this,
   * signing in over plain HTTP appears to succeed, the browser silently drops
   * every Secure cookie, and the next request bounces back to the login page
   * with nothing on screen explaining why.
   *
   * Read from the server environment, never `NEXT_PUBLIC_*`: this file runs
   * server-side only, and a public build-time flag would bake the weaker
   * setting into the bundle for every future deployment of that image.
   */
  secure: isProduction && process.env.ALLOW_INSECURE_COOKIES !== "true",
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
    store.set(ROLE_COOKIE, session.admin.role, {
      ...cookieOptions,
      httpOnly: false,
      maxAge: REFRESH_MAX_AGE,
    });
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, ADMIN_COOKIE, ROLE_COOKIE]) {
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

/* -------------------------------------------------------------------------- */
/* Forgotten password                                                         */
/* -------------------------------------------------------------------------- */

export type ResetOutcome =
  | {
      ok: true;
      message: string;
      /**
       * False when the server has no email or Telegram channel configured.
       *
       * Not an account fact — it is the same answer for every address — so it
       * carries no enumeration risk. The client needs it so it does not move on
       * to the code screen and ask for a code that cannot be sent.
       */
      canDeliver: boolean;
    }
  | { ok: false; error: string };

/**
 * Calls an unauthenticated auth endpoint and returns its message either way.
 *
 * Both reset endpoints answer in the same envelope and neither returns a
 * session, so there is nothing to store — this only relays what the API said.
 * The API's wording is passed through unchanged on purpose: `/forgot-password`
 * deliberately answers identically for an address that exists and one that does
 * not, and rewriting the message here is how that property gets lost.
 */
async function postAuth(path: string, body: unknown): Promise<ResetOutcome> {
  let response: Response;

  try {
    response = await fetch(`${apiConfig.baseUrl}/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(apiConfig.timeoutMs),
    });
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<{
    message: string;
    canDeliver?: boolean;
  }> | null;

  if (!response.ok || !envelope || !envelope.success) {
    return {
      ok: false,
      error:
        envelope && !envelope.success
          ? envelope.error.message
          : "Something went wrong. Please try again.",
    };
  }

  /* Absent on /reset-password, which has no delivery step — default true so
     that endpoint is never mistaken for an unconfigured server. */
  return { ok: true, message: envelope.data.message, canDeliver: envelope.data.canDeliver ?? true };
}

/** Asks the API to send a one-time code. */
export async function requestResetCode(email: string): Promise<ResetOutcome> {
  return postAuth("forgot-password", { email });
}

/** Spends the code and sets the new password. */
export async function submitResetCode(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<ResetOutcome> {
  return postAuth("reset-password", input);
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

export { ACCESS_COOKIE, REFRESH_COOKIE, ADMIN_COOKIE, ROLE_COOKIE, API_REFRESH_COOKIE };
