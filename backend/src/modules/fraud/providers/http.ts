import { upstreamFailed } from "./errors.js";

/**
 * Talking to a merchant panel that was never meant to be talked to.
 *
 * These endpoints belong to the couriers' own dashboards. They answer HTML
 * when they feel like it, redirect to a login page when a session lapses, and
 * change without notice. Two rules follow, and both are enforced here rather
 * than repeated in five providers:
 *
 *   - Every request has a deadline. A courier panel that accepts a connection
 *     and then never answers would otherwise hold a request open until the
 *     admin gives up, and the order desk is waiting on the other end.
 *   - A response that is not what was expected raises a named failure. Reading
 *     `undefined` out of an HTML error page and calling it zero deliveries is
 *     how a good customer gets treated as a bad one.
 */

/** Long enough for a slow panel, short enough that the desk is not left waiting. */
const TIMEOUT_MS = 12_000;

/** These panels answer differently, or not at all, to something that is not a browser. */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Cookies to send, as already-formatted `name=value` pairs. */
  cookies?: string[];
  /** Follow redirects, or treat one as the failure it usually is. */
  redirect?: "follow" | "manual";
}

export interface RawResponse {
  status: number;
  body: string;
  /** `name=value` pairs from every `set-cookie` on the response. */
  cookies: string[];
}

export async function request(
  courier: string,
  url: string,
  options: FetchOptions = {},
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "application/json, text/plain, */*",
        ...(options.cookies?.length ? { cookie: options.cookies.join("; ") } : {}),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      redirect: options.redirect ?? "follow",
      signal: controller.signal,
    });

    return {
      status: response.status,
      body: await response.text(),
      cookies: readCookies(response),
    };
  } catch (caught) {
    /* An abort here is the deadline, not a caller cancelling — nothing else
       holds this controller. */
    const reason =
      caught instanceof Error && caught.name === "AbortError"
        ? `did not answer within ${TIMEOUT_MS / 1000}s`
        : caught instanceof Error
          ? caught.message
          : "unreachable";

    throw upstreamFailed(courier, `${reason}.`);
  } finally {
    clearTimeout(timer);
  }
}

/** The `name=value` part of every cookie the response set. */
function readCookies(response: Response): string[] {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((cookie) => cookie.split(";")[0]!.trim()).filter(Boolean);
}

/** Parses JSON, or says which courier sent something that was not JSON. */
export function asJson(courier: string, body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    /* Almost always a login page or a maintenance notice. Quoting the start of
       it makes the difference between "wrong password" and "they changed the
       endpoint" visible in the error the admin reads. */
    throw upstreamFailed(
      courier,
      `answered with something that is not JSON: ${body.slice(0, 80).replace(/\s+/g, " ")}`,
    );
  }
}

/** Reads a nested field, returning undefined rather than throwing on the way. */
export function pick(source: unknown, ...path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
