import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  seedAdminAndLogin,
  startTestServer,
  type TestContext,
} from "./helpers/test-server.js";

/**
 * Order Management module — integration tests.
 *
 * Real HTTP, real Postgres (PGlite), real transactions, real middleware order.
 * Nothing is mocked, so a pass here means the flow genuinely works rather than
 * that the mocks agree with each other.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: { pagination?: { page: number; perPage: number; total: number; totalPages: number } };
  error?: { code: string; message: string; details?: { field: string; message: string }[] };
  requestId: string;
}

interface TimelineEntry {
  id: string;
  type: string;
  field: string | null;
  previousValue: unknown;
  newValue: unknown;
  actorName: string;
  adminId: string | null;
  note: string | null;
  createdAt: string;
}

interface OrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  sku: string;
  variantLabel: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  deliveryZone: string;
  status: string;
  paymentMethod: string;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  itemCount: number;
  totalQuantity: number;
  version: number;
  internalNotes: string | null;
  cancellationReason: string | null;
  items: OrderItem[];
  timeline: TimelineEntry[];
  allowedTransitions: string[];
  createdAt: string;
}

const PASSWORD = "OrderAdmin123";

let ctx: TestContext;
let adminToken = "";
let managerToken = "";

/** Catalogue fixtures, created once via the Phase 2 admin API. */
let categoryId = "";
let phoneProductId = "";
let variant256Id = "";
let variant512Id = "";
let simpleProductId = "";
let scarceProductId = "";

async function createOrder(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return api<Envelope<{ order: { orderNumber: string } }>>(
    ctx.baseUrl,
    "/api/v1/checkout/order",
    {
      method: "POST",
      headers,
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5, Block C",
        areaText: "Dhanmondi, Dhaka",
        items: [{ productId: phoneProductId, variantId: variant256Id, quantity: 1 }],
        ...overrides,
      },
    },
  );
}

/**
 * Places an order that the test expects to succeed.
 *
 * Asserts the status and surfaces the error body when it does not — otherwise
 * a failed setup shows up as an opaque "cannot read property of undefined"
 * several lines later, in a test that is not the one actually broken.
 */
async function createOrderOk(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await createOrder(overrides, headers);
  assert.equal(
    res.status,
    201,
    `expected order creation to succeed, got ${res.status}: ${JSON.stringify(res.body)}`,
  );
  return res.body.data.order.orderNumber;
}

/** Loads the full admin view of an order by its number. */
async function loadOrder(orderNumber: string): Promise<Order> {
  const res = await api<Envelope<{ order: Order }>>(
    ctx.baseUrl,
    `/api/v1/admin/orders/${orderNumber}`,
    { accessToken: adminToken },
  );
  assert.equal(res.status, 200, `could not load ${orderNumber}`);
  return res.body.data.order;
}

/** Current stock of a variant, read through the public product API. */
async function variantStock(variantId: string): Promise<number> {
  const res = await api<Envelope<{ product: { variants: { id: string; stockQuantity: number }[] } }>>(
    ctx.baseUrl,
    `/api/v1/admin/products/${phoneProductId}`,
    { accessToken: adminToken },
  );
  const variant = res.body.data.product.variants.find((v) => v.id === variantId);
  assert.ok(variant, "variant not found");
  return variant.stockQuantity;
}

before(async () => {
  ctx = await startTestServer();

  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "order-admin@gng.com.bd",
    password: PASSWORD,
    role: "admin",
  });
  managerToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "order-manager@gng.com.bd",
    password: PASSWORD,
    role: "manager",
  });

  const category = await api<Envelope<{ category: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/categories",
    { method: "POST", accessToken: adminToken, body: { name: "Smartphones" } },
  );
  categoryId = category.body.data.category.id;

  const phone = await api<
    Envelope<{ product: { id: string; variants: { id: string; sku: string }[] } }>
  >(ctx.baseUrl, "/api/v1/admin/products", {
    method: "POST",
    accessToken: adminToken,
    body: {
      name: "Test Flagship Phone",
      sku: "TEST-PHONE",
      brand: "Testco",
      categoryId,
      price: 50000,
      status: "active",
      variantOptions: [{ name: "Storage", values: ["256GB", "512GB"] }],
      variants: [
        { sku: "TEST-PHONE-256", options: { Storage: "256GB" }, price: 50000, stockQuantity: 400 },
        { sku: "TEST-PHONE-512", options: { Storage: "512GB" }, price: 60000, stockQuantity: 400 },
      ],
    },
  });
  phoneProductId = phone.body.data.product.id;
  variant256Id = phone.body.data.product.variants.find((v) => v.sku === "TEST-PHONE-256")!.id;
  variant512Id = phone.body.data.product.variants.find((v) => v.sku === "TEST-PHONE-512")!.id;

  const simple = await api<Envelope<{ product: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/products",
    {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Test Charger",
        sku: "TEST-CHARGER",
        brand: "Testco",
        categoryId,
        price: 2000,
        stockQuantity: 400,
        status: "active",
      },
    },
  );
  simpleProductId = simple.body.data.product.id;

  /* Deliberately scarce, so stock-exhaustion paths can be exercised with a
     quantity inside the per-item cap. Ordering more than the cap is a
     validation failure (422) and would not reach the stock logic at all. */
  const scarce = await api<Envelope<{ product: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/products",
    {
      method: "POST",
      accessToken: adminToken,
      body: {
        name: "Test Scarce Item",
        sku: "TEST-SCARCE",
        brand: "Testco",
        categoryId,
        price: 1500,
        stockQuantity: 3,
        status: "active",
      },
    },
  );
  scarceProductId = scarce.body.data.product.id;
});

after(async () => {
  await ctx.close();
});

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

