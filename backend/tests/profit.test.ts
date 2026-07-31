import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  seedAdminAndLogin,
  startTestServer,
  type TestContext,
} from "./helpers/test-server.js";

/**
 * Profit and loss — integration tests.
 *
 * The feature's whole value rests on one property: a number the shop looks at
 * next month must still describe what actually happened this month. That is
 * fragile in a way a normal CRUD feature is not — costs change, suppliers raise
 * prices, products get edited — so most of what is asserted here is that
 * history does NOT move when the present does.
 *
 * The second thing under test is the boundary: what the shop pays for stock is
 * commercially sensitive, and it must never reach a customer's browser. Several
 * tests exist purely to fail if a cost field escapes into a public response.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: { field: string; message: string }[] };
  requestId: string;
}

interface OrderItem {
  productName: string;
  unitPrice: number;
  unitCost?: number | null;
  quantity: number;
  lineTotal: number;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  items: OrderItem[];
}

interface ProductProfit {
  productId: string | null;
  productName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  revenueWithUnknownCost: number;
  estimatedAdSpend: number;
  estimatedNetProfit: number;
  marginPercent: number | null;
}

interface ProfitReport {
  range: { from: string; to: string; preset: string | null };
  realised: {
    orderCount: number;
    revenue: number;
    costOfGoods: number;
    grossProfit: number;
    deliveryCharged: number;
    courierPaid: number;
    deliveryMargin: number;
    packaging: number;
    returns: { count: number; cost: number };
    expenses: { total: number; byCategory: Record<string, number> };
    netProfit: number;
    marginPercent: number | null;
  };
  inFlight: { orderCount: number; value: number; expectedGrossProfit: number };
  leaked: { cancelled: number; returned: number; returnCost: number; lostValue: number };
  coverage: {
    linesWithCost: number;
    linesWithoutCost: number;
    revenueWithUnknownCost: number;
    complete: boolean;
  };
  products: ProductProfit[];
}

const PASSWORD = "ProfitAdmin123";

let ctx: TestContext;
let adminToken = "";
let managerToken = "";

let categoryId = "";
/** Bought at 700, sold at 1000 — a clean 300 per unit. */
let costedProductId = "";
/** Deliberately has no cost recorded. */
let uncostedProductId = "";
/** Variants that cost different amounts to buy, not just to sell. */
let phoneProductId = "";
let variant256Id = "";
let variant512Id = "";

async function createProduct(body: Record<string, unknown>): Promise<{
  id: string;
  variants: { id: string; sku: string }[];
}> {
  const res = await api<
    Envelope<{ product: { id: string; variants: { id: string; sku: string }[] } }>
  >(ctx.baseUrl, "/api/v1/admin/products", {
    method: "POST",
    accessToken: adminToken,
    body,
  });

  assert.equal(
    res.status,
    201,
    `product fixture failed (${res.status}): ${JSON.stringify(res.body)}`,
  );
  return res.body.data.product;
}

