import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

/* The config module parses `process.env` at import time and exits the process
   if it does not like what it finds, so the environment is set before any
   application module is evaluated — the same discipline as the server harness.
   No database is involved: `trackPurchase` takes its configuration as an
   argument, which is the seam this file uses. */
process.env.NODE_ENV = "test";
process.env.DATABASE_DRIVER = "pglite";
process.env.PGLITE_DATA_DIR = "memory://marketing-test";
process.env.JWT_ACCESS_SECRET = "test-secret-that-is-definitely-long-enough-32+";
process.env.LOG_LEVEL = "silent";
process.env.LOG_PRETTY = "false";
process.env.COOKIE_SECURE = "false";
process.env.TRUST_PROXY_HOPS = "0";

/* Type-only, so it is erased at compile time and cannot evaluate the module
   before the environment above is in place. */
import type { PurchaseEvent } from "../src/modules/marketing/meta-capi.service.js";

const { trackPurchase, hashField, hashPhone } = await import(
  "../src/modules/marketing/meta-capi.service.js"
);
const { resolveCity } = await import("../src/lib/geo/delivery-zone.js");

/**
 * Meta Conversions API — the shape of what actually goes on the wire.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This payload decides where advertising money is judged to have worked. Every
 * failure mode it has is silent: a field hashed that should not be, a field sent
 * empty, a field quietly dropped — none of them throws, none shows up in a log,
 * and the only symptom is a number in someone else's dashboard drifting down
 * weeks later.
 *
 * The event is built by the real code and asserted at the network boundary.
 */

interface Sent {
  url: string;
  body: {
    data: { user_data: Record<string, unknown>; [key: string]: unknown }[];
    test_event_code?: string;
    access_token?: string;
  };
}

const sent: Sent[] = [];
const realFetch = globalThis.fetch;

const CONFIG = {
  metaPixelId: "111122223333",
  metaCapiToken: "fake-capi-token",
  metaTestEventCode: "",
  metaTrackingEnabled: true,
};

