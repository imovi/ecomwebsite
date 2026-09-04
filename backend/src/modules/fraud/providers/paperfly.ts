import { asJson, pick, request } from "./http.js";
import { credentialsRejected } from "./errors.js";
import { ratio, type CourierStat, type FraudCredentials, type FraudProvider } from "./types.js";

const NAME = "Paperfly";
const BASE = "https://go-app.paperfly.com.bd/merchant/api/react";

/**
 * Paperfly, which does not answer the question directly.
 *
 * The other four return counts. Paperfly returns the parcels themselves and
 * leaves the counting to the caller, so this reads each record's status text
 * and sorts it into arrived or came back. Anything else — in transit, pending
 * — is deliberately counted as neither: a parcel still moving is not evidence
 * either way, and rounding it into "cancelled" would make honest customers
 * look worse the busier they are.
 *
 * That also means `total` here is arrived plus came back, not every parcel
 * Paperfly listed.
 */
const ARRIVED = /deliver|success/i;
const CAME_BACK = /return|cancel|fail/i;

export const paperfly: FraudProvider = {
  name: NAME,
  identifierLabel: "API Key / Username",
  secretLabel: "Secret Key / API Token",
  hint: "Paperfly API Key or Username & Secret.",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    let token: string | null = null;

    if (credentials.identifier.startsWith("eyJ") || credentials.identifier.length > 50) {
      token = credentials.identifier.trim();
    } else if (credentials.secret.startsWith("eyJ") || credentials.secret.length > 50) {
      token = credentials.secret.trim();
    }

    if (!token) {
      const login = await request(NAME, `${BASE}/authentication/login_using_password.php`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: credentials.identifier.trim(),
          password: credentials.secret.trim(),
        }).toString(),
      });

      if (login.status === 401) throw credentialsRejected(NAME);

      const parsed = asJson(NAME, login.body);
      const parsedToken = pick(parsed, "token") ?? pick(parsed, "data", "token");
      if (typeof parsedToken === "string" && parsedToken) {
        token = parsedToken;
      }
    }

    if (!token) throw credentialsRejected(NAME, "no token was issued");

    const check = await request(NAME, `${BASE}/smart-check/list.php`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${token}`,
      },
      body: new URLSearchParams({ search_text: phone, limit: "50", page: "1" }).toString(),
    });

    if (check.status === 401) throw credentialsRejected(NAME, "the token was not accepted");

    const records = pick(asJson(NAME, check.body), "records");
    const rows = Array.isArray(records) ? records : [];

    let success = 0;
    let cancel = 0;

    for (const row of rows) {
      const raw = pick(row, "status");
      /* Anything that is not text says nothing about the parcel, and coercing
         it would produce "[object Object]" — which matches neither pattern
         today but would start matching the moment one of them widened. */
      if (typeof raw !== "string") continue;

      if (ARRIVED.test(raw)) success += 1;
      else if (CAME_BACK.test(raw)) cancel += 1;
    }

    return {
      success,
      cancel,
      total: success + cancel,
      successRatio: ratio(success, success + cancel),
    };
  },
};
