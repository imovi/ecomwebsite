import { asJson, pick, request } from "./http.js";
import { credentialsRejected } from "./errors.js";
import { count, ratio, type CourierStat, type FraudCredentials, type FraudProvider } from "./types.js";

const NAME = "RedX";

/**
 * RedX, through the merchant app's API.
 *
 * Signs in with a phone number rather than an email, and expects it carrying
 * the country code — the same `88` prefix the WhatsApp link needs, and the
 * same trap: sending the local `01…` form gets a rejection that looks exactly
 * like a wrong password.
 *
 * Like Pathao, RedX reports delivered and total; the difference is what did
 * not arrive.
 */
export const redx: FraudProvider = {
  name: NAME,
  identifierLabel: "Merchant phone",

  async check(phone: string, credentials: FraudCredentials): Promise<CourierStat> {
    const login = await request(NAME, "https://api.redx.com.bd/v4/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone: withCountryCode(credentials.identifier),
        password: credentials.secret,
      }),
    });

    if (login.status === 401 || login.status === 400) throw credentialsRejected(NAME);

    const token = pick(asJson(NAME, login.body), "data", "accessToken");
    if (typeof token !== "string" || !token) throw credentialsRejected(NAME, "no token was issued");

    const url =
      "https://redx.com.bd/api/redx_se/admin/parcel/customer-success-return-rate" +
      `?phoneNumber=${encodeURIComponent(withCountryCode(phone))}`;

    const check = await request(NAME, url, {
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    });

    if (check.status === 401) throw credentialsRejected(NAME, "the token was not accepted");

    const data = pick(asJson(NAME, check.body), "data");
    const success = count(pick(data, "deliveredParcels"));
    const total = count(pick(data, "totalParcels"));

    return {
      success,
      cancel: Math.max(0, total - success),
      total,
      successRatio: ratio(success, total),
    };
  },
};

/**
 * `01712345678` and `8801712345678` are the same number; RedX wants the second.
 *
 * The leading zero STAYS. Bangladesh's country code is 880 and a local number
 * already begins with 0, so prefixing `88` produces it — stripping the zero
 * first gives a twelve-digit number that RedX rejects in a way that reads
 * exactly like a wrong password.
 */
function withCountryCode(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("0")) return `88${digits}`;
  /* Already stripped by whoever typed it: 1712345678. */
  return `880${digits}`;
}
