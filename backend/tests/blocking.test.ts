import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, seedAdminAndLogin, startTestServer, type TestContext } from "./helpers/test-server.js";

/**
 * Refusing an address — integration tests.
 *
 * The feature that can hurt real customers, so the tests are mostly about what
 * it must NOT do. In Bangladesh one public address fronts hundreds of shoppers
 * on carrier-grade NAT, and every one of these assertions exists because
 * getting it wrong takes revenue from people who did nothing.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

interface Block {
  id: string;
  ip: string;
  active: boolean;
  hitCount: number;
}

const PASSWORD = "CorrectHorse123";
const SHOPPER = "203.0.113.44";

let ctx: TestContext;
let adminToken = "";
let productId = "";

before(async () => {
  ctx = await startTestServer();

  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "blocking-admin@example.com",
    password: PASSWORD,
    role: "super_admin",
  });

  const category = await api<Envelope<{ category: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/categories",
    {
      method: "POST",
      accessToken: adminToken,
      body: { name: "Blocked Test", slug: "blocked-test" },
    },
  );

  const product = await api<Envelope<{ product: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/products",
    {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Blocking Test Lamp",
        slug: "blocking-test-lamp",
        sku: "BLK-1",
        categoryId: category.body.data.category.id,
        price: 1000,
        stockQuantity: 500,
        status: "active",
      },
    },
  );

  productId = product.body.data.product.id;
});

after(async () => {
  await ctx.close();
});

/**
 * Places an order as if it came from `ip`.
 *
 * `x-customer-ip` is how the storefront names the shopper it is acting for, and
 * the API honours it only from a private caller — which the test client is.
 */
function orderFrom(ip: string, phone = "01712345678") {
  return api<Envelope<{ order: { orderNumber: string } }>>(
    ctx.baseUrl,
    "/api/v1/checkout/order",
    {
      method: "POST",
      headers: { "x-customer-ip": ip },
      body: {
        customerName: "Rahim Uddin",
        phone,
        address: "House 12, Road 5, Block C",
        areaText: "Dhanmondi, Dhaka",
        items: [{ productId, quantity: 1 }],
      },
    },
  );
}

function block(ip: string, expiresInDays: number | null = 7) {
  return api<Envelope<{ block: Block }>>(ctx.baseUrl, "/api/v1/admin/ips", {
    method: "POST",
    accessToken: adminToken,
    body: { ip, reason: "test", expiresInDays },
  });
}

