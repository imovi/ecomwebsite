/**
 * Where to send an admin after they sign in.
 *
 * Someone who follows a link to a specific order and is not signed in should
 * land on that order once they are, not on the dashboard. That intent has to
 * survive a redirect to the login page and a form POST, so it is carried in a
 * short-lived httpOnly cookie rather than a `?next=` query parameter.
 *
 * The query parameter is what this replaced. It worked, but it put
 * `?next=%2Fadmin%2Fproducts%2Fnew` in the address bar of the one page an admin
 * looks at while typing a password — the moment a URL should look plain and
 * unremarkable. A cookie is invisible, and it cannot be edited by hand into a
 * redirect target the way a query string invites.
 */

/** Minutes, not days: this is a navigation intent, not a session. */
const MAX_AGE_SECONDS = 10 * 60;

export const RETURN_TO_COOKIE = "gng_admin_next";

/**
 * Scoped to the panel, so it is not attached to a customer's every page view
 * for the ten minutes it lives. Deletions must repeat the path or the browser
 * treats them as being about a different cookie.
 */
export const RETURN_TO_PATH = "/admin";

export const returnToCookieOptions = {
  httpOnly: true,
  /* Mirrors the session cookies in `session.ts` — over plain HTTP a Secure
     cookie is dropped silently, which here would look like the panel simply
     forgetting where you were going. */
  secure:
    process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "true",
  sameSite: "lax" as const,
  path: RETURN_TO_PATH,
  maxAge: MAX_AGE_SECONDS,
};

/**
 * A stored destination, or `/admin` when there is nothing usable.
 *
 * Only same-site admin paths are honoured. A path boundary is required rather
 * than a prefix match: `/adminx/evil` and `/admin.evil.com` both begin with
 * "/admin" while going somewhere else entirely.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return "/admin";
  /* Protocol-relative URLs (`//evil.example`) begin with a slash too, and the
     check below would otherwise be the only thing standing between a stale
     cookie and an off-site redirect. */
  if (value.startsWith("//")) return "/admin";
  if (value !== "/admin" && !value.startsWith("/admin/")) return "/admin";
  return value;
}
