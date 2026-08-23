import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { carrybee } from "../src/modules/fraud/providers/carrybee.js";
import { paperfly } from "../src/modules/fraud/providers/paperfly.js";
import { pathao } from "../src/modules/fraud/providers/pathao.js";
import { redx } from "../src/modules/fraud/providers/redx.js";
import { steadfast } from "../src/modules/fraud/providers/steadfast.js";
import type { FraudCheckError } from "../src/modules/fraud/providers/errors.js";
import { count, ratio } from "../src/modules/fraud/providers/types.js";

/**
 * Courier fraud checks, against recorded shapes.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 * ------------------------------
 * Nobody outside the shop can run these for real: each one signs in to a
 * merchant account with the shop's own password. So the live half — whether a
 * particular password is accepted — is proven by the Test button in Settings,
 * by the person who owns the account.
 *
 * What is proven here is everything else, and it is the half that fails
 * silently: that the right URL is called with the right body, that the numbers
 * are read out of the right fields, and — most of all — that a courier which
 * did NOT answer produces an error rather than a customer with a clean record.
 * A wrong password is loud. A misread field is a number the desk will believe.
 */

/* -------------------------------------------------------------------------- */
/* A fake internet                                                            */
/* -------------------------------------------------------------------------- */

interface Recorded {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

const calls: Recorded[] = [];
let routes: { match: RegExp; status?: number; body: string; cookies?: string[] }[] = [];
const realFetch = globalThis.fetch;

function install(): void {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) throw new Error(`No stub for ${url}`);

    const headers = new Headers();
    for (const cookie of route.cookies ?? []) headers.append("set-cookie", cookie);

    return Promise.resolve(new Response(route.body, { status: route.status ?? 200, headers }));
  });
}

before(install);
after(() => {
  globalThis.fetch = realFetch;
});

function stub(next: typeof routes): void {
  routes = next;
  calls.length = 0;
}

const LOGIN = { identifier: "shop@example.com", secret: "hunter2" };
const CUSTOMER = "01712345678";

/* -------------------------------------------------------------------------- */

describe("shared helpers", () => {
  it("a ratio is a percentage to two decimals", () => {
    assert.equal(ratio(3, 4), 75);
    assert.equal(ratio(1, 3), 33.33);
  });

  it("nothing carried is nought per cent, not a division by zero", () => {
    assert.equal(ratio(0, 0), 0);
    assert.ok(Number.isFinite(ratio(5, 0)));
  });

  it("a courier answering with nonsense never becomes a negative count", () => {
    assert.equal(count(-4), 0);
    assert.equal(count("12"), 12);
    assert.equal(count(null), 0);
    assert.equal(count("many"), 0);
    assert.equal(count(3.7), 3);
  });
});

describe("Steadfast", () => {
  const loginPage = `<form><input type="hidden" name="_token" value="TKN123"></form>`;

  it("reads delivered and cancelled straight from the panel", async () => {
    stub([
      { match: /\/login$/, body: loginPage, cookies: ["session=abc; Path=/"] },
      { match: /frauds\/check/, body: JSON.stringify({ total_delivered: 9, total_cancelled: 1 }) },
    ]);

    const stat = await steadfast.check(CUSTOMER, LOGIN);

    assert.deepEqual(stat, { success: 9, cancel: 1, total: 10, successRatio: 90 });
  });

  it("carries the form token and the session cookie", async () => {
    stub([
      { match: /\/login$/, body: loginPage, cookies: ["session=abc; Path=/"] },
      { match: /frauds\/check/, body: JSON.stringify({ total_delivered: 1, total_cancelled: 0 }) },
    ]);

    await steadfast.check(CUSTOMER, LOGIN);

    const post = calls.find((call) => call.method === "POST");
    assert.ok(post?.body?.includes("_token=TKN123"), "the scraped token is posted back");
    assert.ok(post?.body?.includes("hunter2"), "the password is posted");

    const check = calls.at(-1);
    assert.ok(check?.url.includes(CUSTOMER), "the customer's number is in the check url");
    assert.match(String(check?.headers.cookie ?? ""), /session=abc/);
  });

  it("says the page changed when the token is gone, rather than blaming the password", async () => {
    stub([{ match: /\/login$/, body: "<html>redesigned</html>" }]);

    await assert.rejects(
      () => steadfast.check(CUSTOMER, LOGIN),
      (error: FraudCheckError) => error.kind === "upstream",
    );
  });

  it("being bounced back to a login form is a credentials failure, not zero deliveries", async () => {
    stub([
      { match: /\/login$/, body: loginPage, cookies: ["session=abc"] },
      { match: /frauds\/check/, body: `<form action="/login">sign in</form>` },
    ]);

    await assert.rejects(
      () => steadfast.check(CUSTOMER, LOGIN),
      (error: FraudCheckError) => error.kind === "credentials",
    );
  });
});

