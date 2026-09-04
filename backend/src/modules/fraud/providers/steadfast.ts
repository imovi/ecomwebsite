import { asJson, pick, request } from "./http.js";
import { credentialsRejected, upstreamFailed } from "./errors.js";
import { count, ratio, type CourierStat, type FraudCredentials, type FraudProvider } from "./types.js";

const NAME = "Steadfast";
const BASE = "https://steadfast.com.bd";
const API_BASE = "https://portal.packzy.com/api/v1";

export const steadfast: FraudProvider = {
  name: NAME,
  identifierLabel: "API Key",
  secretLabel: "Secret Key",
  hint: "Official Steadfast API Key and Secret Key (no password needed).",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    const rawPhone = (phone || "").replace(/\D/g, "");
    const cleanDigits =
      rawPhone.length === 13 && rawPhone.startsWith("8801")
        ? rawPhone.slice(2)
        : rawPhone.length === 14 && rawPhone.startsWith("8801")
          ? rawPhone.slice(3)
          : rawPhone;

    // Official API Key & Secret Key check (Packzy API)
    if (!credentials.identifier.includes("@")) {
      try {
        const res = await fetch(`${API_BASE}/fraud_check/${encodeURIComponent(cleanDigits)}`, {
          method: "GET",
          headers: {
            "Api-Key": credentials.identifier.trim(),
            "Secret-Key": credentials.secret.trim(),
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10_000),
        });

        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const msg = typeof body?.message === "string" && body.message.trim() !== ""
          ? body.message.trim()
          : null;

        if (res.status === 401 || res.status === 403) {
          if (msg && msg.toLowerCase().includes("inactive")) {
            throw upstreamFailed(NAME, `account inactive: "${msg}"`);
          }
          throw credentialsRejected(NAME, msg || `HTTP ${res.status}`);
        }

        if (res.ok && body) {
          const data = (body.data ?? body) as Record<string, unknown>;
          const success = count(
            data.total_delivered ??
              data.delivered ??
              data.total_parcels_delivered ??
              data.success,
          );
          const cancel = count(
            data.total_cancelled ??
              data.cancelled ??
              data.total_parcels_cancelled ??
              data.cancel,
          );
          const total = count(data.total_parcels ?? data.total) || success + cancel;

          return {
            success,
            cancel,
            total: Math.max(total, success + cancel),
            successRatio:
              success + cancel > 0 ? ratio(success, Math.max(total, success + cancel)) : 0,
          };
        }

        throw upstreamFailed(NAME, msg || `returned HTTP ${res.status}`);
      } catch (err) {
        if (err instanceof Error && err.name === "FraudCheckError") throw err;
        throw upstreamFailed(NAME, err instanceof Error ? err.message : "could not reach API");
      }
    }

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