async function placeOrder(items: Record<string, unknown>[]): Promise<string> {
  const res = await api<Envelope<{ order: { orderNumber: string } }>>(
    ctx.baseUrl,
    "/api/v1/checkout/order",
    {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone: "01712345678",
        address: "House 12, Road 5",
        areaText: "Dhanmondi, Dhaka",
        items,
      },
    },
  );

  assert.equal(res.status, 201, `order failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.order.orderNumber;
}

async function loadOrder(orderNumber: string): Promise<Order> {
  const res = await api<Envelope<{ order: Order }>>(
    ctx.baseUrl,
    `/api/v1/admin/orders/${orderNumber}`,
    { accessToken: adminToken },
  );
  assert.equal(res.status, 200, `could not load ${orderNumber}`);
  return res.body.data.order;
}

before(async () => {
  ctx = await startTestServer();

  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "profit-admin@gng.com.bd",
    password: PASSWORD,
    role: "admin",
  });
  managerToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "profit-manager@gng.com.bd",
    password: PASSWORD,
    role: "manager",
  });

  const category = await api<Envelope<{ category: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/categories",
    { method: "POST", accessToken: adminToken, body: { name: "Accessories" } },
  );
  categoryId = category.body.data.category.id;

  costedProductId = (
    await createProduct({
      name: "Costed Power Bank",
      sku: "PROFIT-BANK",
      categoryId,
      price: 1000,
      costPrice: 700,
      stockQuantity: 500,
      status: "active",
    })
  ).id;

  uncostedProductId = (
    await createProduct({
      name: "Uncosted Cable",
      sku: "PROFIT-CABLE",
      categoryId,
      price: 300,
      stockQuantity: 500,
      status: "active",
    })
  ).id;

  const phone = await createProduct({
    name: "Costed Phone",
    sku: "PROFIT-PHONE",
    categoryId,
    price: 50_000,
    costPrice: 44_000,
    status: "active",
    variantOptions: [{ name: "Storage", values: ["256GB", "512GB"] }],
    variants: [
      /* No cost of its own: falls back to the product's. */
      { sku: "PROFIT-PHONE-256", options: { Storage: "256GB" }, price: 50_000, stockQuantity: 100 },
      /* More storage costs more to buy, not just to sell. */
      {
        sku: "PROFIT-PHONE-512",
        options: { Storage: "512GB" },
        price: 60_000,
        costPrice: 52_000,
        stockQuantity: 100,
      },
    ],
  });
  phoneProductId = phone.id;
  variant256Id = phone.variants.find((v) => v.sku === "PROFIT-PHONE-256")!.id;
  variant512Id = phone.variants.find((v) => v.sku === "PROFIT-PHONE-512")!.id;
});

after(async () => {
  await ctx.close();
});

/**
 * Walks an order to a terminal state through every legal transition.
 *
 * Cancellation is its own endpoint rather than a status change: on a
 * cash-on-delivery shop the reason is the only thing separating a customer who
 * changed their mind from a suspected fake order, so it is required.
 */
async function moveTo(orderNumber: string, target: string): Promise<Order> {
  const order = await loadOrder(orderNumber);

  if (target === "cancelled") {
    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/cancel`,
      {
        method: "POST",
        accessToken: adminToken,
        body: { reason: "Customer changed their mind." },
      },
    );
    assert.equal(res.status, 200, `could not cancel ${orderNumber}: ${JSON.stringify(res.body)}`);
    return loadOrder(orderNumber);
  }

  const path =
    target === "returned"
      ? ["confirmed", "processing", "packed", "shipped", "delivered", "returned"]
      : ["confirmed", "processing", "packed", "shipped", "delivered"];

  for (const status of path) {
    const res = await api<Envelope<{ order: Order }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${order.id}/status`,
      { method: "PATCH", accessToken: adminToken, body: { status } },
    );
    assert.equal(
      res.status,
      200,
      `could not move ${orderNumber} to ${status}: ${JSON.stringify(res.body)}`,
    );
  }

  return loadOrder(orderNumber);
}

async function report(query = ""): Promise<ProfitReport> {
  const res = await api<Envelope<{ report: ProfitReport }>>(
    ctx.baseUrl,
    `/api/v1/admin/reports/profit${query}`,
    { accessToken: adminToken },
  );
  assert.equal(res.status, 200, `report failed: ${JSON.stringify(res.body)}`);
  return res.body.data.report;
}

/* -------------------------------------------------------------------------- */
/* Cost price                                                                 */
/* -------------------------------------------------------------------------- */

describe("cost price — storing it", () => {
  it("saves and returns the buying price to an admin", async () => {
    const res = await api<Envelope<{ product: { costPrice: number | null; price: number } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${costedProductId}`,
      { accessToken: adminToken },
    );

    assert.equal(res.body.data.product.costPrice, 700);
    assert.equal(res.body.data.product.price, 1000);
  });

  it("keeps it null when nobody has recorded one", async () => {
    const res = await api<Envelope<{ product: { costPrice: number | null } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${uncostedProductId}`,
      { accessToken: adminToken },
    );

    /* Not 0. Zero would claim the stock was free and report a 100% margin on
       every product nobody has costed yet. */
    assert.equal(res.body.data.product.costPrice, null);
  });

  it("lets a variant carry its own cost, and inherit when it does not", async () => {
    const res = await api<
      Envelope<{ product: { variants: { sku: string; costPrice?: number | null }[] } }>
    >(ctx.baseUrl, `/api/v1/admin/products/${phoneProductId}`, { accessToken: adminToken });

    const variants = res.body.data.product.variants;
    assert.equal(variants.find((v) => v.sku === "PROFIT-PHONE-512")?.costPrice, 52_000);
    /* The 256 has none of its own — the product's applies at order time. */
    assert.equal(variants.find((v) => v.sku === "PROFIT-PHONE-256")?.costPrice, null);
  });

  it("updates and clears the buying price", async () => {
    const raised = await api<Envelope<{ product: { costPrice: number | null } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${uncostedProductId}`,
      { method: "PATCH", accessToken: adminToken, body: { costPrice: 180 } },
    );
    assert.equal(raised.body.data.product.costPrice, 180);

    const cleared = await api<Envelope<{ product: { costPrice: number | null } }>>(
      ctx.baseUrl,
      `/api/v1/admin/products/${uncostedProductId}`,
      { method: "PATCH", accessToken: adminToken, body: { costPrice: null } },
    );
    /* Explicit null means "back to not recorded", which is not the same as 0. */
    assert.equal(cleared.body.data.product.costPrice, null);
  });

  it("rejects a negative or fractional buying price", async () => {
    for (const costPrice of [-1, 12.5]) {
      const res = await api(ctx.baseUrl, `/api/v1/admin/products/${costedProductId}`, {
        method: "PATCH",
        accessToken: adminToken,
        body: { costPrice },
      });
      assert.equal(res.status, 422, `costPrice ${costPrice} should be rejected`);
    }
  });
});

describe("cost price — who can see it", () => {
  it("never appears on the public product endpoint", async () => {
    const res = await api<Envelope<{ product: Record<string, unknown> }>>(
      ctx.baseUrl,
      "/api/v1/products/costed-power-bank",
    );

    assert.equal(res.status, 200);
    /* A competitor reading this off a public response learns the supplier's
       price and the exact margin. */
    assert.ok(!("costPrice" in res.body.data.product), "cost leaked to the storefront");
    assert.ok(!JSON.stringify(res.body).includes("700"), "cost leaked as a value");
  });

  it("never appears in a public listing", async () => {
    const res = await api<Envelope<Record<string, unknown>[]>>(
      ctx.baseUrl,
      "/api/v1/products?perPage=50",
    );

    assert.equal(res.status, 200);
    assert.ok(res.body.data.length > 0, "the listing has something in it to check");
    assert.ok(res.body.data.every((item) => !("costPrice" in item)));
  });

  it("never appears on the customer's order confirmation", async () => {
    const res = await api<Envelope<{ order: { items: Record<string, unknown>[] } }>>(
      ctx.baseUrl,
      "/api/v1/checkout/order",
      {
        method: "POST",
        body: {
          customerName: "Confirmation Check",
          phone: "01712345679",
          address: "House 1, Road 2, Dhanmondi",
          areaText: "Dhanmondi, Dhaka",
          items: [{ productId: costedProductId, quantity: 1 }],
        },
      },
    );

    assert.equal(res.status, 201);
    /* This payload is rendered in the shopper's browser. */
    assert.ok(res.body.data.order.items.every((item) => !("unitCost" in item)));
  });
});

/* -------------------------------------------------------------------------- */
/* The snapshot                                                               */
/* -------------------------------------------------------------------------- */

