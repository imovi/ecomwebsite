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
function parseSecret(raw: string): {
  secret: string;
  username?: string;
  password?: string;
} {
  const trimmed = (raw || "").trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        secret: typeof parsed.secret === "string" ? parsed.secret : typeof parsed.clientSecret === "string" ? parsed.clientSecret : "",
        username: typeof parsed.username === "string" ? parsed.username : undefined,
        password: typeof parsed.password === "string" ? parsed.password : undefined,
      };
    } catch {}
  }
  return { secret: trimmed };
}

export const pathao: FraudProvider = {
  name: NAME,
  identifierLabel: "Client ID / API Key",
  secretLabel: "Client Secret / API Token",
  hint: "Pathao Developer Client ID & Client Secret or API Token.",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    let token: string | null = null;

    // 1. Direct Bearer token passed in identifier or secret
    if (credentials.identifier.startsWith("eyJ")) {
      token = credentials.identifier.trim();
    } else if (credentials.secret.startsWith("eyJ")) {
      token = credentials.secret.trim();
    }

    const parsed = parseSecret(credentials.secret);
    const clientSecret = parsed.secret || credentials.secret.trim();
    const username = parsed.username || (credentials.identifier.includes("@") ? credentials.identifier.trim() : undefined);
    const password = parsed.password || (!credentials.identifier.includes("@") && !credentials.secret.startsWith("{") ? credentials.secret.trim() : undefined);
    const clientId = !credentials.identifier.includes("@") ? credentials.identifier.trim() : "";

    // 2. Try Pathao OAuth password grant via Hermes Developer API
    if (!token && clientId && clientSecret && username && password) {
      try {
        const oauthRes = await request(NAME, "https://api-hermes.pathao.com/aladdin/api/v1/issue-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            username,
            password,
            grant_type: "password",
          }),
        });
        if (oauthRes.status === 200) {
          const resBody = asJson(NAME, oauthRes.body);
          const t = pick(resBody, "access_token");
          if (typeof t === "string" && t) {
            token = t;
          }
        }
      } catch {
        // Fallback to merchant login
      }
    }

    // 3. Fallback to merchant dashboard direct login
    if (!token && username && password) {
      const login = await request(NAME, `${BASE}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      if (login.status === 401 || login.status === 422) {
        throw credentialsRejected(NAME, "Pathao credentials rejected. Check your login username and password in Settings.");
      }

      const parsedToken = pick(asJson(NAME, login.body), "access_token");
      if (typeof parsedToken === "string" && parsedToken) {
        token = parsedToken;
      }
    }

    if (!token) {
      throw credentialsRejected(NAME, "Could not authenticate with Pathao API. Check Client ID, Secret, and Login credentials.");
    }

    const check = await request(NAME, `${BASE}/user/success`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone }),
    });

    if (check.status === 401) throw credentialsRejected(NAME, "the token was not accepted");

    const json = asJson(NAME, check.body);
    const data = (pick(json, "data") || {}) as Record<string, unknown>;
    const customer = (data.customer || data) as Record<string, unknown>;

    let success = count(customer.successful_delivery ?? customer.success ?? customer.delivered);
    let total = count(customer.total_delivery ?? customer.total);
    const rawRating = typeof data.customer_rating === "string" ? data.customer_rating : "";

    let ratingLabel: string | undefined = undefined;
    if (rawRating) {
      ratingLabel = rawRating.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    if (total === 0 && rawRating) {
      if (rawRating === "excellent_customer") {
        success = 10;
        total = 10;
      } else if (rawRating === "good_customer") {
        success = 8;
        total = 10;
      } else if (rawRating === "average_customer") {
        success = 5;
        total = 10;
      } else if (rawRating === "bad_customer") {
        success = 2;
        total = 10;
      } else if (rawRating === "fraud_customer") {
        success = 0;
        total = 10;
      }
    }

    const cancel = Math.max(0, total - success);
    return {
      success,
      cancel,
      total,
      successRatio: total > 0 ? ratio(success, total) : 0,
      rating: ratingLabel,
    };
  },
};
