import { NextResponse, type NextRequest } from "next/server";
import {
  RETURN_TO_COOKIE,
  RETURN_TO_PATH,
  returnToCookieOptions,
  safeReturnTo,
} from "@/lib/admin/return-to";

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

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (pathname === "/admin/login") {
    /* Already signed in — skip the form, but honour where they were headed.
       Forgetting the destination here would silently strand anyone who followed
       a link to a specific order or product back on the overview. */
    if (hasSession) {
      const target = safeReturnTo(request.cookies.get(RETURN_TO_COOKIE)?.value);
      const response = NextResponse.redirect(new URL(target, request.url));
      response.cookies.delete({ name: RETURN_TO_COOKIE, path: RETURN_TO_PATH });
      return response;
    }

    /* A `?next=` still arrives from two places: an old bookmark, and the panel
       itself, which bounces an expired session here from the browser and has no
       way to write a server cookie. Absorb it and redirect to the bare address
       — the destination is kept, and the parameter never reaches the page the
       admin reads while typing a password. */
    const fromQuery = request.nextUrl.searchParams.get("next");
    if (fromQuery !== null) {
      const response = NextResponse.redirect(new URL("/admin/login", request.url));
      const target = safeReturnTo(fromQuery);
      if (target === "/admin") {
        response.cookies.delete({ name: RETURN_TO_COOKIE, path: RETURN_TO_PATH });
      } else {
        response.cookies.set(RETURN_TO_COOKIE, target, returnToCookieOptions);
      }
      return response;
    }

    return NextResponse.next();
  }

  if (!hasSession) {
    const response = NextResponse.redirect(new URL("/admin/login", request.url));

    if (pathname !== "/admin") {
      /* Remembered in a cookie rather than a `?next=` parameter, so the sign-in
         page keeps a plain address. Path-only, and validated again on the way
         out, so it cannot become an open redirect. */
      response.cookies.set(RETURN_TO_COOKIE, pathname + search, returnToCookieOptions);
    } else {
      /* Going to the dashboard is itself a destination. Leaving an older cookie
         in place would send this admin somewhere they did not ask for. */
      response.cookies.delete({ name: RETURN_TO_COOKIE, path: RETURN_TO_PATH });
    }

    return response;
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
