import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  seedAdminAndLogin,
  startTestServer,
  type TestContext,
} from "./helpers/test-server.js";

/**
 * Recovering incomplete checkouts — integration tests.
 *
 * Real HTTP, real Postgres, real transactions. The point of most of what
 * follows is money: a coupon that can be spent twice is a delivery charge the
 * shop pays twice, and a coupon that stops working between the summary and the
 * Place Order button must refuse the order rather than quietly charge for
 * delivery the customer was told was free.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

interface Coupon {
  id: string;
  code: string;
  state: "active" | "used" | "cancelled" | "expired";
  cartValue: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string;
  usedAt: string | null;
}

interface Lead {
  id: string;
  phone: string;
  estimatedValue: number;
  recovered: boolean;
  stage: string;
  helpMessageSentAt: string | null;
  couponOfferSentAt: string | null;
  coupon: Coupon | null;
  events: { type: string; detail: Record<string, unknown>; actorName: string }[];
}

interface Quote {
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  coupon: { code: string; applied: boolean; saved: number; reason?: string; message?: string } | null;
}

const PASSWORD = "RecoveryPass@2026";
const INSIDE_DHAKA_CHARGE = 80;

let ctx: TestContext;
let adminToken: string;
let productId: string;

/* A counter, so every lead in this file gets its own number — the unique index
   allows one open lead per phone, and reusing one would have tests interfering
   with each other in ways that look like real bugs. */
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `019${String(10_000_000 + phoneCounter).slice(0, 8)}`;
}

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

before(async () => {
  ctx = await startTestServer();

  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "recovery-admin@hinar.com.bd",
    password: PASSWORD,
    role: "admin",
  });

  const category = await api<Envelope<{ category: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/categories",
    { method: "POST", accessToken: adminToken, body: { name: "Lamps" } },
  );

  const product = await api<Envelope<{ product: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/products",
    {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "LED Study Lamp",
        sku: "TEST-LAMP",
        brand: "Testco",
        categoryId: category.body.data.category.id,
        price: 800,
        status: "active",
        stockQuantity: 500,
      },
    },
  );

  productId = product.body.data.product.id;
});