describe("cost price — frozen onto the order", () => {
  it("records what the unit cost at the moment of ordering", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 2 }]);
    const order = await loadOrder(orderNumber);

    assert.equal(order.items[0]?.unitCost, 700);
    assert.equal(order.items[0]?.unitPrice, 1000);
    assert.equal(order.items[0]?.lineTotal, 2000);
  });

  it("does not move when the supplier's price changes afterwards", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);

    const raised = await api(ctx.baseUrl, `/api/v1/admin/products/${costedProductId}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { costPrice: 950 },
    });
    assert.equal(raised.status, 200);

    const order = await loadOrder(orderNumber);
    /* THE point of the whole design. Joined to the product's current cost,
       this order's margin would have silently dropped from 300 to 50 — and so
       would every order ever placed for this product. */
    assert.equal(order.items[0]?.unitCost, 700);

    /* And a NEW order picks up the new cost, so the change is not ignored. */
    const afterNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const after = await loadOrder(afterNumber);
    assert.equal(after.items[0]?.unitCost, 950);

    /* Restore, so later suites reason about a 700 cost. */
    await api(ctx.baseUrl, `/api/v1/admin/products/${costedProductId}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { costPrice: 700 },
    });
  });

  it("uses the variant's own cost, and falls back to the product's", async () => {
    const orderNumber = await placeOrder([
      { productId: phoneProductId, variantId: variant512Id, quantity: 1 },
      { productId: phoneProductId, variantId: variant256Id, quantity: 1 },
    ]);

    const order = await loadOrder(orderNumber);
    const big = order.items.find((item) => item.unitPrice === 60_000);
    const small = order.items.find((item) => item.unitPrice === 50_000);

    assert.equal(big?.unitCost, 52_000, "the variant's own cost");
    assert.equal(small?.unitCost, 44_000, "inherited from the product");
  });

  it("records null, not zero, for a product with no cost", async () => {
    const orderNumber = await placeOrder([{ productId: uncostedProductId, quantity: 3 }]);
    const order = await loadOrder(orderNumber);

    /* Zero here would be indistinguishable from "free stock" and would report
       this line as pure profit. Null is reported as unknown instead. */
    assert.equal(order.items[0]?.unitCost, null);
  });

  it("keeps the cost off the printable invoice", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);

    const res = await api<Envelope<{ invoice: { items: Record<string, unknown>[] } }>>(
      ctx.baseUrl,
      `/api/v1/admin/orders/${orderNumber}/invoice`,
      { accessToken: adminToken },
    );

    assert.equal(res.status, 200);
    /* The invoice goes into the box with the parcel. */
    assert.ok(res.body.data.invoice.items.every((item) => !("unitCost" in item)));
  });
});

/* -------------------------------------------------------------------------- */
/* Cost settings                                                              */
/* -------------------------------------------------------------------------- */

describe("what an order costs the shop", () => {
  it("starts at zero so adding the feature changes no existing number", async () => {
    const res = await api<
      Envelope<{
        settings: {
          costs: {
            courierInsideDhaka: number;
            courierOutsideDhaka: number;
            packagingPerOrder: number;
            returnPerOrder: number;
          };
        };
      }>
    >(ctx.baseUrl, "/api/v1/admin/settings", { accessToken: adminToken });

    assert.deepEqual(res.body.data.settings.costs, {
      courierInsideDhaka: 0,
      courierOutsideDhaka: 0,
      packagingPerOrder: 0,
      returnPerOrder: 0,
    });
  });

  it("saves the four figures", async () => {
    const res = await api<
      Envelope<{ settings: { costs: Record<string, number>; delivery: Record<string, number> } }>
    >(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: adminToken,
      body: {
        costs: {
          courierInsideDhaka: 70,
          courierOutsideDhaka: 120,
          packagingPerOrder: 20,
          returnPerOrder: 60,
        },
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.settings.costs.courierInsideDhaka, 70);
    assert.equal(res.body.data.settings.costs.returnPerOrder, 60);

    /* What the courier bills is a different number from what the customer is
       charged — the gap is the point, so the two must not be conflated. */
    assert.notEqual(
      res.body.data.settings.costs.courierInsideDhaka,
      res.body.data.settings.delivery.insideDhaka,
    );
  });

  it("rejects a negative cost", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: adminToken,
      body: { costs: { packagingPerOrder: -5 } },
    });
    assert.equal(res.status, 422);
  });

  it("is not writable by staff", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: managerToken,
      body: { costs: { packagingPerOrder: 999 } },
    });
    assert.equal(res.status, 403);
  });

  it("stays out of the public settings endpoint", async () => {
    const res = await api<Envelope<Record<string, unknown>>>(
      ctx.baseUrl,
      "/api/v1/storefront/settings",
    );

    assert.equal(res.status, 200);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes("courierInside"), "shop costs leaked to the storefront");
    assert.ok(!body.includes("packaging"), "shop costs leaked to the storefront");
  });
});

/* -------------------------------------------------------------------------- */
/* The expense ledger                                                         */
/* -------------------------------------------------------------------------- */