describe("Pathao", () => {
  it("derives what did not arrive from delivered and total", async () => {
    stub([
      { match: /\/login$/, body: JSON.stringify({ access_token: "T" }) },
      {
        match: /user\/success/,
        body: JSON.stringify({
          data: { customer: { successful_delivery: 5, total_delivery: 7 } },
        }),
      },
    ]);

    const stat = await pathao.check(CUSTOMER, LOGIN);

    assert.deepEqual(stat, { success: 5, cancel: 2, total: 7, successRatio: 71.43 });
  });

  it("sends the customer's number in the body and the token in the header", async () => {
    stub([
      { match: /\/login$/, body: JSON.stringify({ access_token: "T" }) },
      {
        match: /user\/success/,
        body: JSON.stringify({ data: { customer: { successful_delivery: 1, total_delivery: 1 } } }),
      },
    ]);

    await pathao.check(CUSTOMER, LOGIN);

    const check = calls.at(-1);
    assert.equal(check?.method, "POST");
    assert.deepEqual(JSON.parse(check?.body ?? "{}"), { phone: CUSTOMER });
    assert.equal(check?.headers.authorization, "Bearer T");
  });

  it("a login with no token is a credentials failure", async () => {
    stub([{ match: /\/login$/, body: JSON.stringify({ message: "nope" }) }]);

    await assert.rejects(
      () => pathao.check(CUSTOMER, LOGIN),
      (error: FraudCheckError) => error.kind === "credentials",
    );
  });
});

describe("RedX", () => {
  it("reads delivered and total parcels", async () => {
    stub([
      { match: /auth\/login/, body: JSON.stringify({ data: { accessToken: "T" } }) },
      {
        match: /customer-success-return-rate/,
        body: JSON.stringify({ data: { deliveredParcels: 20, totalParcels: 25 } }),
      },
    ]);

    const stat = await redx.check(CUSTOMER, LOGIN);

    assert.deepEqual(stat, { success: 20, cancel: 5, total: 25, successRatio: 80 });
  });

  it("asks about the number with its country code, never the local form", async () => {
    stub([
      { match: /auth\/login/, body: JSON.stringify({ data: { accessToken: "T" } }) },
      {
        match: /customer-success-return-rate/,
        body: JSON.stringify({ data: { deliveredParcels: 1, totalParcels: 1 } }),
      },
    ]);

    await redx.check(CUSTOMER, { identifier: "01911111111", secret: "x" });

    const login = JSON.parse(calls[0]?.body ?? "{}") as { phone?: string };
    assert.equal(login.phone, "8801911111111", "the merchant's own number gains 88");

    const check = calls.at(-1)?.url ?? "";
    assert.ok(check.includes("8801712345678"), `customer number carries 88: ${check}`);
    assert.ok(!check.includes("=01712"), "the local form is never sent");
  });
});