describe("settings", () => {
  it("requires authentication to read", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/settings");
    assert.equal(res.status, 401);
  });

  it("returns seeded delivery charges", async () => {
    const res = await api<Envelope<{ settings: { delivery: { insideDhaka: number; outsideDhaka: number } } }>>(
      ctx.baseUrl,
      "/api/v1/admin/settings",
      { accessToken: adminToken },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.settings.delivery.insideDhaka, 80);
    assert.equal(res.body.data.settings.delivery.outsideDhaka, 130);
  });

  it("lets an admin change charges but not a manager", async () => {
    const asManager = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: managerToken,
      body: { delivery: { insideDhaka: 90 } },
    });
    assert.equal(asManager.status, 403);

    const asAdmin = await api<Envelope<{ settings: { store: { name: string } } }>>(
      ctx.baseUrl,
      "/api/v1/admin/settings",
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { store: { name: "gng Test Store", phone: "09612000000" } },
      },
    );
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.body.data.settings.store.name, "gng Test Store");
  });

  it("rejects unknown keys and negative amounts", async () => {
    const unknown = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: adminToken,
      body: { delivery: { insideDhakaCharge: 90 } },
    });
    const negative = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: adminToken,
      body: { delivery: { insideDhaka: -5 } },
    });
    assert.equal(unknown.status, 422);
    assert.equal(negative.status, 422);
  });
});

/* -------------------------------------------------------------------------- */
/* Checkout — quote                                                           */
/* -------------------------------------------------------------------------- */

describe("checkout — quote", () => {
  it("prices a cart and infers the zone from the area text", async () => {
    const res = await api<
      Envelope<{
        subtotal: number;
        deliveryCharge: number;
        grandTotal: number;
        deliveryZone: string;
        zoneInferred: boolean;
        zoneMatchedOn: string;
      }>
    >(ctx.baseUrl, "/api/v1/checkout/quote", {
      method: "POST",
      body: {
        items: [{ productId: phoneProductId, variantId: variant256Id, quantity: 2 }],
        areaText: "Dhanmondi 27",
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.subtotal, 100000);
    assert.equal(res.body.data.deliveryZone, "inside_dhaka");
    assert.equal(res.body.data.deliveryCharge, 80);
    assert.equal(res.body.data.grandTotal, 100080);
    assert.equal(res.body.data.zoneInferred, true);
    assert.equal(res.body.data.zoneMatchedOn, "Dhanmondi");
  });

  it("bills Savar at the outside-Dhaka rate despite the word Dhaka", async () => {
    const res = await api<Envelope<{ deliveryZone: string; deliveryCharge: number }>>(
      ctx.baseUrl,
      "/api/v1/checkout/quote",
      {
        method: "POST",
        body: {
          items: [{ productId: simpleProductId, quantity: 1 }],
          areaText: "Savar, Dhaka",
        },
      },
    );

    assert.equal(res.body.data.deliveryZone, "outside_dhaka");
    assert.equal(res.body.data.deliveryCharge, 130);
  });

  it("returns a null zone for an unrecognised area rather than guessing", async () => {
    const res = await api<Envelope<{ deliveryZone: string | null; deliveryCharge: number }>>(
      ctx.baseUrl,
      "/api/v1/checkout/quote",
      {
        method: "POST",
        body: { items: [{ productId: simpleProductId, quantity: 1 }], areaText: "zzzzzz" },
      },
    );

    assert.equal(res.body.data.deliveryZone, null);
    assert.equal(res.body.data.deliveryCharge, 0);
  });

  it("honours an explicit zone over the inferred one", async () => {
    const res = await api<Envelope<{ deliveryZone: string; deliveryCharge: number }>>(
      ctx.baseUrl,
      "/api/v1/checkout/quote",
      {
        method: "POST",
        body: {
          items: [{ productId: simpleProductId, quantity: 1 }],
          areaText: "Dhanmondi",
          deliveryZone: "outside_dhaka",
        },
      },
    );
    assert.equal(res.body.data.deliveryZone, "outside_dhaka");
    assert.equal(res.body.data.deliveryCharge, 130);
  });

  it("rejects an empty cart and an unknown product", async () => {
    const empty = await api(ctx.baseUrl, "/api/v1/checkout/quote", {
      method: "POST",
      body: { items: [] },
    });
    const unknown = await api(ctx.baseUrl, "/api/v1/checkout/quote", {
      method: "POST",
      body: {
        items: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }],
      },
    });

    assert.equal(empty.status, 422);
    assert.equal(unknown.status, 422);
  });

  it("suggests areas for the address field", async () => {
    const res = await api<Envelope<{ areas: string[] }>>(
      ctx.baseUrl,
      "/api/v1/checkout/areas?q=dhan",
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.areas.some((area) => area.startsWith("Dhanmondi")));
  });
});

/* -------------------------------------------------------------------------- */
/* Checkout — place order                                                     */
/* -------------------------------------------------------------------------- */