describe("expenses", () => {
  const today = new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10);

  it("records a day's ad spend", async () => {
    const res = await api<Envelope<{ expense: { id: string; amount: number } }>>(
      ctx.baseUrl,
      "/api/v1/admin/expenses",
      {
        method: "POST",
        accessToken: adminToken,
        body: { category: "ads", amount: 2000, incurredOn: today, period: "day" },
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.expense.amount, 2000);
  });

  it("replaces rather than duplicates when the same day is entered again", async () => {
    const date = "2026-03-10";

    await api(ctx.baseUrl, "/api/v1/admin/expenses/ad-spend", {
      method: "PUT",
      accessToken: adminToken,
      body: { date, amount: 1500 },
    });
    const corrected = await api<Envelope<{ expense: { amount: number } | null }>>(
      ctx.baseUrl,
      "/api/v1/admin/expenses/ad-spend",
      { method: "PUT", accessToken: adminToken, body: { date, amount: 1800 } },
    );

    assert.equal(corrected.body.data.expense?.amount, 1800);

    /* "I said 1,500, it was 1,800" must correct the day, not add to it — the
       obvious UI would otherwise silently double the shop's ad cost. */
    const listed = await api<Envelope<{ expenses: { amount: number }[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/expenses?from=${date}&to=${date}&category=ads`,
      { accessToken: adminToken },
    );
    assert.equal(listed.body.data.expenses.length, 1);
  });

  it("treats zero as 'no spend that day' and removes the row", async () => {
    const date = "2026-03-11";

    await api(ctx.baseUrl, "/api/v1/admin/expenses/ad-spend", {
      method: "PUT",
      accessToken: adminToken,
      body: { date, amount: 900 },
    });
    const cleared = await api<Envelope<{ expense: null }>>(
      ctx.baseUrl,
      "/api/v1/admin/expenses/ad-spend",
      { method: "PUT", accessToken: adminToken, body: { date, amount: 0 } },
    );

    assert.equal(cleared.body.data.expense, null);

    const listed = await api<Envelope<{ expenses: unknown[] }>>(
      ctx.baseUrl,
      `/api/v1/admin/expenses?from=${date}&to=${date}`,
      { accessToken: adminToken },
    );
    assert.equal(listed.body.data.expenses.length, 0);
  });

  it("rejects a zero or negative entry, and a date that is not one", async () => {
    for (const body of [
      { category: "ads", amount: 0, incurredOn: today },
      { category: "ads", amount: -100, incurredOn: today },
      { category: "ads", amount: 100, incurredOn: "10/03/2026" },
      { category: "bribes", amount: 100, incurredOn: today },
    ]) {
      const res = await api(ctx.baseUrl, "/api/v1/admin/expenses", {
        method: "POST",
        accessToken: adminToken,
        body,
      });
      assert.equal(res.status, 422, `should reject ${JSON.stringify(body)}`);
    }
  });

  it("edits and deletes an entry", async () => {
    const created = await api<Envelope<{ expense: { id: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/expenses",
      {
        method: "POST",
        accessToken: adminToken,
        body: { category: "other", amount: 500, incurredOn: today, note: "Typo" },
      },
    );
    const id = created.body.data.expense.id;

    const edited = await api<Envelope<{ expense: { amount: number; note: string } }>>(
      ctx.baseUrl,
      `/api/v1/admin/expenses/${id}`,
      { method: "PATCH", accessToken: adminToken, body: { amount: 650, note: "Corrected" } },
    );
    assert.equal(edited.body.data.expense.amount, 650);
    assert.equal(edited.body.data.expense.note, "Corrected");

    const deleted = await api(ctx.baseUrl, `/api/v1/admin/expenses/${id}`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    assert.equal(deleted.status, 204);
  });

  it("is closed to staff", async () => {
    const read = await api(ctx.baseUrl, "/api/v1/admin/expenses", { accessToken: managerToken });
    const write = await api(ctx.baseUrl, "/api/v1/admin/expenses", {
      method: "POST",
      accessToken: managerToken,
      body: { category: "ads", amount: 100, incurredOn: today },
    });

    /* What the shop spends is not the order desk's business, and someone who
       could edit it could change what the owner believes they earned. */
    assert.equal(read.status, 403);
    assert.equal(write.status, 403);
  });
});

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * These run against a database the earlier suites have already written to, so
 * every assertion is a delta: take the report, do the thing, take it again.
 * Absolute figures would encode the whole file's history into one number and
 * break the moment a test above it is added.
 */
describe("profit report — the arithmetic", () => {
  it("counts nothing until an order is actually delivered", async () => {
    const before = await report("?preset=lifetime");

    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 2 }]);
    const placed = await report("?preset=lifetime");

    /* A placed order is a promise, not money. A good share of them are refused
       at the door; counting them as income shows a business that does not
       exist. */
    assert.equal(placed.realised.revenue, before.realised.revenue);
    assert.equal(placed.inFlight.orderCount, before.inFlight.orderCount + 1);

    await moveTo(orderNumber, "delivered");
    const delivered = await report("?preset=lifetime");

    /* 2 × ৳1000 sold, 2 × ৳700 bought. */
    assert.equal(delivered.realised.revenue, before.realised.revenue + 2000);
    assert.equal(delivered.realised.costOfGoods, before.realised.costOfGoods + 1400);
    assert.equal(delivered.realised.grossProfit, before.realised.grossProfit + 600);
    assert.equal(delivered.inFlight.orderCount, before.inFlight.orderCount);
  });

  it("charges courier, packaging and the delivery gap per delivered order", async () => {
    /* Inside Dhaka: the customer is charged the seeded delivery rate, the
       courier bills 70, the box costs 20. */
    const before = await report("?preset=lifetime");

    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    await moveTo(orderNumber, "delivered");

    const after = await report("?preset=lifetime");

    assert.equal(after.realised.courierPaid, before.realised.courierPaid + 70);
    assert.equal(after.realised.packaging, before.realised.packaging + 20);
    assert.ok(after.realised.deliveryCharged >= before.realised.deliveryCharged);

    /* The gap between what the customer pays and what the courier bills is
       invisible everywhere else in the system. */
    assert.equal(
      after.realised.deliveryMargin,
      after.realised.deliveryCharged - after.realised.courierPaid,
    );
  });

  it("reports a cost nobody recorded as unknown, never as free", async () => {
    const before = await report("?preset=lifetime");

    /* Sold for 300, bought for — nobody wrote it down. */
    const orderNumber = await placeOrder([{ productId: uncostedProductId, quantity: 1 }]);
    await moveTo(orderNumber, "delivered");

    const after = await report("?preset=lifetime");

    assert.equal(after.realised.revenue, before.realised.revenue + 300);
    /* The dangerous alternative: treating null as 0 would book ৳300 of pure
       profit here and quietly inflate the margin across the whole report. */
    assert.equal(after.realised.costOfGoods, before.realised.costOfGoods);
    assert.equal(after.realised.grossProfit, before.realised.grossProfit);

    assert.equal(
      after.coverage.revenueWithUnknownCost,
      before.coverage.revenueWithUnknownCost + 300,
    );
    assert.equal(after.coverage.linesWithoutCost, before.coverage.linesWithoutCost + 1);
    assert.equal(after.coverage.complete, false, "the report says so, rather than hiding it");
  });

  it("subtracts expenses, spreading a monthly cost across its days", async () => {
    const range = "?from=2026-04-01&to=2026-04-30";
    const before = await report(range);

    await api(ctx.baseUrl, "/api/v1/admin/expenses", {
      method: "POST",
      accessToken: adminToken,
      body: { category: "ads", amount: 3000, incurredOn: "2026-04-15", period: "day" },
    });
    /* April has 30 days, so 300 a day. */
    await api(ctx.baseUrl, "/api/v1/admin/expenses", {
      method: "POST",
      accessToken: adminToken,
      body: { category: "rent", amount: 9000, incurredOn: "2026-04-01", period: "month" },
    });

    const wholeMonth = await report(range);
    assert.equal(
      wholeMonth.realised.expenses.byCategory.ads,
      (before.realised.expenses.byCategory.ads ?? 0) + 3000,
    );
    assert.equal(wholeMonth.realised.expenses.byCategory.rent, 9000);

    /* Ten days of April carry ten days of rent — not the whole month, and not
       nothing. Otherwise weekly profit swings by the rent depending only on
       whether the range happens to contain the 1st. */
    const tenDays = await report("?from=2026-04-10&to=2026-04-19");
    assert.equal(tenDays.realised.expenses.byCategory.rent, 3000);
    assert.equal(tenDays.realised.expenses.byCategory.ads, 3000, "the 15th is inside this range");

    const otherMonth = await report("?from=2026-05-01&to=2026-05-31");
    assert.equal(otherMonth.realised.expenses.byCategory.rent, undefined);
  });

  it("nets out to gross profit less every other cost", async () => {
    const r = await report("?preset=lifetime");

    const expected =
      r.realised.grossProfit +
      r.realised.deliveryMargin -
      r.realised.packaging -
      r.realised.returns.cost -
      r.realised.expenses.total;

    /* The summary has to reconcile with itself, or nobody will trust it. */
    assert.equal(r.realised.netProfit, expected);
  });

  it("counts a return as a cost and never as revenue", async () => {
    const before = await report("?preset=lifetime");

    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    await moveTo(orderNumber, "returned");

    const after = await report("?preset=lifetime");

    assert.equal(after.leaked.returned, before.leaked.returned + 1);
    /* The seeded return fee. */
    assert.equal(after.realised.returns.cost, before.realised.returns.cost + 60);

    /* And the sale it briefly was has gone from revenue. The order passed
       through `delivered` on its way here, so this also proves the report reads
       the current status rather than everything ever marked delivered. */
    assert.equal(after.realised.revenue, before.realised.revenue);
  });

  it("counts a cancellation as leaked, not as lost revenue", async () => {
    const before = await report("?preset=lifetime");

    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    await moveTo(orderNumber, "cancelled");

    const after = await report("?preset=lifetime");

    assert.equal(after.leaked.cancelled, before.leaked.cancelled + 1);
    assert.ok(after.leaked.lostValue > before.leaked.lostValue);
    assert.equal(after.realised.revenue, before.realised.revenue);
  });
});

describe("profit report — per product", () => {
  it("ranks products and shows the margin on each", async () => {
    const orderNumber = await placeOrder([
      { productId: phoneProductId, variantId: variant512Id, quantity: 1 },
    ]);
    await moveTo(orderNumber, "delivered");

    const r = await report("?preset=lifetime");
    const phone = r.products.find((p) => p.productName === "Costed Phone");

    assert.ok(phone, "the phone appears in the breakdown");
    assert.ok(phone.revenue >= 60_000);
    assert.equal(phone.marginPercent, Math.round((phone.grossProfit / phone.revenue) * 100));

    /* Sorted by what it earns, because "what makes me money" is the question
       being asked of this table. */
    const profits = r.products.map((p) => p.estimatedNetProfit);
    assert.deepEqual(profits, [...profits].sort((a, b) => b - a));
  });

  it("shares ad spend across products by revenue", async () => {
    await api(ctx.baseUrl, "/api/v1/admin/expenses", {
      method: "POST",
      accessToken: adminToken,
      body: { category: "ads", amount: 10_000, incurredOn: "2026-06-15", period: "day" },
    });

    const r = await report("?preset=lifetime");
    const allocated = r.products.reduce((sum, p) => sum + p.estimatedAdSpend, 0);
    const spend = r.realised.expenses.byCategory.ads ?? 0;

    /* Every taka lands on some product, give or take one rounding step each. */
    assert.ok(
      Math.abs(allocated - spend) <= r.products.length,
      `allocated ${allocated} of ${spend}`,
    );

    for (const product of r.products) {
      assert.equal(product.estimatedNetProfit, product.grossProfit - product.estimatedAdSpend);
    }
  });

  it("keeps a product's history under the name it was sold as", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    await moveTo(orderNumber, "delivered");

    await api(ctx.baseUrl, `/api/v1/admin/products/${costedProductId}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { name: "Renamed Power Bank" },
    });

    const r = await report("?preset=lifetime");
    /* The line's snapshotted name, so past sales stay legible after a rename
       and do not silently split into two products. */
    assert.ok(r.products.some((p) => p.productName === "Costed Power Bank"));
  });
});

