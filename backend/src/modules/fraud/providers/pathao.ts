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
  identifierLabel: "Merchant email or phone",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    const login = await request(NAME, `${BASE}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: credentials.identifier, password: credentials.secret }),
    });

    if (login.status === 401 || login.status === 422) throw credentialsRejected(NAME);

    const token = pick(asJson(NAME, login.body), "access_token");
    if (typeof token !== "string" || !token) throw credentialsRejected(NAME, "no token was issued");

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