describe("checkout — place order", () => {
  it("places an order, snapshots prices and decrements stock", async () => {
    const before = await variantStock(variant256Id);

    const res = await createOrder({
      items: [{ productId: phoneProductId, variantId: variant256Id, quantity: 2 }],
    });

    assert.equal(res.status, 201);
    const confirmation = res.body.data.order as unknown as {
      orderNumber: string;
      subtotal: number;
      deliveryCharge: number;
      grandTotal: number;
      status: string;
      paymentMethod: string;
    };

    assert.match(confirmation.orderNumber, /^GNG-\d+$/);
    assert.equal(confirmation.subtotal, 100000);
    assert.equal(confirmation.deliveryCharge, 80);
    assert.equal(confirmation.grandTotal, 100080);
    assert.equal(confirmation.status, "pending");
    assert.equal(confirmation.paymentMethod, "cod");

    assert.equal(await variantStock(variant256Id), before - 2, "stock decremented");
  });

  it("does not leak internal fields to the public response", async () => {
    const res = await createOrder();
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes("internalNotes"));
    assert.ok(!body.includes("\"version\""));
    assert.ok(!body.includes("timeline"));
  });

  it("writes an opening timeline entry attributed to the customer", async () => {
    const res = await createOrder();
    const order = await loadOrder(res.body.data.order.orderNumber);

    const created = order.timeline.find((entry) => entry.type === "order_created");
    assert.ok(created, "order_created event exists");
    assert.equal(created.actorName, "Customer");
    assert.equal(created.adminId, null);
  });

  it("rejects an invalid phone number", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/checkout/order", {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "12345",
        address: "House 12, Road 5",
        areaText: "Dhanmondi",
        items: [{ productId: simpleProductId, quantity: 1 }],
      },
    });

    assert.equal(res.status, 422);
    assert.ok(res.body.error?.details?.some((d) => d.field === "body.phone"));
  });

  it("normalises phone formats to 01XXXXXXXXX", async () => {
    for (const input of ["+8801712345699", "8801712345699", "017 1234 5699"]) {
      const res = await createOrder({ phone: input });
      assert.equal(res.status, 201, `rejected ${input}`);
      const order = await loadOrder(res.body.data.order.orderNumber);
      assert.equal(order.phone, "01712345699");
    }
  });

  it("refuses a price supplied by the client", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/checkout/order", {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5",
        areaText: "Dhanmondi",
        items: [{ productId: simpleProductId, quantity: 1 }],
        grandTotal: 1,
      },
    });
    assert.equal(res.status, 422, "unknown keys are rejected, not ignored");
  });

  it("requires a variant for a product that has them", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/checkout/order", {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5",
        areaText: "Dhanmondi",
        items: [{ productId: phoneProductId, quantity: 1 }],
      },
    });
    assert.equal(res.status, 422);
  });

  it("refuses to sell more than is in stock", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/checkout/order", {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5",
        areaText: "Dhanmondi",
        items: [{ productId: scarceProductId, quantity: 10 }],
      },
    });
    assert.equal(res.status, 409);
  });

  it("rejects an unrecognised area with no explicit zone", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/checkout/order", {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5",
        areaText: "qqqqqq",
        items: [{ productId: simpleProductId, quantity: 1 }],
      },
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.error?.details?.some((d) => d.field === "body.deliveryZone"));
  });

  it("rejects the same item listed twice", async () => {
    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/checkout/order", {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5",
        areaText: "Dhanmondi",
        items: [
          { productId: simpleProductId, quantity: 1 },
          { productId: simpleProductId, quantity: 2 },
        ],
      },
    });
    assert.equal(res.status, 422);
  });

  it("replays an idempotent retry instead of creating a second order", async () => {
    const key = `test-key-${Date.now()}`;
    const stockBefore = await variantStock(variant256Id);

    const first = await createOrder({}, { "idempotency-key": key });
    const second = await createOrder({}, { "idempotency-key": key });

    assert.equal(first.status, 201);
    assert.equal(second.status, 200, "a replay is not a creation");
    assert.equal(
      second.body.data.order.orderNumber,
      first.body.data.order.orderNumber,
      "the original order is returned",
    );
    assert.equal(
      await variantStock(variant256Id),
      stockBefore - 1,
      "stock is decremented once, not twice",
    );
  });

  it("rolls the whole order back when any line is short", async () => {
    const stockBefore = await variantStock(variant256Id);

    const res = await api<Envelope<never>>(ctx.baseUrl, "/api/v1/checkout/order", {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5",
        areaText: "Dhanmondi",
        items: [
          { productId: phoneProductId, variantId: variant256Id, quantity: 1 },
          { productId: scarceProductId, quantity: 10 },
        ],
      },
    });

    assert.equal(res.status, 409);
    assert.equal(
      await variantStock(variant256Id),
      stockBefore,
      "the satisfiable line was not left decremented",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Security                                                                   */
/* -------------------------------------------------------------------------- */

describe("orders — security", () => {
  it("blocks every admin order route without a token", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/v1/admin/orders"],
      ["GET", "/api/v1/admin/orders/status-counts"],
      ["GET", "/api/v1/admin/orders/GNG-10001"],
      ["GET", "/api/v1/admin/orders/GNG-10001/invoice"],
      ["PATCH", "/api/v1/admin/orders/00000000-0000-4000-8000-000000000000/customer"],
      ["PATCH", "/api/v1/admin/orders/00000000-0000-4000-8000-000000000000/status"],
      ["POST", "/api/v1/admin/orders/00000000-0000-4000-8000-000000000000/cancel"],
      ["PATCH", "/api/v1/admin/orders/00000000-0000-4000-8000-000000000000/notes"],
    ];

    for (const [method, path] of routes) {
      const res = await api(ctx.baseUrl, path, { method, body: method === "GET" ? undefined : {} });
      assert.equal(res.status, 401, `${method} ${path} must require auth`);
    }
  });

  it("exposes no public order lookup", async () => {
    const order = await createOrder();
    const number = order.body.data.order.orderNumber;

    for (const path of [`/api/v1/orders/${number}`, `/api/v1/checkout/order/${number}`]) {
      const res = await api(ctx.baseUrl, path);
      assert.equal(res.status, 404, `${path} must not exist`);
    }
  });

  it("lets a manager work the order queue", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/orders", { accessToken: managerToken });
    assert.equal(res.status, 200);
  });
});

/* -------------------------------------------------------------------------- */
/* Listing, search, filters                                                   */
/* -------------------------------------------------------------------------- */

