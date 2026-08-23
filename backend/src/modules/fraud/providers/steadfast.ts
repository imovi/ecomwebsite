import { asJson, pick, request } from "./http.js";
import { credentialsRejected, upstreamFailed } from "./errors.js";
import { count, ratio, type CourierStat, type FraudCredentials, type FraudProvider } from "./types.js";

const NAME = "Steadfast";
const BASE = "https://steadfast.com.bd";

/**
 * Steadfast, through the merchant panel's own login.
 *
 * The only one of the five that is a plain web form rather than a JSON login,
 * so the sequence is what a browser does: fetch the page, read the CSRF token
 * out of it, post the form, and carry the session cookie to the check.
 *
 * The token is scraped from HTML with a regular expression, which is exactly
 * as fragile as it sounds — if Steadfast restyles that page this stops working.
 * That is why a missing token is reported as an upstream change rather than a
 * bad password: the distinction tells whoever reads it whether to edit
 * Settings or to call for a code fix.
 */
export const steadfast: FraudProvider = {
  name: NAME,
  identifierLabel: "Merchant email",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    const page = await request(NAME, `${BASE}/login`);
    const token = /name="_token"\s+value="([^"]+)"/.exec(page.body)?.[1];

    if (!token) {
      throw upstreamFailed(NAME, "login page no longer carries a recognisable form token.");
    }

    const login = await request(NAME, `${BASE}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        _token: token,
        email: credentials.identifier,
        password: credentials.secret,
      }).toString(),
      cookies: page.cookies,
      /* A successful sign-in redirects to the dashboard; a failed one renders
         the login page again with an error. Following the redirect would hide
         which happened, so the status is read directly. */
      redirect: "manual",
    });

    if (login.status === 200 && /invalid|incorrect|credentials/i.test(login.body)) {
      throw credentialsRejected(NAME);
    }

    const session = [...page.cookies, ...login.cookies];

    const check = await request(NAME, `${BASE}/user/frauds/check/${encodeURIComponent(phone)}`, {
      cookies: session,
      headers: { "x-requested-with": "XMLHttpRequest" },
    });

    /* Being bounced back to a login page means the session never took — the
       password is the likeliest reason, and it is the only one the shop can
       act on. */
    if (check.status === 401 || check.status === 419 || /<form[^>]+login/i.test(check.body)) {
      throw credentialsRejected(NAME, "the session was not accepted");
    }

    const data = asJson(NAME, check.body);
    const success = count(pick(data, "total_delivered"));
    const cancel = count(pick(data, "total_cancelled"));

    return { success, cancel, total: success + cancel, successRatio: ratio(success, success + cancel) };
  },
};
