import { NextResponse, type NextRequest } from "next/server";
import { apiConfig } from "@/lib/api/config";
import { readSession, refreshSession, clearSession } from "@/lib/admin/session";
import { siteConfig } from "@/lib/api/config";

/**
 * Authenticated API proxy for the admin panel.
 *
 * The browser calls `/api/admin/<api-path>`; this handler attaches the bearer
 * token and forwards to `/api/v1/<api-path>`. The mapping is deliberately 1:1,
 * which is why URLs read `/api/admin/admin/orders` — the API namespaces its own
 * admin routes under `/admin`, and collapsing the repetition here would make
 * the allowlist below harder to audit against the real routing table.
 *
 * It is the ONLY place token refresh happens,
 * for a mundane reason: refreshing rotates the refresh token, and writing a
 * cookie is only possible in a route handler or a server action. Letting admin
 * pages call the API directly from server components would mean a rotated token
 * could never be persisted, and the session would die every 15 minutes.
 *
 * Three properties worth stating explicitly:
 *
 * 1. PATH ALLOWLIST. A proxy that forwards an arbitrary path is an SSRF hole
 *    and a way to reach endpoints the panel has no business calling. Only the
 *    admin surface and `/auth/me` are reachable.
 *
 * 2. CSRF. The session cookie is `SameSite=Lax`, which browsers do not send on
 *    a cross-site POST/PATCH/DELETE, so state-changing requests are already
 *    protected. The origin check below is defence in depth for the case where
 *    that assumption is wrong (an old browser, a misconfigured proxy).
 *
 * 3. ONE RETRY. A 401 triggers exactly one refresh-and-retry. Looping would
 *    turn an expired session into an infinite request storm.
 */

/** Everything the admin panel legitimately needs, and nothing else. */
const ALLOWED_PATHS = [
  /^admin\/products(\/.*)?$/,
  /^admin\/categories(\/.*)?$/,
  /^admin\/orders(\/.*)?$/,
  /^admin\/settings$/,
  /^admin\/settings\/logo$/,
  /^admin\/banners(\/.*)?$/,
  /^admin\/marketing\/(status|test-event)$/,
  /^admin\/team(\/.*)?$/,
  /^admin\/integrations\/(status|telegram\/(test|find-chats)|sheets\/test)$/,
  /^admin\/expenses(\/.*)?$/,
  /* Reads only, and `profit.csv` is a distinct path rather than a query flag
     so the allowlist can name it. */
  /^admin\/reports\/profit(\.csv)?$/,
  /^admin\/abandoned(\/.*)?$/,
  /^admin\/courier\/(status|test|sync)$/,
  /^admin\/courier\/(order|shipment)\/[^/]+(\/send|\/sync)?$/,
  /^auth\/me$/,
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Statuses the fetch spec forbids a body on.
 *
 * `new Response(body, { status: 204 })` throws rather than ignoring the body, so
 * these have to be constructed with `null`.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);


/**
 * Headers worth forwarding upstream. An allowlist rather than a blocklist:
 * `host`, `cookie` and `connection` must never be passed through, and a
 * blocklist would silently start leaking whatever header is invented next.
 */
const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "idempotency-key", "if-match"];

function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Your session has expired. Please sign in again." },
    },
    { status: 401 },
  );
}

/** Rejects a cross-origin write before it can reach the API. */
function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  /* Same-origin fetch from a modern browser sends `Origin` on writes. Its
     absence means a non-browser client, which the Lax cookie already covers. */
  if (!origin) return true;

  const allowed = new Set([siteConfig.url, request.nextUrl.origin]);
  return allowed.has(origin.replace(/\/+$/, ""));
}

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const apiPath = path.join("/");

  if (!ALLOWED_PATHS.some((pattern) => pattern.test(apiPath))) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Unknown admin endpoint." } },
      { status: 404 },
    );
  }

  if (WRITE_METHODS.has(request.method) && !originAllowed(request)) {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Cross-origin request rejected." } },
      { status: 403 },
    );
  }

  const session = await readSession();
  if (!session.accessToken && !session.refreshToken) return unauthorized();

  /* Buffered rather than streamed. Streaming a request body through `fetch`
     needs `duplex: "half"` and forfeits the ability to replay it — and replay is
     exactly what the 401 retry below requires. Uploads are capped at a few
     megabytes by the API, so buffering costs nothing that matters. */
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  const target = `${apiConfig.baseUrl}/api/v1/${apiPath}${request.nextUrl.search}`;

  const send = async (token: string): Promise<Response> => {
    const headers = new Headers({ authorization: `Bearer ${token}` });

    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    return fetch(target, {
      method: request.method,
      headers,
      ...(body && body.byteLength > 0 ? { body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(apiConfig.timeoutMs * 4),
    });
  };

  let token = session.accessToken;
  let response: Response;

  try {
    if (token) {
      response = await send(token);

      if (response.status === 401 && session.refreshToken) {
        const refreshed = await refreshSession(session.refreshToken);
        if (!refreshed) {
          await clearSession();
          return unauthorized();
        }
        token = refreshed;
        response = await send(refreshed);
      }
    } else if (session.refreshToken) {
      /* Access cookie expired but the refresh cookie outlives it — the common
         case when the admin returns after a break. */
      const refreshed = await refreshSession(session.refreshToken);
      if (!refreshed) {
        await clearSession();
        return unauthorized();
      }
      response = await send(refreshed);
    } else {
      return unauthorized();
    }
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "SERVICE_UNAVAILABLE", message: "Could not reach the server." },
      },
      { status: 503 },
    );
  }

  if (response.status === 401) {
    /* A fresh token was still rejected: the account was disabled or its token
       family revoked. Nothing to retry. */
    await clearSession();
    return unauthorized();
  }

  /* Invoices come back as HTML, the profit export as CSV, everything else as
     JSON. Passed through as bytes with the upstream content type so all three
     work without special-casing. */
  const payload = await response.arrayBuffer();
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  /* Without this the CSV export renders as text in the tab instead of saving
     as a file — the header is the entire difference between a download and a
     wall of commas. */
  const disposition = response.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);

  headers.set("cache-control", "no-store");

  /**
   * 204 and friends are null-body statuses: the `Response` constructor THROWS if
   * given a body with one, and that throw surfaced here as a 500.
   *
   * Every delete in the API answers 204, so this turned a successful "category
   * deleted" into an error in the panel — the operator sees a failure, retries,
   * and gets a 404 for a row that was already gone.
   */
  if (NULL_BODY_STATUSES.has(response.status)) {
    return new NextResponse(null, { status: response.status, headers });
  }

  return new NextResponse(payload, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

/** Uploads and order edits must never be served from a cache. */
export const dynamic = "force-dynamic";