describe("profit report — ranges and access", () => {
  it("resolves the presets a shop owner actually asks for", async () => {
    for (const preset of ["today", "yesterday", "last7", "last30", "month", "lifetime"]) {
      const r = await report(`?preset=${preset}`);
      assert.equal(r.range.preset, preset);
      assert.ok(r.range.from <= r.range.to, `${preset} produced an inverted range`);
    }

    const week = await report("?preset=last7");
    const today = await report("?preset=today");
    /* Seven days INCLUSIVE of today: to a shop owner "last 7 days" means this
       week so far, not a week that ended yesterday. */
    assert.equal(week.range.to, today.range.to);
  });

  it("accepts a custom range and rejects an inverted one", async () => {
    const ok = await report("?from=2026-04-01&to=2026-04-30");
    assert.equal(ok.range.from, "2026-04-01");
    assert.equal(ok.range.to, "2026-04-30");

    const bad = await api(
      ctx.baseUrl,
      "/api/v1/admin/reports/profit?from=2026-04-30&to=2026-04-01",
      { accessToken: adminToken },
    );
    assert.equal(bad.status, 422);
  });

  it("exports the product table as a spreadsheet", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/admin/reports/profit.csv?preset=lifetime`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename=/);

    const csv = await res.text();
    const [header] = csv.split("\n");
    assert.match(header ?? "", /^Product,Units,Revenue/);
    assert.ok(csv.split("\n").length > 1, "there is at least one product row");
  });

  it("is closed to staff", async () => {
    for (const path of ["/api/v1/admin/reports/profit", "/api/v1/admin/reports/profit.csv"]) {
      const res = await api(ctx.baseUrl, path, { accessToken: managerToken });
      /* Margins, buying prices and ad spend are the shop's most sensitive
         commercial numbers. */
      assert.equal(res.status, 403, path);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Incomplete checkouts                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The feature is a call list, and the two ways it dies are both tested here:
 * ringing the same person repeatedly because typing created five rows, and
 * ringing someone who already ordered. Either one and the shop stops opening
 * the page within a week.
 */
describe("incomplete checkouts", () => {
  interface Lead {
    id: string;
    phone: string;
    customerName: string | null;
    address: string | null;
    itemCount: number;
    estimatedValue: number;
    status: string;
    note: string;
    recovered: boolean;
  }

  async function record(body: Record<string, unknown>) {
    return api(ctx.baseUrl, "/api/v1/checkout/incomplete", { method: "POST", body });
  }

  async function leads(query = ""): Promise<Lead[]> {
    const res = await api<Envelope<{ checkouts: Lead[]; openCount: number }>>(
      ctx.baseUrl,
      `/api/v1/admin/abandoned${query}`,
      { accessToken: adminToken },
    );
    assert.equal(res.status, 200, `could not list: ${JSON.stringify(res.body)}`);
    return res.body.data.checkouts;
  }

  it("records a customer who gave a number and stopped", async () => {
    const res = await record({
      phone: "01798000001",
      customerName: "Half Finished",
      address: "House 3, Road 9, Uttara",
      items: [{ productId: costedProductId, quantity: 2 }],
    });

    /* 204: an anonymous caller learns nothing, not even whether the number was
       already known. */
    assert.equal(res.status, 204);

    const lead = (await leads()).find((l) => l.phone === "01798000001");
    assert.ok(lead, "the lead appears in the call list");
    assert.equal(lead.customerName, "Half Finished");
    assert.equal(lead.itemCount, 2);
    /* Priced from the catalogue, not from the browser — 2 × ৳1000. */
    assert.equal(lead.estimatedValue, 2000);
  });

  it("updates one row as the customer types rather than making more", async () => {
    for (const name of ["Ra", "Rahi", "Rahim Uddin"]) {
      await record({
        phone: "01798000002",
        customerName: name,
        items: [{ productId: costedProductId, quantity: 1 }],
      });
    }

    const matching = (await leads()).filter((l) => l.phone === "01798000002");

    /* The storefront saves on a debounce. A row per keystroke batch would have
       the shop ringing the same person four times. */
    assert.equal(matching.length, 1);
    assert.equal(matching[0]?.customerName, "Rahim Uddin");
  });

  it("treats one number written two ways as one person", async () => {
    await record({ phone: "01798000003", items: [] });
    /* The country code and separators are how the same customer looks after
       switching device or pasting from contacts. */
    await record({ phone: "+880 1798-000003", customerName: "Same Person", items: [] });

    const matching = (await leads()).filter((l) => l.phone.endsWith("798000003"));
    assert.equal(matching.length, 1);
    assert.equal(matching[0]?.customerName, "Same Person");
  });

  it("never wipes a name the shop already has when a field is cleared", async () => {
    await record({ phone: "01798000004", customerName: "Karim", address: "House 7" });
    /* The customer selects their name and deletes it mid-edit. */
    await record({ phone: "01798000004", items: [] });

    const lead = (await leads()).find((l) => l.phone === "01798000004");
    /* Losing the only name you had to greet them by, because they hit
       backspace, would make the call worse for no reason. */
    assert.equal(lead?.customerName, "Karim");
    assert.equal(lead?.address, "House 7");
  });

  it("drops off the list when the order finally arrives", async () => {
    await record({
      phone: "01798000005",
      customerName: "Came Back",
      items: [{ productId: costedProductId, quantity: 1 }],
    });
    assert.ok((await leads()).some((l) => l.phone === "01798000005"));

    const res = await api<Envelope<{ order: { orderNumber: string } }>>(
      ctx.baseUrl,
      "/api/v1/checkout/order",
      {
        method: "POST",
        body: {
          customerName: "Came Back",
          phone: "01798000005",
          address: "House 12, Road 5, Dhanmondi",
          areaText: "Dhanmondi, Dhaka",
          items: [{ productId: costedProductId, quantity: 1 }],
        },
      },
    );
    assert.equal(res.status, 201, `order failed: ${JSON.stringify(res.body)}`);

    /* The whole feature depends on this. Without it the list fills with people
       who already bought, someone rings a paying customer to ask why they did
       not order, and the shop turns the page off. */
    assert.ok(!(await leads()).some((l) => l.phone === "01798000005"));

    const withRecovered = await leads("?includeRecovered=true");
    const closed = withRecovered.find((l) => l.phone === "01798000005");
    assert.equal(closed?.recovered, true, "still visible in history, just not as a task");
  });

  it("lets the same customer be recorded again on a later visit", async () => {
    /* They bought once and abandoned a second basket. That is a fresh
       opportunity, not a duplicate — the partial unique index allows it. */
    await record({
      phone: "01798000005",
      customerName: "Came Back",
      items: [{ productId: costedProductId, quantity: 3 }],
    });

    const open = (await leads()).filter((l) => l.phone === "01798000005");
    assert.equal(open.length, 1);
    assert.equal(open[0]?.itemCount, 3);
  });

  it("records who rang and lets a note be kept", async () => {
    await record({ phone: "01798000006", customerName: "To Call", items: [] });
    const lead = (await leads()).find((l) => l.phone === "01798000006");
    assert.ok(lead);

    const updated = await api<Envelope<{ checkout: Lead }>>(
      ctx.baseUrl,
      `/api/v1/admin/abandoned/${lead.id}`,
      {
        method: "PATCH",
        accessToken: adminToken,
        body: { status: "contacted", note: "Asked to call back after 6pm." },
      },
    );

    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.checkout.status, "contacted");
    assert.equal(updated.body.data.checkout.note, "Asked to call back after 6pm.");
  });

  it("brings a dismissed lead back if the customer returns", async () => {
    await record({ phone: "01798000007", items: [] });
    const lead = (await leads()).find((l) => l.phone === "01798000007");
    assert.ok(lead);

    await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "dismissed" },
    });

    /* They came back to the checkout of their own accord — that is a live lead
       again, whatever was decided last week. */
    await record({ phone: "01798000007", customerName: "Returned", items: [] });

    const again = (await leads()).find((l) => l.phone === "01798000007");
    assert.equal(again?.status, "open");
  });

  it("deletes a lead outright", async () => {
    await record({ phone: "01798000008", items: [] });
    const lead = (await leads()).find((l) => l.phone === "01798000008");
    assert.ok(lead);

    const res = await api(ctx.baseUrl, `/api/v1/admin/abandoned/${lead.id}`, {
      method: "DELETE",
      accessToken: adminToken,
    });
    assert.equal(res.status, 204);
    assert.ok(!(await leads()).some((l) => l.phone === "01798000008"));
  });

  it("rejects a number that is not a Bangladeshi mobile", async () => {
    for (const phone of ["12345", "0171234567", "notaphone"]) {
      const res = await record({ phone, items: [] });
      assert.equal(res.status, 422, `should reject ${phone}`);
    }
  });

  it("is not readable by the public", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/abandoned");
    /* It is a list of customers' names, addresses and phone numbers. */
    assert.equal(res.status, 401);
  });
});

/* -------------------------------------------------------------------------- */
/* Courier hand-off                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Steadfast is faked at the network boundary — the adapter, the guards, the
 * status mapping and the effect on the order are all real code.
 *
 * The guards are most of what is tested here, because each one costs actual
 * money when it slips: a parcel sent twice is two couriers at one door and two
 * delivery charges, and a parcel sent before the confirmation call is the
 * refusal the whole workflow exists to prevent.
 */
describe("courier — sending and tracking", () => {
  interface Shipment {
    id: string;
    provider: string;
    consignmentId: string;
    trackingCode: string;
    status: string;
    courierStatus: string;
    codAmount: number;
    lastError: string;
  }

  const courier = {
    createStatus: 200,
    createBody: {} as unknown,
    statusBody: {} as unknown,
  };

  const outbound: { url: string; body: unknown }[] = [];
  const realFetch = globalThis.fetch;

  function resetCourier(): void {
    outbound.length = 0;
    courier.createStatus = 200;
    courier.createBody = {
      status: 200,
      consignment: {
        consignment_id: 1234567,
        tracking_code: "15BAEB8A",
        cod_amount: 0,
      },
    };
    courier.statusBody = { status: 200, delivery_status: "in_review" };
  }

  before(async () => {
    resetCourier();

    globalThis.fetch = async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (!url.includes("packzy.com")) return realFetch(input, init);

      const raw = typeof init?.body === "string" ? init.body : "";
      outbound.push({ url, body: raw.startsWith("{") ? JSON.parse(raw) : raw });

      const body = url.includes("/create_order")
        ? courier.createBody
        : url.includes("/get_balance")
          ? { status: 200, current_balance: 4200 }
          : courier.statusBody;

      return new Response(JSON.stringify(body), {
        status: url.includes("/create_order") ? courier.createStatus : 200,
        headers: { "content-type": "application/json" },
      });
    };

    /* Configure the courier the way the dashboard would. */
    const saved = await api(ctx.baseUrl, "/api/v1/admin/settings", {
      method: "PATCH",
      accessToken: adminToken,
      body: {
        courier: {
          provider: "steadfast",
          apiKey: "test-api-key-value",
          apiSecret: "test-api-secret-value",
          enabled: true,
        },
      },
    });
    assert.equal(saved.status, 200, `courier config failed: ${JSON.stringify(saved.body)}`);
  });

  after(() => {
    globalThis.fetch = realFetch;
  });

  async function send(orderId: string) {
    return api<Envelope<{ shipment: Shipment }>>(
      ctx.baseUrl,
      `/api/v1/admin/courier/order/${orderId}/send`,
      { method: "POST", accessToken: adminToken, body: {} },
    );
  }

  it("keeps the API key out of every response", async () => {
    const res = await api<Envelope<{ settings: { courier: Record<string, unknown> } }>>(
      ctx.baseUrl,
      "/api/v1/admin/settings",
      { accessToken: adminToken },
    );

    const courierSettings = res.body.data.settings.courier;
    assert.equal(courierSettings.provider, "steadfast");
    assert.equal(courierSettings.hasCredentials, true);
    /* Same rule as every other credential in this system. */
    assert.ok(!JSON.stringify(res.body).includes("test-api-secret-value"));
    assert.ok(!JSON.stringify(res.body).includes("test-api-key-value"));
  });

  it("reports readiness as a checklist", async () => {
    const res = await api<
      Envelope<{ status: { ready: boolean; problem: string | null; provider: string } }>
    >(ctx.baseUrl, "/api/v1/admin/courier/status", { accessToken: adminToken });

    assert.equal(res.body.data.status.ready, true);
    assert.equal(res.body.data.status.problem, null);
    assert.equal(res.body.data.status.provider, "steadfast");
  });

  it("proves the credentials before an order depends on them", async () => {
    const res = await api<Envelope<{ result: { ok: boolean; detail: string } }>>(
      ctx.baseUrl,
      "/api/v1/admin/courier/test",
      { method: "POST", accessToken: adminToken, body: {} },
    );

    assert.equal(res.body.data.result.ok, true);
    assert.match(res.body.data.result.detail, /balance/i);
  });

  it("refuses to send an order nobody has confirmed", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const order = await loadOrder(orderNumber);

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/courier/order/${order.id}/send`,
      { method: "POST", accessToken: adminToken, body: {} },
    );

    /* The confirmation call is what separates a real order from a refusal
       waiting to happen — the largest avoidable cost on cash on delivery. */
    assert.equal(res.status, 400);
    assert.match(res.body.error?.message ?? "", /confirm the order by phone/i);
    assert.equal(
      outbound.filter((call) => call.url.includes("/create_order")).length,
      0,
      "no parcel reached the courier",
    );
  });

  it("hands a confirmed order over and moves it to shipped", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 2 }]);
    const order = await loadOrder(orderNumber);

    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "confirmed" },
    });

    const res = await send(order.id);
    assert.equal(res.status, 200, `send failed: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.data.shipment.consignmentId, "1234567");
    assert.equal(res.body.data.shipment.trackingCode, "15BAEB8A");

    const sent = outbound.find((call) => call.url.includes("/create_order"));
    assert.ok(sent, "the parcel reached the courier");
    const payload = sent.body as Record<string, unknown>;

    /* Their invoice field is our order number — what makes the two panels
       reconcilable by eye. */
    assert.equal(payload.invoice, orderNumber);
    assert.equal(payload.recipient_phone, "01712345678");
    /* The whole amount, because this shop is cash on delivery. */
    assert.equal(payload.cod_amount, 2000 + (await loadOrder(orderNumber)).deliveryCharge);

    const after = await loadOrder(orderNumber);
    assert.equal(after.status, "shipped", "the board reflects that the parcel has gone");
  });

  it("refuses to send the same parcel twice", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const order = await loadOrder(orderNumber);

    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "confirmed" },
    });

    assert.equal((await send(order.id)).status, 200);

    const second = await send(order.id);
    /* Two couriers at one customer's door, and two delivery charges billed. */
    assert.equal(second.status, 409);
    assert.match(second.body.error?.message ?? "", /already with steadfast/i);
  });

  it("reports the courier's own refusal in words the operator can act on", async () => {
    courier.createBody = { status: 400, message: "Recipient phone is invalid." };

    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const order = await loadOrder(orderNumber);
    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "confirmed" },
    });

    const res = await api<Envelope<never>>(
      ctx.baseUrl,
      `/api/v1/admin/courier/order/${order.id}/send`,
      { method: "POST", accessToken: adminToken, body: {} },
    );

    /* Steadfast answers HTTP 200 with an error inside. Trusting the status code
       alone would mark this order shipped with no parcel behind it. */
    assert.equal(res.status, 400);
    assert.match(res.body.error?.message ?? "", /Recipient phone is invalid/);

    const after = await loadOrder(orderNumber);
    assert.equal(after.status, "confirmed", "the order did not move");

    resetCourier();
  });

  it("marks the order delivered when the courier says so", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const order = await loadOrder(orderNumber);
    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "confirmed" },
    });

    const shipment = (await send(order.id)).body.data.shipment;

    courier.statusBody = { status: 200, delivery_status: "delivered" };

    const synced = await api<Envelope<{ shipment: Shipment }>>(
      ctx.baseUrl,
      `/api/v1/admin/courier/shipment/${shipment.id}/sync`,
      { method: "POST", accessToken: adminToken, body: {} },
    );

    assert.equal(synced.body.data.shipment.status, "delivered");
    assert.equal(synced.body.data.shipment.courierStatus, "delivered");

    /* THE point of the whole integration: the profit report counts revenue
       from delivered_at, and this used to depend on somebody remembering. */
    const after = await loadOrder(orderNumber);
    assert.equal(after.status, "delivered");

    resetCourier();
  });

  it("never walks an order backwards from a decision already recorded", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const order = await loadOrder(orderNumber);
    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "confirmed" },
    });
    const shipment = (await send(order.id)).body.data.shipment;

    /* The parcel comes back. */
    courier.statusBody = { status: 200, delivery_status: "return_pending" };
    await api(ctx.baseUrl, `/api/v1/admin/courier/shipment/${shipment.id}/sync`, {
      method: "POST",
      accessToken: adminToken,
      body: {},
    });
    assert.equal((await loadOrder(orderNumber)).status, "returned");

    /* Their board is a day behind and starts reporting movement again. */
    courier.statusBody = { status: 200, delivery_status: "in_transit" };
    await api(ctx.baseUrl, `/api/v1/admin/courier/shipment/${shipment.id}/sync`, {
      method: "POST",
      accessToken: adminToken,
      body: {},
    });

    /* Returned is terminal and it cost the shop a return fee. A courier's
       stale scan must not undo it. */
    assert.equal((await loadOrder(orderNumber)).status, "returned");

    resetCourier();
  });

  it("records a sync failure instead of throwing it away", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const order = await loadOrder(orderNumber);
    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "confirmed" },
    });
    const shipment = (await send(order.id)).body.data.shipment;

    courier.statusBody = { status: 500, message: "Service unavailable" };

    const synced = await api<Envelope<{ shipment: Shipment }>>(
      ctx.baseUrl,
      `/api/v1/admin/courier/shipment/${shipment.id}/sync`,
      { method: "POST", accessToken: adminToken, body: {} },
    );

    /* Visible in the panel rather than only in the logs — a broken sync nobody
       can see is a broken sync nobody fixes. */
    assert.equal(synced.status, 200);
    assert.match(synced.body.data.shipment.lastError, /Service unavailable/);

    resetCourier();
  });

  it("shows the customer a plain status, and none of the courier's internals", async () => {
    const orderNumber = await placeOrder([{ productId: costedProductId, quantity: 1 }]);
    const order = await loadOrder(orderNumber);
    await api(ctx.baseUrl, `/api/v1/admin/orders/${order.id}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status: "confirmed" },
    });
    const shipment = (await send(order.id)).body.data.shipment;

    courier.statusBody = { status: 200, delivery_status: "partial_delivered_return_pending" };
    await api(ctx.baseUrl, `/api/v1/admin/courier/shipment/${shipment.id}/sync`, {
      method: "POST",
      accessToken: adminToken,
      body: {},
    });

    const tracked = await api<
      Envelope<{ order: { courier?: { status: string; trackingCode: string | null } } }>
    >(ctx.baseUrl, "/api/v1/storefront/track-order", {
      method: "POST",
      body: { orderNumber, phone: "01712345678" },
    });

    assert.equal(tracked.status, 200);
    const shown = tracked.body.data.order.courier;
    assert.ok(shown, "the customer can see where the parcel is");
    assert.equal(shown.trackingCode, "15BAEB8A");

    /* No shopper should have to decode `partial_delivered_return_pending`. */
    assert.ok(!JSON.stringify(tracked.body).includes("partial_delivered_return_pending"));
    /* The consignment id is an identifier in someone else's system. */
    assert.ok(!JSON.stringify(tracked.body).includes("1234567"));

    resetCourier();
  });

  it("is closed to the public", async () => {
    const res = await api(ctx.baseUrl, "/api/v1/admin/courier/status");
    assert.equal(res.status, 401);
  });
});