describe("orders — list, search and filters", () => {
  it("paginates newest first", async () => {
    const res = await api<Envelope<Order[]>>(ctx.baseUrl, "/api/v1/admin/orders?perPage=3", {
      accessToken: adminToken,
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length <= 3);
    assert.ok((res.body.meta?.pagination?.total ?? 0) > 3);

    const dates = res.body.data.map((order) => new Date(order.createdAt ?? 0).getTime());
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  });

  it("caps perPage", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/orders?perPage=100000", {
      accessToken: adminToken,
    });
    assert.equal(res.status, 422);
  });

  it("searches by order number, phone and customer name", async () => {
    const created = await createOrder({ customerName: "Zubayer Ahmed", phone: "01911223344" });
    const number = created.body.data.order.orderNumber;

    const byNumber = await api<Envelope<Order[]>>(
      ctx.baseUrl,
      `/api/v1/admin/orders?q=${number}`,
      { accessToken: adminToken },
    );
    const byPhone = await api<Envelope<Order[]>>(
      ctx.baseUrl,
      "/api/v1/admin/orders?q=01911223344",
      { accessToken: adminToken },
    );
    const byName = await api<Envelope<Order[]>>(ctx.baseUrl, "/api/v1/admin/orders?q=zubayer", {
      accessToken: adminToken,
    });

    assert.equal(byNumber.body.data.length, 1);
    assert.equal(byNumber.body.data[0]?.orderNumber, number);
    assert.ok(byPhone.body.data.length >= 1);
    assert.ok(byName.body.data.some((order) => order.customerName === "Zubayer Ahmed"));
  });

  it("survives LIKE metacharacters in the search term", async () => {
    for (const term of ["100%", "_test", "back\\slash"]) {
      const res = await api(ctx.baseUrl, `/api/v1/admin/orders?q=${encodeURIComponent(term)}`, {
        accessToken: adminToken,
      });
      assert.equal(res.status, 200, `term ${term} should not fail`);
    }
  });

  it("filters by status, zone and payment method", async () => {
    const pending = await api<Envelope<Order[]>>(
      ctx.baseUrl,
      "/api/v1/admin/orders?status=pending",
      { accessToken: adminToken },
    );
    assert.ok(pending.body.data.every((order) => order.status === "pending"));

    const inside = await api<Envelope<Order[]>>(
      ctx.baseUrl,
      "/api/v1/admin/orders?deliveryZone=inside_dhaka",
      { accessToken: adminToken },
    );
    assert.ok(inside.body.data.every((order) => order.deliveryZone === "inside_dhaka"));

    const cod = await api<Envelope<Order[]>>(
      ctx.baseUrl,
      "/api/v1/admin/orders?paymentMethod=cod",
      { accessToken: adminToken },
    );
    assert.ok(cod.body.data.every((order) => order.paymentMethod === "cod"));
  });

  it("filters by date range, including the whole end day", async () => {
    const today = new Date().toISOString().slice(0, 10);

    const res = await api<Envelope<Order[]>>(
      ctx.baseUrl,
      `/api/v1/admin/orders?dateFrom=${today}&dateTo=${today}`,
      { accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    assert.ok(
      res.body.data.length > 0,
      "orders placed today must fall inside a same-day range",
    );
  });

  it("rejects an inverted date range", async () => {
    const res = await api(
      ctx.baseUrl,
      "/api/v1/admin/orders?dateFrom=2026-08-01&dateTo=2026-07-01",
      { accessToken: adminToken },
    );
    assert.equal(res.status, 422);
  });

  it("returns status counts", async () => {
    const res = await api<Envelope<{ counts: Record<string, number> }>>(
      ctx.baseUrl,
      "/api/v1/admin/orders/status-counts",
      { accessToken: adminToken },
    );
    assert.equal(res.status, 200);
    assert.ok((res.body.data.counts.pending ?? 0) > 0);
  });

  it("reads an order by uuid and by order number", async () => {
    const created = await createOrder();
    const number = created.body.data.order.orderNumber;

    const byNumber = await loadOrder(number);
    const byId = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${byNumber.id}`,
      { accessToken: adminToken },
    );

    assert.equal(byId.status, 200);
    assert.equal(byId.body.data.order.orderNumber, number);
  });

  it("404s on an unknown order", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/orders/GNG-999999", {
      accessToken: adminToken,
    });
    assert.equal(res.status, 404);
  });
});

/* -------------------------------------------------------------------------- */
/* Admin order editing                                                        */
/* -------------------------------------------------------------------------- */

describe("orders — editing customer information", () => {
  it("updates name, phone and address, recording one audit entry each", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);
    const before = order.timeline.length;

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: {
          customerName: "Karim Hossain",
          phone: "01812345678",
          address: "Flat 5C, House 66, Road 11",
          note: "Corrected during confirmation call",
          expectedVersion: order.version,
        },
      },
    );

    assert.equal(res.status, 200);
    const updated = res.body.data.order;
    assert.equal(updated.customerName, "Karim Hossain");
    assert.equal(updated.phone, "01812345678");
    assert.equal(updated.address, "Flat 5C, House 66, Road 11");

    assert.equal(updated.timeline.length, before + 3, "one entry per changed field");

    const nameEntry = updated.timeline.find((e) => e.field === "customer.name");
    assert.ok(nameEntry);
    assert.equal(nameEntry.previousValue, "Rahim Uddin");
    assert.equal(nameEntry.newValue, "Karim Hossain");
    assert.equal(nameEntry.actorName, "order-admin@gng.com.bd");
    assert.ok(nameEntry.adminId, "attributed to the acting admin");
    assert.equal(nameEntry.note, "Corrected during confirmation call");
    assert.ok(nameEntry.createdAt);

    const phoneEntry = updated.timeline.find((e) => e.type === "phone_updated");
    assert.equal(phoneEntry?.previousValue, "01712345678");
    assert.equal(phoneEntry?.newValue, "01812345678");
  });

  it("recalculates the delivery charge and grand total when the area changes", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    assert.equal(order.deliveryZone, "inside_dhaka");
    assert.equal(order.deliveryCharge, 80);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { areaText: "Sylhet Sadar", expectedVersion: order.version },
      },
    );

    assert.equal(res.status, 200);
    const updated = res.body.data.order;

    assert.equal(updated.deliveryZone, "outside_dhaka", "zone re-inferred from the new area");
    assert.equal(updated.deliveryCharge, 130);
    assert.equal(updated.grandTotal, updated.subtotal + 130);

    assert.ok(
      updated.timeline.some((e) => e.type === "delivery_charge_updated"),
      "the charge change is audited",
    );
    assert.ok(updated.timeline.some((e) => e.type === "totals_recalculated"));
  });

  it("keeps the old zone when a new area is unrecognisable", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { areaText: "qqqqqqq", expectedVersion: order.version },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.deliveryZone, "inside_dhaka", "not silently guessed");
    assert.equal(res.body.data.order.deliveryCharge, 80);
  });

  it("accepts an explicit zone override", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { deliveryZone: "outside_dhaka", expectedVersion: order.version },
      },
    );

    assert.equal(res.body.data.order.deliveryZone, "outside_dhaka");
    assert.equal(res.body.data.order.deliveryCharge, 130);
  });

  it("validates the phone number on edit", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      { method: "PATCH", accessToken: adminToken, body: { phone: "999" } },
    );
    assert.equal(res.status, 422);
  });

  it("rejects an empty edit and unknown keys", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const empty = await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: {},
    });
    const unknown = await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { email: "x@y.com" },
    });

    assert.equal(empty.status, 422);
    assert.equal(unknown.status, 422);
  });

  it("writes no audit entry when nothing actually differs", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);
    const before = order.timeline.length;

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { customerName: order.customerName, expectedVersion: order.version },
      },
    );

    assert.equal(res.body.data.order.timeline.length, before, "no no-op noise in the log");
  });

  it("rejects a stale version rather than overwriting a concurrent edit", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const first = await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { customerName: "First Writer", expectedVersion: order.version },
    });
    assert.equal(first.status, 200);

    const second = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { customerName: "Second Writer", expectedVersion: order.version },
      },
    );

    assert.equal(second.status, 409, "the stale write is refused");
    const after = await loadOrder(order.orderNumber);
    assert.equal(after.customerName, "First Writer", "the first write survives");
  });
});

describe("orders — editing quantities", () => {
  it("recalculates totals and adjusts stock on an increase", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);
    const item = order.items[0]!;
    const stockBefore = await variantStock(variant256Id);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/items/${item.id}/quantity`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { quantity: 3, expectedVersion: order.version },
      },
    );

    assert.equal(res.status, 200);
    const updated = res.body.data.order;

    assert.equal(updated.items[0]?.quantity, 3);
    assert.equal(updated.subtotal, item.unitPrice * 3);
    assert.equal(updated.grandTotal, updated.subtotal + updated.deliveryCharge);
    assert.equal(updated.totalQuantity, 3);

    assert.equal(await variantStock(variant256Id), stockBefore - 2, "two more units reserved");

    const entry = updated.timeline.find((e) => e.type === "quantity_updated");
    assert.equal(entry?.previousValue, 1);
    assert.equal(entry?.newValue, 3);
  });

  it("returns stock on a decrease", async () => {
    const created = await createOrder({
      items: [{ productId: phoneProductId, variantId: variant256Id, quantity: 3 }],
    });
    const order = await loadOrder(created.body.data.order.orderNumber);
    const item = order.items[0]!;
    const stockBefore = await variantStock(variant256Id);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/items/${item.id}/quantity`,
      { method: "PATCH", accessToken: adminToken, body: { quantity: 1 } },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.subtotal, item.unitPrice);
    assert.equal(await variantStock(variant256Id), stockBefore + 2, "two units returned");
  });

  it("refuses an increase beyond available stock and leaves the order untouched", async () => {
    const number = await createOrderOk({
      items: [{ productId: scarceProductId, quantity: 1 }],
    });
    const order = await loadOrder(number);
    const item = order.items[0]!;

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/items/${item.id}/quantity`,
      { method: "PATCH", accessToken: adminToken, body: { quantity: 10 } },
    );

    assert.equal(res.status, 409);

    const after = await loadOrder(order.orderNumber);
    assert.equal(after.items[0]?.quantity, 1, "quantity unchanged");
  });

  it("rejects zero and negative quantities", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);
    const item = order.items[0]!;

    for (const quantity of [0, -3]) {
      const res = await api(
        ctx.baseUrl,
        `/api/v1/admin/orders/${order.id}/items/${item.id}/quantity`,
        { method: "PATCH", accessToken: adminToken, body: { quantity } },
      );
      assert.equal(res.status, 422);
    }
  });

  it("404s for an item belonging to another order", async () => {
    const a = await createOrder();
    const b = await createOrder();
    const orderA = await loadOrder(a.body.data.order.orderNumber);
    const orderB = await loadOrder(b.body.data.order.orderNumber);

    const res = await api(
      ctx.baseUrl,
      `/api/v1/admin/orders/${orderA.id}/items/${orderB.items[0]!.id}/quantity`,
      { method: "PATCH", accessToken: adminToken, body: { quantity: 2 } },
    );
    assert.equal(res.status, 404);
  });
});

