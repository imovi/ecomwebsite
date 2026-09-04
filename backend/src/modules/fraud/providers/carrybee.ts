import { asJson, pick, request } from "./http.js";
import { credentialsRejected, upstreamFailed } from "./errors.js";
import { count, ratio, type CourierStat, type FraudCredentials, type FraudProvider } from "./types.js";

const NAME = "Carrybee";
const PANEL = "https://merchant.carrybee.com";
const API = "https://api-merchant.carrybee.com";

/**
 * Carrybee, which takes four requests to answer one question.
 *
 * Its panel signs in the way a JavaScript app does: fetch a CSRF token, post
 * the form to a callback, then read the session back out to get a bearer token
 * and the id of the business the account is looking at. That business id is
 * part of the check's own URL, so there is no shortcut past any of it.
 *
 * The longest chain of the five, and therefore the most ways to fail — each
 * step names itself, so the error says which one gave out.
 */
export const carrybee: FraudProvider = {
  name: NAME,
  identifierLabel: "API Key / Client ID",
  secretLabel: "Secret Key / API Token",
  hint: "Carrybee API Key or Merchant Phone & Secret.",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    const csrfResponse = await request(NAME, `${PANEL}/api/auth/csrf`, {
      headers: { referer: `${PANEL}/login` },
    });

    const csrfToken = pick(asJson(NAME, csrfResponse.body), "csrfToken");
    if (typeof csrfToken !== "string" || !csrfToken) {
      throw upstreamFailed(NAME, "did not issue a form token.");
    }

    const login = await request(NAME, `${PANEL}/api/auth/callback/login?`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: `${PANEL}/login` },
      body: new URLSearchParams({
        phone: withPlus(credentials.identifier),
        password: credentials.secret,
        csrfToken,
        callbackUrl: `${PANEL}/login`,
      }).toString(),
      cookies: csrfResponse.cookies,
      redirect: "manual",
    });

    const session = [...csrfResponse.cookies, ...login.cookies];

    const sessionResponse = await request(NAME, `${PANEL}/api/auth/session`, { cookies: session });
    const parsed = asJson(NAME, sessionResponse.body);

    const token = pick(parsed, "accessToken");
    const businessId = pick(parsed, "user", "selectedBusinessId");

    /* An empty session object is what Carrybee returns for a login it did not
       accept — there is no error status to read. A business id that is neither
       a string nor a number is the same thing: nothing usable came back. */
    const business =
      typeof businessId === "string" || typeof businessId === "number" ? String(businessId) : "";

    if (typeof token !== "string" || !token || !business) throw credentialsRejected(NAME);

    const check = await request(
      NAME,
      `${API}/api/v2/businesses/${encodeURIComponent(business)}` +
        `/fraud-check/${encodeURIComponent(phone)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );

    if (check.status === 401) throw credentialsRejected(NAME, "the token was not accepted");

    const data = pick(asJson(NAME, check.body), "data");
    const total = count(pick(data, "total_order"));
    const cancel = count(pick(data, "cancelled_order"));
    const success = Math.max(0, total - cancel);

    return { success, cancel, total, successRatio: ratio(success, total) };
  },
};

/**
 * Carrybee signs in with the number written the way a phone shows it.
 *
 * Same trap as RedX: the leading zero stays, because `88` plus `01…` is what
 * makes `880…`.
 */
function withPlus(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880")) return `+${digits}`;
  if (digits.startsWith("0")) return `+88${digits}`;
  return `+880${digits}`;
}
