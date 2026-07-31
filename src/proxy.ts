import { NextResponse, type NextRequest } from "next/server";

/**
 * Admin route guard.
 *
 * This is the `proxy` file convention — what earlier versions of Next called
 * `middleware`. The old name and the `middleware` export are both deprecated,
 * and the runtime here is always `nodejs` and cannot be configured.
 *
 * It checks only for the PRESENCE of a session cookie and does not validate the
 * token. That is deliberate: this runs on every matched request, and calling the
 * API to verify a JWT here would add a network round trip to every navigation.
 * Real enforcement lives in two places that cannot be bypassed:
 *
 *   - the API itself, which verifies the signature on every admin endpoint;
 *   - the route handler at /api/admin, which refuses to forward without a
 *     session.
 *
 * So a forged cookie gets you an empty admin shell whose every request fails
 * with 401. This guard exists to redirect real admins to the login page, not to
 * be the security boundary.
 */

const SESSION_COOKIES = ["gng_admin_at", "gng_admin_rt"];

/**
 * Only same-site admin paths are honoured as a redirect target.
 *
 * `next` arrives in a query string, so it is attacker-controlled: without this
 * an emailed `/admin/login?next=https://evil.example` would bounce an
 * authenticated admin straight off-site. Mirrors the check in
 * `lib/admin/actions.ts`, which guards the same parameter on the form path.
 */
function safeNext(value: string | null): string {
  if (!value) return "/admin";

  /* A path boundary is required, not a prefix match: `/adminx/evil` and
     `/admin.evil.com` both start with "/admin" while going somewhere else. */
  if (value !== "/admin" && !value.startsWith("/admin/")) return "/admin";

  /* Protocol-relative URLs start with a slash too, but cannot reach here given
     the check above. Kept as an explicit guard so a future loosening of that
     check does not quietly open a redirect. */
  if (value.startsWith("//")) return "/admin";

  return value;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (pathname === "/admin/login") {
    /* Already signed in — skip the form, but honour where they were headed.
       Dropping `next` here would silently strand anyone who followed a link to a
       specific order or product back on the overview. */
    if (hasSession) {
      const target = safeNext(request.nextUrl.searchParams.get("next"));
      return NextResponse.redirect(new URL(target, request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const login = new URL("/admin/login", request.url);
    /* Round-trip the intended destination so a bookmarked order page still
       lands where the admin meant to go after signing in. Path-only, and
       validated on the other side, so this cannot become an open redirect. */
    if (pathname !== "/admin") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  /* The admin panel shows customer names, phone numbers and addresses. Keep it
     out of shared caches and out of search indexes regardless of page config. */
  response.headers.set("cache-control", "no-store, no-cache, must-revalidate");
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