describe("orders — editing variants", () => {
  it("restores the old variant stock and reserves the new one", async () => {
    const created = await createOrder({
      items: [{ productId: phoneProductId, variantId: variant256Id, quantity: 2 }],
    });
    const order = await loadOrder(created.body.data.order.orderNumber);
    const item = order.items[0]!;

    const before256 = await variantStock(variant256Id);
    const before512 = await variantStock(variant512Id);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/items/${item.id}/variant`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { variantId: variant512Id, note: "Customer wanted more storage" },
      },
    );

    assert.equal(res.status, 200);
    const updated = res.body.data.order;

    assert.equal(updated.items[0]?.variantId, variant512Id);
    assert.equal(updated.items[0]?.sku, "TEST-PHONE-512");
    assert.equal(updated.items[0]?.unitPrice, 60000, "price follows the new variant");
    assert.equal(updated.subtotal, 120000);
    assert.equal(updated.grandTotal, 120000 + updated.deliveryCharge);

    assert.equal(await variantStock(variant256Id), before256 + 2, "old variant restored");
    assert.equal(await variantStock(variant512Id), before512 - 2, "new variant reserved");

    const entry = updated.timeline.find((e) => e.type === "variant_updated");
    assert.ok(entry);
    assert.equal((entry.previousValue as { sku: string }).sku, "TEST-PHONE-256");
    assert.equal((entry.newValue as { sku: string }).sku, "TEST-PHONE-512");
    assert.equal(entry.note, "Customer wanted more storage");
  });

  it("refuses a variant from a different product", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/items/${order.items[0]!.id}/variant`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { variantId: "00000000-0000-4000-8000-000000000000" },
      },
    );
    assert.equal(res.status, 422);
  });

  it("keeps the original variant when the new one has no stock", async () => {
    /* Drain the 512GB variant so the swap cannot be satisfied. */
    const drain = await api<Envelope<{ product: { variants: { id: string }[] } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${phoneProductId}/variants/${variant512Id}`,
      { method: "PATCH", accessToken: adminToken, body: { stockQuantity: 0 } },
    );
    assert.equal(drain.status, 200);

    const created = await createOrder({
      items: [{ productId: phoneProductId, variantId: variant256Id, quantity: 1 }],
    });
    const order = await loadOrder(created.body.data.order.orderNumber);
    const before256 = await variantStock(variant256Id);

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/items/${order.items[0]!.id}/variant`,
      { method: "PATCH", accessToken: adminToken, body: { variantId: variant512Id } },
    );

    assert.equal(res.status, 409);
    assert.equal(await variantStock(variant256Id), before256, "original reservation intact");

    const after = await loadOrder(order.orderNumber);
    assert.equal(after.items[0]?.variantId, variant256Id);

    /* Restore stock for the tests that follow. */
    await api(ctx.baseUrl, `/api/v1/admin/products/${phoneProductId}/variants/${variant512Id}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { stockQuantity: 300 },
    });
  });
});

describe("orders — internal notes", () => {
  it("records a note change in the audit log", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/notes`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { internalNotes: "Customer available after 6pm", expectedVersion: order.version },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.internalNotes, "Customer available after 6pm");

    const entry = res.body.data.order.timeline.find((e) => e.type === "note_added");
    assert.ok(entry);
    assert.equal(entry.newValue, "Customer available after 6pm");
    assert.ok(entry.adminId);
  });

  it("allows clearing notes", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/notes`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { internalNotes: "temporary" },
    });

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/notes`,
      { method: "PATCH", accessToken: adminToken, body: { internalNotes: null } },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.internalNotes, null);
  });
});

