import { asJson, pick, request } from "./http.js";
import { credentialsRejected } from "./errors.js";
import { count, ratio, type CourierStat, type FraudCredentials, type FraudProvider } from "./types.js";

const NAME = "Pathao";
const BASE = "https://merchant.pathao.com/api/v1";

/**
 * Pathao, through the merchant dashboard's own API.
 *
 * JSON at both ends, which makes it the least fragile of the five — but it is
 * still the dashboard's private API rather than a published one, so it carries
 * the same no-notice-change risk as the others.
 *
 * Pathao reports successful deliveries and a total; what did not succeed is
 * the difference. That subtraction is done here rather than trusting a
 * `cancelled` field Pathao does not send.
 */
export const pathao: FraudProvider = {
  name: NAME,
  identifierLabel: "Client ID / API Key",
  secretLabel: "Client Secret / API Token",
  hint: "Pathao Developer Client ID & Client Secret or API Token.",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    let token: string | null = null;

    // 1. Direct Bearer token passed in identifier or secret
    if (credentials.identifier.startsWith("eyJ") || credentials.identifier.length > 50) {
      token = credentials.identifier.trim();
    } else if (credentials.secret.startsWith("eyJ") || credentials.secret.length > 50) {
      token = credentials.secret.trim();
    }

    // 2. Try Pathao OAuth client_credentials via Hermes Developer API
    if (!token && !credentials.identifier.includes("@")) {
      try {
        const oauthRes = await request(NAME, "https://api-hermes.pathao.com/aladdin/api/v1/issue-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: credentials.identifier.trim(),
            client_secret: credentials.secret.trim(),
            grant_type: "client_credentials",
          }),
        });
        if (oauthRes.status === 200) {
          const parsed = asJson(NAME, oauthRes.body);
          const t = pick(parsed, "access_token");
          if (typeof t === "string" && t) {
            token = t;
          }
        }
      } catch {
        // Fallback to merchant login
      }
    }

    // 3. Fallback to merchant login
    if (!token) {
      const login = await request(NAME, `${BASE}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: credentials.identifier.trim(),
          password: credentials.secret.trim(),
        }),
      });

      if (login.status === 401 || login.status === 422) throw credentialsRejected(NAME);

      const parsedToken = pick(asJson(NAME, login.body), "access_token");
      if (typeof parsedToken === "string" && parsedToken) {
        token = parsedToken;
      }
    }

    if (!token) throw credentialsRejected(NAME, "Could not authenticate with Pathao API");

    const check = await request(NAME, `${BASE}/user/success`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone }),
    });

    if (check.status === 401) throw credentialsRejected(NAME, "the token was not accepted");

    const customer = pick(asJson(NAME, check.body), "data", "customer");
    const success = count(pick(customer, "successful_delivery"));
    const total = count(pick(customer, "total_delivery"));

    return {
      success,
      cancel: Math.max(0, total - success),
      total,
      successRatio: ratio(success, total),
    };
  },
};