describe("Paperfly", () => {
  const token = JSON.stringify({ token: "T" });

  it("counts the parcels itself, because Paperfly does not", async () => {
    stub([
      { match: /login_using_password/, body: token },
      {
        match: /smart-check/,
        body: JSON.stringify({
          records: [
            { status: "Delivered" },
            { status: "delivered" },
            { status: "Returned to merchant" },
            { status: "Cancelled" },
          ],
        }),
      },
    ]);

    const stat = await paperfly.check(CUSTOMER, LOGIN);

    assert.deepEqual(stat, { success: 2, cancel: 2, total: 4, successRatio: 50 });
  });

  it("a parcel still moving counts as neither, so a busy customer is not punished", async () => {
    stub([
      { match: /login_using_password/, body: token },
      {
        match: /smart-check/,
        body: JSON.stringify({
          records: [
            { status: "Delivered" },
            { status: "In Transit" },
            { status: "Pending Pickup" },
          ],
        }),
      },
    ]);

    const stat = await paperfly.check(CUSTOMER, LOGIN);

    assert.deepEqual(
      stat,
      { success: 1, cancel: 0, total: 1, successRatio: 100 },
      "the two in-flight parcels are not counted against the customer",
    );
  });

  it("no records at all is an honest zero, not a crash", async () => {
    stub([
      { match: /login_using_password/, body: token },
      { match: /smart-check/, body: JSON.stringify({ records: [] }) },
    ]);

    assert.deepEqual(await paperfly.check(CUSTOMER, LOGIN), {
      success: 0,
      cancel: 0,
      total: 0,
      successRatio: 0,
    });
  });
});

describe("Carrybee", () => {
  const csrf = JSON.stringify({ csrfToken: "C" });
  const session = JSON.stringify({ accessToken: "T", user: { selectedBusinessId: 42 } });

  it("walks csrf, login, session, then the check", async () => {
    stub([
      { match: /auth\/csrf/, body: csrf, cookies: ["csrf=1"] },
      { match: /auth\/callback/, body: "", cookies: ["sess=2"] },
      { match: /auth\/session/, body: session },
      {
        match: /fraud-check/,
        body: JSON.stringify({ data: { total_order: 10, cancelled_order: 2 } }),
      },
    ]);

    const stat = await carrybee.check(CUSTOMER, LOGIN);

    assert.deepEqual(stat, { success: 8, cancel: 2, total: 10, successRatio: 80 });
    assert.ok(calls.at(-1)?.url.includes("/businesses/42/"), "the business id is in the url");
  });

  it("an empty session means the login was refused", async () => {
    stub([
      { match: /auth\/csrf/, body: csrf },
      { match: /auth\/callback/, body: "" },
      { match: /auth\/session/, body: "{}" },
    ]);

    await assert.rejects(
      () => carrybee.check(CUSTOMER, LOGIN),
      (error: FraudCheckError) => error.kind === "credentials",
    );
  });
});

describe("a courier that stops behaving", () => {
  it("HTML where JSON was expected is reported, not parsed into zeroes", async () => {
    stub([
      { match: /\/login$/, body: JSON.stringify({ access_token: "T" }) },
      { match: /user\/success/, body: "<html><body>502 Bad Gateway</body></html>" },
    ]);

    await assert.rejects(
      () => pathao.check(CUSTOMER, LOGIN),
      (error: FraudCheckError) => {
        assert.equal(error.kind, "upstream");
        assert.match(error.message, /not JSON/);
        return true;
      },
    );
  });

  it("missing fields read as zero rather than NaN", async () => {
    stub([
      { match: /\/login$/, body: JSON.stringify({ access_token: "T" }) },
      { match: /user\/success/, body: JSON.stringify({ data: {} }) },
    ]);

    const stat = await pathao.check(CUSTOMER, LOGIN);

    assert.deepEqual(stat, { success: 0, cancel: 0, total: 0, successRatio: 0 });
  });
});