/* -------------------------------------------------------------------------- */
/* Status lifecycle                                                           */
/* -------------------------------------------------------------------------- */

describe("orders — status lifecycle", () => {
  it("advances through the happy path and records sales on delivery", async () => {
    const created = await createOrder({
      items: [{ productId: simpleProductId, quantity: 2 }],
    });
    const order = await loadOrder(created.body.data.order.orderNumber);

    for (const status of ["confirmed", "processing", "packed", "shipped", "delivered"]) {
      const res = await api<Envelope<{ order: Order }>>(
        ctx.baseUrl,
        `/api/v1/admin/orders/${order.id}/status`,
        { method: "PATCH", accessToken: adminToken, body: { status } },
      );
      assert.equal(res.status, 200, `failed to move to ${status}`);
      assert.equal(res.body.data.order.status, status);
    }

    const final = await loadOrder(order.orderNumber);
    assert.equal(final.allowedTransitions.length, 1);
    assert.equal(final.allowedTransitions[0], "returned");

    /* Delivery is the point at which a COD sale becomes revenue, and the
       Phase 2 metrics seam should now show it. */
    const product = await api<Envelope<{ product: { metrics?: { unitsSold: number } } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${simpleProductId}`,
      { accessToken: adminToken },
    );
    assert.ok(
      (product.body.data.product.metrics?.unitsSold ?? 0) >= 2,
      "delivered units recorded against the product",
    );
  });

  it("refuses an illegal transition and says what is allowed", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/status`,
      { method: "PATCH", accessToken: adminToken, body: { status: "delivered" } },
    );

    assert.equal(res.status, 409);
    assert.match(res.body.error?.message ?? "", /confirmed/);
  });

  it("restores stock when an order is cancelled before shipment", async () => {
    const created = await createOrder({
      items: [{ productId: phoneProductId, variantId: variant256Id, quantity: 2 }],
    });
    const order = await loadOrder(created.body.data.order.orderNumber);
    const stockBefore = await variantStock(variant256Id);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/cancel`,
      {
        method: "POST",
        accessToken: adminToken,
        body: { reason: "Customer did not respond after 3 calls" },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.status, "cancelled");
    assert.equal(
      res.body.data.order.cancellationReason,
      "Customer did not respond after 3 calls",
    );
    assert.equal(await variantStock(variant256Id), stockBefore + 2, "stock returned");

    assert.ok(res.body.data.order.timeline.some((e) => e.type === "order_cancelled"));
  });

  it("requires a cancellation reason", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/cancel`, {
      method: "POST",
      accessToken: adminToken,
      body: {},
    });
    assert.equal(res.status, 422);
  });

  it("cannot cancel a shipped order, and leaves no cancellation reason behind", async () => {
    const created = await createOrder({ items: [{ productId: simpleProductId, quantity: 1 }] });
    const order = await loadOrder(created.body.data.order.orderNumber);

    for (const status of ["confirmed", "processing", "packed", "shipped"]) {
      await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
        method: "PATCH",
        accessToken: adminToken,
        body: { status },
      });
    }

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/cancel`,
      { method: "POST", accessToken: adminToken, body: { reason: "Too late" } },
    );

    assert.equal(res.status, 409);

    const after = await loadOrder(order.orderNumber);
    assert.equal(after.status, "shipped");
    assert.equal(
      after.cancellationReason,
      null,
      "a refused cancellation must not persist its reason",
    );
  });

  it("restores stock and reverses the sale on a return", async () => {
    const created = await createOrder({ items: [{ productId: simpleProductId, quantity: 2 }] });
    const order = await loadOrder(created.body.data.order.orderNumber);

    for (const status of ["confirmed", "processing", "packed", "shipped", "delivered"]) {
      await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
        method: "PATCH",
        accessToken: adminToken,
        body: { status },
      });
    }

    const soldAfterDelivery = await api<
      Envelope<{ product: { metrics?: { unitsSold: number }; stockQuantity: number } }>
    >(ctx.baseUrl, `/api/v1/admin/products/${simpleProductId}`, { accessToken: adminToken });

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/status`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { status: "returned", note: "Refused at the door" },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.order.status, "returned");

    const afterReturn = await api<
      Envelope<{ product: { metrics?: { unitsSold: number }; stockQuantity: number } }>
    >(ctx.baseUrl, `/api/v1/admin/products/${simpleProductId}`, { accessToken: adminToken });

    assert.equal(
      afterReturn.body.data.product.metrics?.unitsSold,
      (soldAfterDelivery.body.data.product.metrics?.unitsSold ?? 0) - 2,
      "the sale is reversed",
    );
    assert.equal(
      afterReturn.body.data.product.stockQuantity,
      soldAfterDelivery.body.data.product.stockQuantity + 2,
      "stock comes back",
    );
  });

  it("blocks edits once an order has shipped", async () => {
    const created = await createOrder({ items: [{ productId: simpleProductId, quantity: 1 }] });
    const order = await loadOrder(created.body.data.order.orderNumber);

    for (const status of ["confirmed", "processing", "packed", "shipped"]) {
      await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
        method: "PATCH",
        accessToken: adminToken,
        body: { status },
      });
    }

    const customer = await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { customerName: "Too Late" },
    });
    const quantity = await api(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/items/${order.items[0]!.id}/quantity`,
      { method: "PATCH", accessToken: adminToken, body: { quantity: 5 } },
    );

    assert.equal(customer.status, 409);
    assert.equal(quantity.status, 409);
  });
});

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

describe("orders — immutable audit log", () => {
  it("exposes the timeline on its own endpoint", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<Envelope<{ timeline: TimelineEntry[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/timeline`,
      { accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    assert.ok(res.body.data.timeline.length >= 1);

    const entry = res.body.data.timeline[0]!;
    for (const key of ["type", "actorName", "createdAt", "previousValue", "newValue"]) {
      assert.ok(key in entry, `audit entry exposes ${key}`);
    }
  });

  it("records every edit in order, and never rewrites an entry", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { customerName: "Edit One" },
    });
    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { customerName: "Edit Two" },
    });

    const timeline = await api<Envelope<{ timeline: TimelineEntry[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/timeline`,
      { accessToken: adminToken },
    );

    const nameEdits = timeline.body.data.timeline.filter((e) => e.field === "customer.name");
    assert.equal(nameEdits.length, 2, "both edits are kept, not collapsed");
    assert.equal(nameEdits[0]?.newValue, "Edit One");
    assert.equal(nameEdits[1]?.previousValue, "Edit One");
    assert.equal(nameEdits[1]?.newValue, "Edit Two");

    const times = timeline.body.data.timeline.map((e) => new Date(e.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b), "chronological");
  });

  it("records the real new value on a recalculation, never null", async () => {
    /* Regression: `recalculateOrderTotals` used a raw `execute()`, which
       returns snake_case driver rows with no type mapping. `row.grandTotal`
       was undefined, so the audit entry logged a null new value while the API
       response — re-read from the database — looked correct. */
    const number = await createOrderOk();
    const order = await loadOrder(number);

    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/customer`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { areaText: "Sylhet Sadar", expectedVersion: order.version },
      },
    );

    const totals = res.body.data.order.timeline.filter(
      (e) => e.type === "totals_recalculated",
    );
    assert.ok(totals.length >= 1);

    for (const entry of totals) {
      assert.notEqual(entry.newValue, null, "the new value must be recorded");
    }

    const grandTotalEntry = totals.find((e) => e.field === "grandTotal")!;
    assert.equal(
      grandTotalEntry.newValue,
      res.body.data.order.grandTotal,
      "the audited total matches the order",
    );
  });

  it("orders entries written in one transaction deterministically", async () => {
    /* Regression: `created_at` defaulted to now(), which is the TRANSACTION
       start time — every event from one edit shared a timestamp and the log
       had no defined order. */
    const number = await createOrderOk();
    const order = await loadOrder(number);

    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { areaText: "Sylhet Sadar" },
    });

    const res = await api<Envelope<{ timeline: TimelineEntry[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/timeline`,
      { accessToken: adminToken },
    );

    const entries = res.body.data.timeline;
    const times = entries.map((e) => new Date(e.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b), "chronological");

    /* Ordering is guaranteed by the monotonic `seq` column rather than by
       clock resolution, so identical timestamps are acceptable — what matters
       is that the returned order is stable and causally correct. */
    const second = await api<Envelope<{ timeline: TimelineEntry[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/timeline`,
      { accessToken: adminToken },
    );
    assert.deepEqual(
      second.body.data.timeline.map((e) => e.id),
      entries.map((e) => e.id),
      "the order is stable across reads",
    );

    /* The cause must precede the effect it triggered. */
    const zoneAt = entries.findIndex((e) => e.field === "customer.deliveryZone");
    const chargeAt = entries.findIndex((e) => e.type === "delivery_charge_updated");
    assert.ok(zoneAt >= 0 && chargeAt >= 0);
    assert.ok(zoneAt < chargeAt, "the zone change is logged before the charge it caused");
  });

  it("offers no endpoint to modify or delete an audit entry", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);
    const entryId = order.timeline[0]!.id;

    for (const [method, path] of [
      ["PATCH", `/api/v1/admin/orders/${order.id}/timeline/${entryId}`],
      ["DELETE", `/api/v1/admin/orders/${order.id}/timeline/${entryId}`],
      ["DELETE", `/api/v1/admin/orders/${order.id}/timeline`],
    ] as [string, string][]) {
      const res = await api(ctx.baseUrl, path, {
        method,
        accessToken: adminToken,
        body: {},
      });
      assert.equal(res.status, 404, `${method} ${path} must not exist`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Invoice                                                                    */
/* -------------------------------------------------------------------------- */

describe("orders — invoice", () => {
  it("returns store details, customer, items and totals", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    const res = await api<
      Envelope<{
        invoice: {
          store: { name: string };
          invoiceNumber: string;
          customer: { name: string; phone: string };
          items: { productName: string }[];
          totals: { subtotal: number; deliveryCharge: number; grandTotal: number };
          order: { paymentMethod: string; paymentStatus: string; amountDue: number };
        };
      }>
    >(ctx.baseUrl, `/api/v1/admin/orders/${order.orderNumber}/invoice`, {
      accessToken: adminToken,
    });

    assert.equal(res.status, 200);
    const invoice = res.body.data.invoice;

    assert.equal(invoice.store.name, "gng Test Store");
    assert.equal(invoice.invoiceNumber, order.orderNumber);
    assert.equal(invoice.customer.name, order.customerName);
    assert.equal(invoice.items.length, order.items.length);
    assert.equal(invoice.totals.grandTotal, order.grandTotal);
    assert.equal(invoice.order.paymentMethod, "cod");
    assert.equal(invoice.order.paymentStatus, "unpaid");
    assert.equal(invoice.order.amountDue, order.grandTotal);
  });

  it("always reflects the latest edited information", async () => {
    const created = await createOrder();
    const order = await loadOrder(created.body.data.order.orderNumber);

    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { customerName: "Updated Recipient", areaText: "Sylhet Sadar" },
    });
    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/items/${order.items[0]!.id}/quantity`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { quantity: 2 },
    });

    const latest = await loadOrder(order.orderNumber);

    const res = await api<
      Envelope<{
        invoice: {
          customer: { name: string; deliveryZone: string };
          items: { quantity: number }[];
          totals: { deliveryCharge: number; grandTotal: number };
        };
      }>
    >(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/invoice`, { accessToken: adminToken });

    const invoice = res.body.data.invoice;
    assert.equal(invoice.customer.name, "Updated Recipient");
    assert.equal(invoice.customer.deliveryZone, "outside_dhaka");
    assert.equal(invoice.items[0]?.quantity, 2);
    assert.equal(invoice.totals.deliveryCharge, 130);
    assert.equal(invoice.totals.grandTotal, latest.grandTotal);
  });

  it("renders printable HTML that escapes customer input", async () => {
    const created = await createOrder({ customerName: "Rahim <script>alert(1)</script>" });
    const order = await loadOrder(created.body.data.order.orderNumber);

    const response = await fetch(
      `${ctx.baseUrl}/api/v1/admin/orders/${order.id}/invoice?format=html`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /INVOICE/);
    assert.ok(html.includes(order.orderNumber));

    assert.ok(!html.includes("<script>alert(1)</script>"), "customer input is escaped");
    assert.ok(html.includes("&lt;script&gt;"), "escaped form is present");
  });

  it("404s for an unknown order", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/orders/GNG-999999/invoice", {
      accessToken: adminToken,
    });
    assert.equal(res.status, 404);
  });
});