after(async () => {
  await ctx.close();
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Records an abandoned checkout and returns the lead the desk would see. */
async function createLead(phone: string, quantity = 1): Promise<Lead> {
  const recorded = await api(ctx.baseUrl, "/api/v1/checkout/incomplete", {
    method: "POST",
    body: {
      phone,
      customerName: "Test Customer",
      areaText: "Mirpur",
      items: [{ productId, quantity }],
    },
  });
  assert.equal(recorded.status, 204);

  return findLead(phone);
}

async function findLead(phone: string): Promise<Lead> {
  const list = await api<Envelope<{ checkouts: Lead[] }>>(
    ctx.baseUrl,
    "/api/v1/admin/abandoned?includeRecovered=true",
    { accessToken: adminToken },
  );

  const lead = list.body.data.checkouts.find((row) => row.phone === phone);
  assert.ok(lead, `no lead for ${phone}`);
  return lead;
}

async function issueCoupon(leadId: string) {
  return api<Envelope<{ coupon: Coupon; created: boolean }>>(
    ctx.baseUrl,
    `/api/v1/admin/abandoned/${leadId}/coupon`,
    { method: "POST", accessToken: adminToken, body: {} },
  );
}

async function quote(couponCode?: string) {
  return api<Envelope<Quote>>(ctx.baseUrl, "/api/v1/checkout/quote", {
    method: "POST",
    body: {
      items: [{ productId, quantity: 1 }],
      deliveryZone: "inside_dhaka",
      ...(couponCode ? { couponCode } : {}),
    },
  });
}

async function placeOrder(phone: string, couponCode?: string) {
  return api<Envelope<{ order: { orderNumber: string; deliveryCharge: number; grandTotal: number } }>>(
    ctx.baseUrl,
    "/api/v1/checkout/order",
    {
      method: "POST",
      body: {
        customerName: "Test Customer",
        phone,
        address: "House 12, Road 3, Mirpur",
        areaText: "Mirpur",
        deliveryZone: "inside_dhaka",
        items: [{ productId, quantity: 1 }],
        ...(couponCode ? { couponCode } : {}),
      },
    },
  );
}

/** Reaches past the API to age a coupon, because the tests cannot wait a day. */
async function expireCoupon(code: string): Promise<void> {
  const { getDb } = await import("../src/db/client.js");
  const { recoveryCoupons } = await import("../src/db/schema/recovery-coupons.js");
  const { eq } = await import("drizzle-orm");

  await getDb()
    .update(recoveryCoupons)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(recoveryCoupons.code, code));
}

async function patchSettings(body: unknown) {
  const result = await api(ctx.baseUrl, "/api/v1/admin/settings", {
    method: "PATCH",
    accessToken: adminToken,
    body,
  });
  assert.equal(result.status, 200);
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

describe("recovery — making the offer", () => {
  it("issues a code with no character a customer could misread", async () => {
    const lead = await createLead(nextPhone());
    const result = await issueCoupon(lead.id);

    assert.equal(result.status, 200);
    assert.equal(result.body.data.created, true);

    const { code } = result.body.data.coupon;
    assert.match(code, /^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{6}$/);
    /* The whole reason for the restricted alphabet: these are read down a
       phone line, and "was that an oh or a zero" is a failed redemption the
       customer blames the shop for. */
    assert.ok(!/[OI0-1S5]/.test(code), `${code} contains an ambiguous character`);
  });

  it("hands back the offer already outstanding instead of minting a second", async () => {
    const lead = await createLead(nextPhone());

    const first = await issueCoupon(lead.id);
    const second = await issueCoupon(lead.id);

    assert.equal(second.status, 200);
    assert.equal(second.body.data.created, false);
    assert.equal(second.body.data.coupon.id, first.body.data.coupon.id);
    assert.equal(second.body.data.coupon.code, first.body.data.coupon.code);
  });

  it("freezes what the basket was worth when the offer was made", async () => {
    const lead = await createLead(nextPhone(), 2);
    const result = await issueCoupon(lead.id);

    assert.equal(result.body.data.coupon.cartValue, 1600);
  });

  it("refuses a basket below the floor the owner set", async () => {
    await patchSettings({ recovery: { couponMinCartValue: 5000 } });

    const lead = await createLead(nextPhone());
    const refused = await issueCoupon(lead.id);

    assert.equal(refused.status, 400);
    assert.match(refused.body.error!.message, /5000/);

    await patchSettings({ recovery: { couponMinCartValue: 0 } });
  });

  it("refuses to contact a lead marked do-not-contact", async () => {
    const lead = await createLead(nextPhone());

    await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { reason: "do_not_contact" },
    });

    const refused = await issueCoupon(lead.id);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error!.message, /do-not-contact/i);
  });

  it("will not pay for a sale the shop has already made", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone);

    const placed = await placeOrder(phone);
    assert.equal(placed.status, 201);

    const refused = await issueCoupon(lead.id);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error!.message, /already ordered/i);
  });

  it("is closed to the public", async () => {
    const lead = await createLead(nextPhone());

    const anonymous = await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}/coupon`, {
      method: "POST",
      body: {},
    });

    assert.equal(anonymous.status, 401);
  });
});

/* -------------------------------------------------------------------------- */
/* Spending                                                                   */
/* -------------------------------------------------------------------------- */

describe("recovery — spending the offer", () => {
  it("shows the charge gone before the customer commits", async () => {
    const lead = await createLead(nextPhone());
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    const without = await quote();
    assert.equal(without.body.data.deliveryCharge, INSIDE_DHAKA_CHARGE);
    assert.equal(without.body.data.coupon, null);

    const with_ = await quote(code);
    assert.equal(with_.body.data.deliveryCharge, 0);
    assert.equal(with_.body.data.grandTotal, with_.body.data.subtotal);
    assert.equal(with_.body.data.coupon?.applied, true);
    assert.equal(with_.body.data.coupon?.saved, INSIDE_DHAKA_CHARGE);
  });

  it("does not spend the code merely because somebody typed it", async () => {
    const lead = await createLead(nextPhone());
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    await quote(code);
    await quote(code);

    /* A quote is not a purchase. A code that claimed itself on being typed
       would be burnt by everyone who pasted one and then changed their mind. */
    const after = await findLead(lead.phone);
    assert.equal(after.coupon?.state, "active");
  });

  it("writes the order with no delivery charge and marks the offer used", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone);
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    const placed = await placeOrder(phone, code);

    assert.equal(placed.status, 201);
    assert.equal(placed.body.data.order.deliveryCharge, 0);
    assert.equal(placed.body.data.order.grandTotal, 800);

    const after = await findLead(phone);
    assert.equal(after.coupon?.state, "used");
    assert.ok(after.coupon?.usedAt);
  });

  it("refuses the same code twice, and writes no second order", async () => {
    const firstPhone = nextPhone();
    const lead = await createLead(firstPhone);
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    const first = await placeOrder(firstPhone, code);
    assert.equal(first.status, 201);

    const secondPhone = nextPhone();
    const second = await placeOrder(secondPhone, code);

    assert.equal(second.status, 409);
    assert.match(second.body.error!.message, /already been used/i);

    /* The whole transaction unwound — no order, and the stock it had reserved
       went back. An order that survived a failed redemption would be a
       delivery charge the shop paid for nothing. */
    const orders = await api<Envelope<{ phone: string }[]>>(
      ctx.baseUrl,
      "/api/v1/admin/orders?perPage=100",
      { accessToken: adminToken },
    );
    assert.ok(
      !orders.body.data.some((order) => order.phone === secondPhone),
      "a second order survived a refused coupon",
    );
  });

  it("refuses an expired offer rather than charging for delivery quietly", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone);
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    await expireCoupon(code);

    const quoted = await quote(code);
    assert.equal(quoted.body.data.coupon?.applied, false);
    assert.equal(quoted.body.data.coupon?.reason, "expired");
    assert.equal(quoted.body.data.deliveryCharge, INSIDE_DHAKA_CHARGE);

    const placed = await placeOrder(phone, code);
    assert.equal(placed.status, 409);
    /* The message has to carry the number, because the customer agreed to a
       total that no longer applies and is about to be asked for a different
       one at their door. */
    assert.match(placed.body.error!.message, /expired/i);
    assert.match(placed.body.error!.message, /80/);
  });

  it("refuses an offer the shop withdrew", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone);
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    const cancelled = await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}/coupon`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    assert.equal(cancelled.status, 200);

    const placed = await placeOrder(phone, code);
    assert.equal(placed.status, 409);
  });

  it("cannot withdraw an offer the customer has already spent", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone);
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    await placeOrder(phone, code);

    const refused = await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}/coupon`, {
      method: "DELETE",
      accessToken: adminToken,
    });

    /* The order exists. Taking the coupon back now would not take the free
       delivery back with it. */
    assert.ok(refused.status === 404 || refused.status === 409, `got ${refused.status}`);
  });

  it("does not accept a code the shop never issued", async () => {
    const phone = nextPhone();
    await createLead(phone);

    const quoted = await quote("ZZZZZZ");
    assert.equal(quoted.body.data.coupon?.reason, "unknown");
    assert.equal(quoted.body.data.deliveryCharge, INSIDE_DHAKA_CHARGE);

    const placed = await placeOrder(phone, "ZZZZZZ");
    assert.equal(placed.status, 409);
  });

  it("keeps the offer unspent when delivery was already free", async () => {
    await patchSettings({ delivery: { freeDeliveryThreshold: 500 } });

    const phone = nextPhone();
    const lead = await createLead(phone);
    const { code } = (await issueCoupon(lead.id)).body.data.coupon;

    const quoted = await quote(code);
    assert.equal(quoted.body.data.deliveryCharge, 0);
    /* Valid, but it took nothing off — so it is reported as not applied and
       the customer is told to keep it. Burning a one-time offer to save
       nothing is a worse outcome than saying so. */
    assert.equal(quoted.body.data.coupon?.applied, false);
    assert.equal(quoted.body.data.coupon?.reason, undefined);

    const placed = await placeOrder(phone, code);
    assert.equal(placed.status, 201);
    assert.equal(placed.body.data.order.deliveryCharge, 0);

    const after = await findLead(phone);
    assert.equal(after.coupon?.state, "active");

    await patchSettings({ delivery: { freeDeliveryThreshold: 0 } });
  });
});

/* -------------------------------------------------------------------------- */
/* The lead                                                                   */
/* -------------------------------------------------------------------------- */

describe("recovery — the lead itself", () => {
  it("closes on the phone number, not only through the resume link", async () => {
    const phone = nextPhone();
    await createLead(phone);

    /* The customer was messaged, ignored the link, and went to the site
       themselves — which is what most of them do. Crediting only link traffic
       would report a recovery rate well below the real one. */
    const placed = await placeOrder(phone);
    assert.equal(placed.status, 201);

    const after = await findLead(phone);
    assert.equal(after.recovered, true);
    assert.equal(after.stage, "recovered");
    assert.ok(after.events.some((event) => event.type === "recovered"));
  });

  it("gives the resume link the basket and none of the customer's details", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone, 3);

    const resumed = await api<Envelope<Record<string, unknown>>>(
      ctx.baseUrl,
      `/api/v1/checkout/resume/${lead.id}`,
    );

    assert.equal(resumed.status, 200);

    const payload = resumed.body.data;
    const items = payload.items as { productId: string; quantity: number }[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.productId, productId);
    assert.equal(items[0]!.quantity, 3);

    /* WhatsApp messages get forwarded. A link that carried the customer's
       address would hand it to whoever received the forward. */
    const serialised = JSON.stringify(payload);
    assert.ok(!serialised.includes(phone), "the resume payload leaked the phone number");
    assert.ok(!serialised.includes("Test Customer"), "the resume payload leaked the name");
    assert.ok(!("address" in payload), "the resume payload leaked the address");
    /* No prices either — the storefront re-prices from the catalogue, so a
       week-old basket cannot resurrect a week-old price. */
    assert.ok(!serialised.includes("800"), "the resume payload carried a stale price");
  });

  it("answers a dead resume link without saying whether it ever existed", async () => {
    const missing = await api(
      ctx.baseUrl,
      "/api/v1/checkout/resume/00000000-0000-4000-8000-000000000000",
    );
    assert.equal(missing.status, 404);
  });

  it("records what was done and by whom, in order", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone);

    await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}/sent`, {
      method: "POST",
      accessToken: adminToken,
      body: { kind: "help" },
    });

    const issued = await issueCoupon(lead.id);
    const { code } = issued.body.data.coupon;

    await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}/sent`, {
      method: "POST",
      accessToken: adminToken,
      body: { kind: "coupon_offer" },
    });

    await placeOrder(phone, code);

    const after = await findLead(phone);
    const types = after.events.map((event) => event.type);

    assert.deepEqual(types, [
      "help_message_sent",
      "coupon_generated",
      "coupon_offer_sent",
      "coupon_used",
      "recovered",
    ]);

    const generated = after.events.find((event) => event.type === "coupon_generated");
    assert.equal(generated?.detail.code, code);
    /* Named, so the record still says who once that account is gone. */
    assert.equal(generated?.actorName, "recovery-admin@hinar.com.bd");
  });

  it("moves through the stages the panel draws its badge from", async () => {
    const phone = nextPhone();
    const lead = await createLead(phone);
    assert.equal(lead.stage, "open");

    await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}/sent`, {
      method: "POST",
      accessToken: adminToken,
      body: { kind: "help" },
    });
    assert.equal((await findLead(phone)).stage, "help_message_sent");

    await issueCoupon(lead.id);
    assert.equal((await findLead(phone)).stage, "coupon_active");

    await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}/sent`, {
      method: "POST",
      accessToken: adminToken,
      body: { kind: "coupon_offer" },
    });
    assert.equal((await findLead(phone)).stage, "coupon_offer_sent");
  });

  it("lets a lead be offered again once the first offer has run out", async () => {
    const lead = await createLead(nextPhone());
    const first = await issueCoupon(lead.id);
    await expireCoupon(first.body.data.coupon.code);

    const second = await issueCoupon(lead.id);

    /* The one-active-per-lead index counts a timed-out row as live until the
       sweep retires it, so `generate` sweeps first. Without that a customer
       who ignored one offer could never be sent another. */
    assert.equal(second.status, 200);
    assert.equal(second.body.data.created, true);
    assert.notEqual(second.body.data.coupon.code, first.body.data.coupon.code);
  });
});

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

describe("recovery — the report", () => {
  it("counts what was offered, what was spent and what came back", async () => {
    const report = await api<
      Envelope<{
        report: {
          summary: Record<string, number>;
          rates: Record<string, number>;
          outcomes: Record<string, number>;
          byProduct: { name: string; abandoned: number }[];
          byReason: { reason: string; count: number }[];
          byStaff: { name: string; handled: number }[];
        };
      }>
    >(ctx.baseUrl, "/api/v1/admin/reports/recovery?preset=lifetime", {
      accessToken: adminToken,
    });

    assert.equal(report.status, 200);
    const { summary, outcomes, byProduct, byStaff } = report.body.data.report;

    assert.ok(summary.incomplete! > 0);
    assert.ok(summary.couponsGenerated! > 0);
    assert.ok(summary.couponsUsed! > 0);
    assert.ok(summary.recoveredOrders! > 0);

    /* The cost of the offers is real money and has to be visible: the orders
       themselves say the delivery charge was zero, which is the point, so it
       appears nowhere else. */
    assert.equal(summary.freeDeliveryCost, summary.couponsUsed! * INSIDE_DHAKA_CHARGE);

    /* The column that keeps the rest honest — leads nobody touched that came
       back anyway. This file creates several. */
    assert.ok(outcomes.unprompted! > 0);

    assert.ok(byProduct.some((row) => row.name === "LED Study Lamp"));
    assert.ok(byStaff.some((row) => row.name === "recovery-admin@hinar.com.bd"));
  });

  it("counts the reasons the desk recorded", async () => {
    const lead = await createLead(nextPhone());

    await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { note: "Said the delivery charge was too much", reason: "delivery_charge" },
    });

    const report = await api<
      Envelope<{ report: { byReason: { reason: string; count: number }[] } }>
    >(ctx.baseUrl, "/api/v1/admin/reports/recovery?preset=lifetime", {
      accessToken: adminToken,
    });

    const row = report.body.data.report.byReason.find((entry) => entry.reason === "delivery_charge");
    assert.ok(row, "the recorded reason was not counted");
    assert.ok(row.count >= 1);
  });

  it("is closed to the public", async () => {
    const anonymous = await api(ctx.baseUrl, "/api/v1/admin/reports/recovery?preset=lifetime");
    assert.equal(anonymous.status, 401);
  });
});

/* -------------------------------------------------------------------------- */
/* Coupons with no lead behind them                                           */
/* -------------------------------------------------------------------------- */

describe("recovery — coupons made for nobody in particular", () => {
  async function mint(note?: string) {
    return api<Envelope<{ coupon: Coupon & { note: string }; created: boolean }>>(
      ctx.baseUrl,
      "/api/v1/admin/coupons",
      {
        method: "POST",
        accessToken: adminToken,
        body: note === undefined ? {} : { note },
      },
    );
  }

  it("mints one with no abandoned checkout behind it", async () => {
    const result = await mint("Rahim — phone order");

    assert.equal(result.status, 200);
    assert.equal(result.body.data.created, true);
    assert.match(result.body.data.coupon.code, /^[ABCDEFGHJKLMNPQRTUVWXYZ2346789]{6}$/);
    assert.equal(result.body.data.coupon.note, "Rahim — phone order");
    /* No basket, so zero MEANS zero rather than "a free one". */
    assert.equal(result.body.data.coupon.cartValue, 0);
  });

  it("lets several be live at once", async () => {
    const first = await mint("one");
    const second = await mint("two");
    const third = await mint("three");

    /* The one-active-per-lead index is partial on `abandoned_checkout_id is not
       null` precisely so it cannot catch these. If it ever stops being partial
       this is the test that says so. */
    for (const result of [first, second, third]) {
      assert.equal(result.status, 200);
      assert.equal(result.body.data.coupon.state, "active");
    }

    const codes = new Set([
      first.body.data.coupon.code,
      second.body.data.coupon.code,
      third.body.data.coupon.code,
    ]);
    assert.equal(codes.size, 3);
  });

  it("ignores the smallest-basket rule, because there is no basket", async () => {
    await patchSettings({ recovery: { couponMinCartValue: 5000 } });

    /* A lead below the floor is still refused... */
    const lead = await createLead(nextPhone());
    const refusedForLead = await issueCoupon(lead.id);
    assert.equal(refusedForLead.status, 400);

    /* ...and a standalone coupon is not, because the rule has nothing to
       measure. The panel says so where one is created; this pins the
       behaviour so it cannot change silently. */
    const standalone = await mint("no basket to measure");
    assert.equal(standalone.status, 200);

    await patchSettings({ recovery: { couponMinCartValue: 0 } });
  });

  it("is spent exactly like a lead's, and refused the second time", async () => {
    const { code } = (await mint("walk-in")).body.data.coupon;

    const first = await placeOrder(nextPhone(), code);
    assert.equal(first.status, 201);
    assert.equal(first.body.data.order.deliveryCharge, 0);

    const second = await placeOrder(nextPhone(), code);
    assert.equal(second.status, 409);
    assert.match(second.body.error!.message, /already been used/i);
  });

  it("can be withdrawn before it is spent, and not after", async () => {
    const live = (await mint("withdraw me")).body.data.coupon;

    const withdrawn = await api(ctx.baseUrl, `/api/v1/admin/coupons/${live.id}`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    assert.equal(withdrawn.status, 200);

    const refused = await placeOrder(nextPhone(), live.code);
    assert.equal(refused.status, 409);

    const spent = (await mint("already spent")).body.data.coupon;
    await placeOrder(nextPhone(), spent.code);

    const tooLate = await api(ctx.baseUrl, `/api/v1/admin/coupons/${spent.id}`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    /* The order exists. Taking the coupon back now would not take the free
       delivery back with it. */
    assert.equal(tooLate.status, 409);
  });

  it("lists every coupon with the state a human would read", async () => {
    const listed = await api<
      Envelope<{
        coupons: (Coupon & { note: string; phone: string | null; orderNumber: string | null })[];
        totals: Record<string, number>;
      }>
    >(ctx.baseUrl, "/api/v1/admin/coupons", { accessToken: adminToken });

    assert.equal(listed.status, 200);
    const { coupons, totals } = listed.body.data;

    assert.ok(coupons.length > 0);
    assert.ok(totals.created! > 0);
    assert.ok(totals.used! > 0);

    /* A coupon from a lead carries the number it was sent to; a standalone one
       carries the note instead. Without one or the other the list is a column
       of anonymous codes. */
    assert.ok(coupons.some((row) => row.phone !== null));
    assert.ok(coupons.some((row) => row.note !== ""));

    /* Spent ones name the order they were spent on. */
    const used = coupons.find((row) => row.state === "used");
    assert.ok(used?.orderNumber, "a used coupon did not name its order");
  });

  it("filters on the state a human sees, not the stored word", async () => {
    const stale = (await mint("about to expire")).body.data.coupon;
    await expireCoupon(stale.code);

    /* `status` still reads 'active' in the row — the sweep has not run. The
       filter must go by `expires_at` anyway, or the panel shows a dead coupon
       as live for as long as it takes a scheduler to notice. */
    const expired = await api<Envelope<{ coupons: { code: string }[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/coupons?state=expired",
      { accessToken: adminToken },
    );
    assert.ok(expired.body.data.coupons.some((row) => row.code === stale.code));

    const active = await api<Envelope<{ coupons: { code: string }[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/coupons?state=active",
      { accessToken: adminToken },
    );
    assert.ok(!active.body.data.coupons.some((row) => row.code === stale.code));
  });

  it("is closed to the public", async () => {
    const listed = await api(ctx.baseUrl, "/api/v1/admin/coupons");
    assert.equal(listed.status, 401);

    const created = await api(ctx.baseUrl, "/api/v1/admin/coupons", {
      method: "POST",
      body: {},
    });
    assert.equal(created.status, 401);
  });
});

/* -------------------------------------------------------------------------- */
/* Coupons that may be spent more than once                                   */
/* -------------------------------------------------------------------------- */

describe("recovery — how many times, and for how long", () => {
  interface FullCoupon extends Coupon {
    note: string;
    maxUses: number | null;
    usedCount: number;
    uses: { orderNumber: string; deliverySaved: number; at: string }[];
    phone: string | null;
    orderNumber: string | null;
  }

  async function mint(body: Record<string, unknown>) {
    return api<Envelope<{ coupon: FullCoupon; created: boolean }>>(
      ctx.baseUrl,
      "/api/v1/admin/coupons",
      { method: "POST", accessToken: adminToken, body },
    );
  }

  async function readBack(code: string): Promise<FullCoupon> {
    const listed = await api<Envelope<{ coupons: FullCoupon[] }>>(
      ctx.baseUrl,
      "/api/v1/admin/coupons",
      { accessToken: adminToken },
    );
    const row = listed.body.data.coupons.find((c) => c.code === code);
    assert.ok(row, `coupon ${code} not in the list`);
    return row;
  }

  it("takes a code the owner chose", async () => {
    const result = await mint({ code: "eid-2026", note: "Eid campaign" });

    assert.equal(result.status, 200);
    /* Folded, so eid-2026 and EID-2026 cannot become two coupons. */
    assert.equal(result.body.data.coupon.code, "EID-2026");
  });

  it("refuses a code somebody already has", async () => {
    const taken = await mint({ code: "EID-2026" });

    assert.equal(taken.status, 409);
    assert.match(taken.body.error!.message, /already in use/i);
  });

  it("lets one code be spent the number of times it was given", async () => {
    const { code } = (await mint({ maxUses: 3, note: "three friends" })).body.data.coupon;

    for (let i = 0; i < 3; i += 1) {
      const placed = await placeOrder(nextPhone(), code);
      assert.equal(placed.status, 201, `use ${i + 1} was refused`);
      assert.equal(placed.body.data.order.deliveryCharge, 0);
    }

    /* The fourth is refused — the limit is enforced by the same conditional
       UPDATE that enforced single use, so two orders racing for the last one
       cannot both win. */
    const fourth = await placeOrder(nextPhone(), code);
    assert.equal(fourth.status, 409);
    assert.match(fourth.body.error!.message, /already been used/i);

    const row = await readBack(code);
    assert.equal(row.usedCount, 3);
    assert.equal(row.maxUses, 3);
    assert.equal(row.state, "used");
  });

  it("records every order a code was spent on, not just the first", async () => {
    const { code } = (await mint({ maxUses: 2, note: "two uses" })).body.data.coupon;

    const first = await placeOrder(nextPhone(), code);
    const second = await placeOrder(nextPhone(), code);

    const row = await readBack(code);

    assert.equal(row.uses.length, 2);
    assert.deepEqual(
      row.uses.map((use) => use.orderNumber),
      [first.body.data.order.orderNumber, second.body.data.order.orderNumber],
    );
    /* What each use cost, frozen at the time — the order says zero, which is
       the point of the offer, so it is recorded nowhere else. */
    for (const use of row.uses) assert.equal(use.deliverySaved, INSIDE_DHAKA_CHARGE);
  });

  it("never runs out when no limit was set", async () => {
    const { code } = (await mint({ maxUses: null, note: "open house" })).body.data.coupon;

    for (let i = 0; i < 4; i += 1) {
      const placed = await placeOrder(nextPhone(), code);
      assert.equal(placed.status, 201, `use ${i + 1} was refused`);
    }

    const row = await readBack(code);
    assert.equal(row.maxUses, null);
    assert.equal(row.usedCount, 4);
    /* Still spendable. Only the deadline can stop this one. */
    assert.equal(row.state, "active");
  });

  it("lives for as long as it was given, not the shop default", async () => {
    const { coupon } = (await mint({ validHours: 24 * 7, note: "a week" })).body.data;

    const hours = (Date.parse(coupon.expiresAt) - Date.now()) / 3_600_000;
    /* Seven days, within a minute of it. */
    assert.ok(hours > 167.9 && hours < 168.1, `expected ~168 hours, got ${hours}`);
  });

  it("still gives a lead offer the shop's own settings, untouched", async () => {
    await patchSettings({ recovery: { couponHours: 6 } });

    const lead = await createLead(nextPhone());
    const { coupon } = (await issueCoupon(lead.id)).body.data;

    const hours = (Date.parse(coupon.expiresAt) - Date.now()) / 3_600_000;
    assert.ok(hours > 5.9 && hours < 6.1, `expected ~6 hours, got ${hours}`);
    /* And one use, exactly as before this feature existed. The Abandoned page
       has no field for either and must keep behaving as it did. */
    assert.equal(coupon.maxUses, 1);

    await patchSettings({ recovery: { couponHours: 24 } });
  });

  it("counts uses, not coupons, when it reports the cost", async () => {
    const { code } = (await mint({ maxUses: 2, note: "cost check" })).body.data.coupon;
    await placeOrder(nextPhone(), code);
    await placeOrder(nextPhone(), code);

    const listed = await api<Envelope<{ totals: Record<string, number> }>>(
      ctx.baseUrl,
      "/api/v1/admin/coupons",
      { accessToken: adminToken },
    );

    const { totals } = listed.body.data;
    /* One coupon, two uses, two delivery charges. A per-coupon count would
       have under-reported what the shop actually paid. */
    assert.ok(totals.redemptions! >= 2);
    assert.equal(totals.deliveryCost, totals.redemptions! * INSIDE_DHAKA_CHARGE);
  });

  it("refuses a half-spent code once it has expired", async () => {
    const { code } = (await mint({ maxUses: 5, note: "expires mid-way" })).body.data.coupon;

    const used = await placeOrder(nextPhone(), code);
    assert.equal(used.status, 201);

    await expireCoupon(code);

    const late = await placeOrder(nextPhone(), code);
    assert.equal(late.status, 409);
    assert.match(late.body.error!.message, /expired/i);

    const row = await readBack(code);
    assert.equal(row.state, "expired");
    assert.equal(row.usedCount, 1);
  });
});