describe("blocking — refusing an address", () => {
  it("records the address an order came from", async () => {
    const placed = await orderFrom(SHOPPER);
    assert.equal(placed.status, 201, JSON.stringify(placed.body));

    const detail = await api<Envelope<{ order: { customerIp: string } }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${placed.body.data.order.orderNumber}`,
      { accessToken: adminToken },
    );

    assert.equal(detail.body.data.order.customerIp, SHOPPER);
  });

  it("refuses a checkout from a blocked address", async () => {
    const ip = "203.0.113.90";
    assert.equal((await orderFrom(ip)).status, 201, "accepted before the block");

    const created = await block(ip);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const refused = await orderFrom(ip);
    assert.equal(refused.status, 403);
    assert.doesNotMatch(
      refused.body.error!.message,
      /block/i,
      "telling an abuser they are blocked is an instruction to reconnect and retry",
    );
  });

  /**
   * The most important test here. A blocked address can still shop — only
   * placing the order is refused. Blocking browsing would multiply the
   * collateral damage on a shared carrier address while doing nothing an
   * abuser could not walk around by reconnecting.
   */
  it("still lets a blocked address browse, search and price a cart", async () => {
    const ip = "203.0.113.91";
    await block(ip);

    const headers = { "x-customer-ip": ip };

    const products = await api(ctx.baseUrl, "/api/v1/products", { headers });
    assert.equal(products.status, 200, "browsing must still work");

    const quote = await api(ctx.baseUrl, "/api/v1/checkout/quote", {
      method: "POST",
      headers,
      body: { items: [{ productId, quantity: 1 }], areaText: "Dhanmondi" },
    });
    assert.equal(quote.status, 200, "pricing a cart must still work");
  });

  it("lets the order through again once the block is lifted", async () => {
    const ip = "203.0.113.92";
    const created = await block(ip);

    assert.equal((await orderFrom(ip)).status, 403);

    const lifted = await api(ctx.baseUrl, `/api/v1/admin/ips/${created.body.data.block.id}`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    assert.equal(lifted.status, 204);

    assert.equal((await orderFrom(ip)).status, 201, "unblocking must take effect immediately");
  });

  it("does not refuse an address whose block has expired", async () => {
    const ip = "203.0.113.93";

    /* Expiry is enforced by the query that builds the live set, so a block that
       is already past its date never enters it. */
    const { getDb } = await import("../src/db/client.js");
    const { blockedIps } = await import("../src/db/schema/blocked-ips.js");
    const { refreshBlockedIps } = await import("../src/modules/security/blocked-ip.service.js");

    await getDb()
      .insert(blockedIps)
      .values({
        ip: `${ip}/32`,
        reason: "already over",
        expiresAt: new Date(Date.now() - 60_000),
      });

    await refreshBlockedIps();

    assert.equal((await orderFrom(ip)).status, 201);
  });

  /**
   * The self-lockout guard, and the reason it is a hard refusal rather than a
   * warning. The storefront reaches this API from inside the Docker network, so
   * a block on a private address would not stop one fraudster — it would refuse
   * every order in the shop at once, with nothing on screen to say why.
   */
  it("refuses to block a private or loopback address", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.19.0.1", "::1"]) {
      const res = await block(ip);
      assert.equal(res.status, 400, `expected ${ip} to be rejected`);
    }
  });

  it("refuses to block something that is not an address", async () => {
    assert.equal((await block("not-an-ip")).status, 400);
  });

  it("will not block one address twice", async () => {
    const ip = "203.0.113.94";
    assert.equal((await block(ip)).status, 201);
    assert.equal((await block(ip)).status, 409, "a duplicate could not be lifted by unblocking");
  });

  it("blocks an IPv6 customer as their whole /64, not one address", async () => {
    const created = await block("2001:db8:1:2:3:4:5:6");
    assert.equal(created.status, 201, JSON.stringify(created.body));

    assert.match(
      created.body.data.block.ip,
      /\/64$/,
      "one residential IPv6 allocation is 2^64 addresses — blocking a single one does nothing",
    );

    /* A different host inside the same allocation is refused too. */
    assert.equal((await orderFrom("2001:db8:1:2:ffff:ffff:ffff:ffff")).status, 403);

    /* A neighbouring /64 is not. */
    assert.equal((await orderFrom("2001:db8:1:3::1")).status, 201);
  });

  it("keeps the block list out of reach without an admin token", async () => {
    assert.equal((await api(ctx.baseUrl, "/api/v1/admin/ips")).status, 401);
    assert.equal(
      (await api(ctx.baseUrl, "/api/v1/admin/ips", { method: "POST", body: { ip: "1.2.3.4" } }))
        .status,
      401,
    );
  });

  /**
   * Two definitions of "live" used to disagree: the unique index called a row
   * live while `unblocked_at` was null, the runtime only while it was also
   * unexpired. So a lapsed block still held the slot, and blocking the same
   * address again — the natural move when the same abuser returns — was refused
   * as a duplicate of a block that was refusing nothing.
   */
  it("lets an address be blocked again after its previous block expired", async () => {
    const ip = "203.0.113.96";

    const { getDb } = await import("../src/db/client.js");
    const { blockedIps } = await import("../src/db/schema/blocked-ips.js");

    await getDb()
      .insert(blockedIps)
      .values({
        ip: `${ip}/32`,
        reason: "lapsed",
        expiresAt: new Date(Date.now() - 60_000),
      });

    const again = await block(ip);
    assert.equal(again.status, 201, JSON.stringify(again.body));

    assert.equal((await orderFrom(ip)).status, 403, "and the new block actually applies");
  });

  it("counts refusals against the blocked range, however the source varies", async () => {
    const created = await block("2001:db8:9:9:1:1:1:1");
    assert.equal(created.status, 201);

    const { flushBlockHits } = await import("../src/modules/security/blocked-ip.service.js");

    /* Three different hosts inside the one blocked /64. Keyed by address these
       would be three separate rows to update; keyed by range they are one. */
    for (const host of ["::1", "::2", "::3"]) {
      assert.equal((await orderFrom(`2001:db8:9:9${host}`)).status, 403);
    }

    await flushBlockHits();

    const list = await api<Envelope<{ blocks: Block[] }>>(ctx.baseUrl, "/api/v1/admin/ips", {
      accessToken: adminToken,
    });
    const row = list.body.data.blocks.find((entry) => entry.id === created.body.data.block.id);

    assert.ok(row);
    assert.equal(row.hitCount, 3, "all three refusals land on the one blocked range");
  });

  it("keeps lifted blocks on the list, so a wrongful one can be traced", async () => {
    const ip = "203.0.113.95";
    const created = await block(ip);

    await api(ctx.baseUrl, `/api/v1/admin/ips/${created.body.data.block.id}`, {
      method: "DELETE",
      accessToken: adminToken,
    });

    const list = await api<Envelope<{ blocks: Block[] }>>(ctx.baseUrl, "/api/v1/admin/ips", {
      accessToken: adminToken,
    });

    const row = list.body.data.blocks.find((entry) => entry.id === created.body.data.block.id);
    assert.ok(row, "the record must survive being lifted");
    assert.equal(row.active, false);
  });
});