const EVENT: PurchaseEvent = {
  orderNumber: "GNG-10042",
  value: 1_290,
  phone: "01712345678",
  contents: [{ id: "LED-DESK-01", quantity: 1, itemPrice: 1_290 }],
  eventTime: new Date("2026-08-09T12:00:00.000Z"),
  sourceUrl: "https://habushop.com/checkout",
  customerName: "Habibur Rahman",
  city: "dhaka",
  clientIp: "203.0.113.42",
  userAgent: "Mozilla/5.0 (Linux; Android 13; SM-A146P)",
  fbc: "fb.1.1754400000000.IwAR2example",
  fbp: "fb.1.1754300000000.987654321",
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

beforeEach(() => {
  sent.length = 0;
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://graph.facebook.com")) return realFetch(input, init);

    /* The service always sends a JSON string; anything else is a bug worth
       failing on rather than stringifying into `[object Object]`. */
    const raw = init?.body;
    assert.equal(typeof raw, "string", "the CAPI body should be serialised JSON");

    sent.push({ url, body: JSON.parse(raw as string) as Sent["body"] });
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The `user_data` of the one event that was sent. */
async function userDataFor(event: Partial<PurchaseEvent> = {}): Promise<Record<string, unknown>> {
  const outcome = await trackPurchase({ ...EVENT, ...event }, CONFIG);
  assert.equal(outcome.sent, true, outcome.reason ?? "the event should have been sent");
  assert.equal(sent.length, 1, "exactly one call to Meta");
  return sent[0]!.body.data[0]!.user_data;
}

describe("meta CAPI — purchase match keys", () => {
  it("sends every key it has, not just the phone number", async () => {
    const user = await userDataFor();

    /* The regression this file was written for: `user_data` once held exactly
       one field, and Meta scored the match quality 2.5 out of 10 for it. */
    assert.deepEqual(Object.keys(user).sort(), [
      "client_ip_address",
      "client_user_agent",
      "country",
      "ct",
      "external_id",
      "fbc",
      "fbp",
      "fn",
      "ln",
      "ph",
    ]);
  });

  it("hashes the identifiers and sends the rest raw", async () => {
    const user = await userDataFor();

    /* Hashed: nothing that identifies a person leaves in plaintext. */
    assert.deepEqual(user.ph, [hashPhone("01712345678")]);
    assert.deepEqual(user.fn, [sha256("habibur")]);
    assert.deepEqual(user.ln, [sha256("rahman")]);
    assert.deepEqual(user.ct, [sha256("dhaka")]);
    assert.deepEqual(user.country, [sha256("bd")]);

    /**
     * RAW, and this is the assertion that matters most.
     *
     * These four are not identifiers Meta holds a hashed copy of — they are
     * values it issued or observed itself and compares literally. Hashing them
     * looks like caution and silently voids the field, which lowers the very
     * score the rest of this work exists to raise.
     */
    assert.equal(user.client_ip_address, "203.0.113.42");
    assert.equal(user.client_user_agent, "Mozilla/5.0 (Linux; Android 13; SM-A146P)");
    assert.equal(user.fbc, "fb.1.1754400000000.IwAR2example");
    assert.equal(user.fbp, "fb.1.1754300000000.987654321");

    for (const key of ["client_ip_address", "client_user_agent", "fbc", "fbp"] as const) {
      assert.doesNotMatch(String(user[key]), /^[0-9a-f]{64}$/, `${key} must not be hashed`);
    }
  });

  it("uses the same value for the phone and the customer identifier", async () => {
    const user = await userDataFor();
    /* The phone is the identity on a shop with no accounts, so it is also what
       stitches two orders from one person together. */
    assert.deepEqual(user.external_id, user.ph);
  });

  it("omits a key rather than sending it empty", async () => {
    const user = await userDataFor({
      customerName: null,
      city: null,
      clientIp: null,
      userAgent: null,
      fbc: null,
      fbp: null,
    });

    /* An empty string counts as a supplied key that cannot match, which scores
       worse than not supplying one at all. */
    for (const key of ["fn", "ln", "ct", "client_ip_address", "fbc", "fbp"]) {
      assert.equal(key in user, false, `${key} should be absent, not empty`);
    }

    /* What is always known still goes. */
    assert.ok(user.ph, "the phone survives");
    assert.deepEqual(user.country, [sha256("bd")]);
  });

  it("takes a surname from the last word, and none from a single name", async () => {
    const three = await userDataFor({ customerName: "Md Habibur Rahman" });
    assert.deepEqual(three.fn, [sha256("md")]);
    assert.deepEqual(three.ln, [sha256("rahman")]);

    sent.length = 0;
    const one = await userDataFor({ customerName: "Rahim" });
    assert.deepEqual(one.fn, [sha256("rahim")]);
    assert.equal("ln" in one, false, "a one-word name has no surname to send");
  });

  it("keeps the order number as the deduplication key", async () => {
    await userDataFor();
    const event = sent[0]!.body.data[0]!;

    /* If this ever stops being the order number, one order becomes two
       conversions and every figure built on them is wrong. */
    assert.equal(event.event_id, "GNG-10042");
    assert.equal(event.event_name, "Purchase");
    assert.equal(event.action_source, "website");
  });
});

describe("meta CAPI — normalisation", () => {
  it("strips case and punctuation before hashing", () => {
    assert.equal(hashField("  Rahman  "), sha256("rahman"));
    assert.equal(hashField("O'Brien"), sha256("obrien"));
  });

  it("removes spaces for a city, and keeps them for a name", () => {
    /* Meta compares a city with the spaces taken out, so "Cox's Bazar" has to
       become one token or it is checked against a list it can never be on. */
    assert.equal(hashField("Cox's Bazar", { removeSpaces: true }), sha256("coxsbazar"));
    assert.equal(hashField("Cox's Bazar"), sha256("coxs bazar"));
  });

  it("returns nothing for a value that normalises away", () => {
    assert.equal(hashField(""), null);
    assert.equal(hashField("   "), null);
    assert.equal(hashField("!!!"), null);
  });

  it("treats one phone number written three ways as one person", () => {
    const canonical = hashPhone("8801712345678");
    assert.equal(hashPhone("01712345678"), canonical);
    assert.equal(hashPhone("+8801712345678"), canonical);
  });
});

describe("meta CAPI — the city a customer actually typed", () => {
  it("calls anywhere inside Dhaka simply Dhaka", () => {
    /* Gulshan is not a city; it is part of one. */
    assert.equal(resolveCity("Gulshan 2, Dhaka", "inside_dhaka"), "dhaka");
    assert.equal(resolveCity("Dhanmondi 27", "inside_dhaka"), "dhaka");
  });

  it("resolves a district outside Dhaka, however it was spelt", () => {
    assert.equal(resolveCity("Chattogram", "outside_dhaka"), "chattogram");
    assert.equal(resolveCity("Cox's Bazar", "outside_dhaka"), "coxs bazar");
    assert.equal(resolveCity("কুমিল্লা", "outside_dhaka"), "cumilla");
  });

  it("recognises the towns beside Dhaka that bill as outside", () => {
    assert.equal(resolveCity("Savar, Dhaka", "outside_dhaka"), "savar");
  });

  it("returns nothing rather than guessing", () => {
    /* A field filled with something that cannot be true is worse than an
       absent one. */
    assert.equal(resolveCity("house 4 road 2", "outside_dhaka"), null);
    assert.equal(resolveCity("", "outside_dhaka"), null);
  });
});
