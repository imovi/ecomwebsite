import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  seedAdminAndLogin,
  startTestServer,
  type TestContext,
} from "./helpers/test-server.js";

/**
 * Warning the shop before it runs out.
 *
 * The behaviour that matters is not "can it find a low product" — a WHERE
 * clause can do that. It is that the warning arrives ONCE per dip and again
 * after a restock, because the check runs every five minutes and an alert that
 * repeats twelve times an hour is one that gets muted before the night it
 * matters.
 *
 * Telegram is never actually reached here. The send is stubbed, so what is
 * being tested is the decision to send and the bookkeeping around it, which is
 * where the bugs live.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

const PASSWORD = "StockAlert@2026";

let ctx: TestContext;
let adminToken: string;
let productId: string;

/** Every message the code tried to send, in order. */
let sent: { label: string; left: number }[][] = [];

before(async () => {
  ctx = await startTestServer();

  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "stock-admin@hinar.com.bd",
    password: PASSWORD,
    role: "admin",
  });

  /* Telegram has to look configured, or the check exits before doing anything.
     Asserted, because a settings body with the wrong shape is rejected by
     `.strict()` and would otherwise fail silently — which it did once. */
  const configured = await setTelegram({
    botToken: "123456789:AAFakeTokenForTestsOnly_0123456789",
    chatId: "999",
    enabled: true,
  });
  assert.equal(configured, 200, "Telegram settings were not accepted");

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
        sku: "STOCK-LAMP",
        brand: "Testco",
        categoryId: category.body.data.category.id,
        price: 800,
        status: "active",
        stockQuantity: 50,
        lowStockThreshold: 5,
      },
    },
  );
  productId = product.body.data.product.id;
});

after(async () => {
  await ctx.close();
});

/** Telegram lives under `integrations`, and the body is `.strict()`. */
async function setTelegram(telegram: Record<string, unknown>): Promise<number> {
  const result = await api(ctx.baseUrl, "/api/v1/admin/settings", {
    method: "PATCH",
    accessToken: adminToken,
    body: { integrations: { telegram } },
  });
  return result.status;
}

/** Sets stock directly, the way a sale or a restock would. */
async function setStock(quantity: number): Promise<void> {
  const { getDb } = await import("../src/db/client.js");
  const { products } = await import("../src/db/schema/products.js");
  const { eq } = await import("drizzle-orm");

  await getDb()
    .update(products)
    .set({ stockQuantity: quantity })
    .where(eq(products.id, productId));
}

/**
 * Runs the check with the outbound message captured instead of sent.
 *
 * What is being tested is the decision to send and the bookkeeping around it,
 * not Telegram's HTTP API.
 */
async function runCheck() {
  const { alertLowStock } = await import("../src/modules/integrations/stock-alert.service.js");
  return alertLowStock((items) => {
    sent.push(items.map((item) => ({ label: item.label, left: item.left })));
    return Promise.resolve({ sent: true });
  });
}

/* -------------------------------------------------------------------------- */

describe("low stock — warned once per dip", () => {
  it("says nothing while there is plenty", async () => {
    sent = [];
    const outcome = await runCheck();

    assert.equal(outcome.sent, false);
    assert.equal(sent.length, 0);
  });

  it("warns when stock falls to the threshold", async () => {
    sent = [];
    await setStock(5);

    const outcome = await runCheck();

    assert.equal(outcome.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.length, 1);
    assert.equal(sent[0]![0]!.label, "LED Study Lamp");
    assert.equal(sent[0]![0]!.left, 5);
  });

  it("does NOT warn again on the next pass", async () => {
    sent = [];

    /* The check runs every five minutes. This is the assertion that keeps it
       from becoming twelve messages an hour. */
    await runCheck();
    await runCheck();
    await runCheck();

    assert.equal(sent.length, 0);
  });

  it("does not warn again as stock keeps falling within the same dip", async () => {
    sent = [];
    await setStock(2);
    await runCheck();
    await setStock(0);
    await runCheck();

    /* Still the same dip. The shop has been told; it does not need telling
       again every time one more unit sells. */
    assert.equal(sent.length, 0);
  });

  it("warns again after a restock and a second run-down", async () => {
    sent = [];

    await setStock(50);
    /* The restock alone must say nothing. */
    await runCheck();
    assert.equal(sent.length, 0);

    await setStock(3);
    const outcome = await runCheck();

    assert.equal(outcome.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]![0]!.left, 3);
  });

  it("keeps quiet about products nobody can buy", async () => {
    sent = [];
    await setStock(50);
    await runCheck();

    /* Hidden from the storefront. Running out costs the shop nothing, and
       warning about it teaches the owner these messages are noise. */
    await api(ctx.baseUrl, `/api/v1/admin/products/${productId}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { isVisible: false },
    });
    await setStock(1);

    const outcome = await runCheck();
    assert.equal(outcome.sent, false);
    assert.equal(sent.length, 0);

    await api(ctx.baseUrl, `/api/v1/admin/products/${productId}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { isVisible: true },
    });
  });

  it("says nothing at all when Telegram is not set up", async () => {
    sent = [];
    await setStock(50);
    await runCheck();

    assert.equal(await setTelegram({ enabled: false }), 200);

    await setStock(1);
    const outcome = await runCheck();

    /* Not configured is not a failure — a shop that has not connected Telegram
       must not get an error in its log every five minutes. */
    assert.equal(outcome.sent, false);
    assert.equal(outcome.reason, "disabled");
    assert.equal(sent.length, 0);

    assert.equal(await setTelegram({ enabled: true }), 200);
  });
});