/* -------------------------------------------------------------------------- */
/* Event hooks                                                                */
/* -------------------------------------------------------------------------- */

describe("orders — notification event hooks", () => {
  it("emits created, customer_updated and status_changed without any transport", async () => {
    const { orderEvents } = await import("../src/lib/events/order-events.js");

    const seen: string[] = [];
    const off = [
      orderEvents.on("order.created", () => void seen.push("created")),
      orderEvents.on("order.customer_updated", () => void seen.push("customer_updated")),
      orderEvents.on("order.status_changed", () => void seen.push("status_changed")),
    ];

    try {
      const created = await createOrder({ items: [{ productId: simpleProductId, quantity: 1 }] });
      const order = await loadOrder(created.body.data.order.orderNumber);

      await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/customer`, {
        method: "PATCH",
        accessToken: adminToken,
        body: { customerName: "Hook Test" },
      });
      await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
        method: "PATCH",
        accessToken: adminToken,
        body: { status: "confirmed" },
      });

      /* Handlers are invoked asynchronously by design. */
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.ok(seen.includes("created"));
      assert.ok(seen.includes("customer_updated"));
      assert.ok(seen.includes("status_changed"));
    } finally {
      for (const unsubscribe of off) unsubscribe();
    }
  });

  it("contains a failing subscriber rather than failing the request", async () => {
    const { orderEvents } = await import("../src/lib/events/order-events.js");

    const off = orderEvents.on("order.created", () => {
      throw new Error("notification provider is down");
    });

    try {
      const res = await createOrder({ items: [{ productId: simpleProductId, quantity: 1 }] });
      assert.equal(res.status, 201, "a broken transport must not break checkout");
    } finally {
      off();
    }
  });
});