describe("courier — reading a courier's wording", () => {
  /* Couriers change these strings without notice and mix wordings between
     providers, so the mapping is generous with synonyms and refuses to guess
     when it does not recognise something. */
  it("maps the states that matter", async () => {
    const { mapStatus } = await import("../src/modules/courier/provider.js");

    assert.equal(mapStatus("delivered"), "delivered");
    assert.equal(mapStatus("Delivered"), "delivered");
    assert.equal(mapStatus("partial_delivered"), "delivered");
    assert.equal(mapStatus("delivery_failed"), "returned");
    assert.equal(mapStatus("return_pending"), "returned");
    assert.equal(mapStatus("cancelled"), "cancelled");
    assert.equal(mapStatus("out_for_delivery"), "out_for_delivery");
    assert.equal(mapStatus("On the way"), "out_for_delivery");
    assert.equal(mapStatus("in_transit"), "in_transit");
    assert.equal(mapStatus("hold"), "in_transit");
    assert.equal(mapStatus("Pickup done"), "picked_up");
    assert.equal(mapStatus("in_review"), "pending");
  });

  it("refuses to guess at something it has never seen", async () => {
    const { mapStatus } = await import("../src/modules/courier/provider.js");

    /* `unknown` shows as "check with the courier". Guessing `delivered` here
       would book revenue for a parcel nobody has received. */
    assert.equal(mapStatus("moon_phase_three"), "unknown");
    assert.equal(mapStatus(""), "unknown");
  });
});
