import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  api,
  seedAdminAndLogin,
  startTestServer,
  type TestContext,
} from "./helpers/test-server.js";

/**
 * The dashboard — integration tests.
 *
 * Real HTTP, real Postgres. Every aggregate on this screen is hand-written SQL
 * with `filter`, partial-index predicates, a `union all` and a `having`, none
 * of which the type checker can say anything about. A `group by` that drops a
 * row or a window boundary off by a millisecond compiles perfectly and reports
 * a wrong number on the first screen the shop opens every morning, so the
 * queries are exercised against a real database rather than reasoned about.
 *
 * The other half is the boundary. Revenue, profit and courier cash are withheld
 * from `manager` inside the service — not hidden in the UI — and a test exists
 * purely to fail if any of them start reaching the order desk's browser.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

interface Overview {
  range: { from: string; to: string; bucket: "hour" | "day" };
  money?: {
    current: { delivered: number; deliveredOrders: number; placedOrders: number; placedValue: number };
    previous: { delivered: number; deliveredOrders: number; placedOrders: number; placedValue: number };
    averageOrderValue: number | null;
    profit: { net: number; marginPercent: number | null; costsComplete: boolean } | null;
    courierCash: { provider: string; inParcels: number; recentlyCollected: number }[];
  };
  series: {
    at: string;
    placedValue?: number;
    placedOrders: number;
    deliveredValue?: number;
    deliveredOrders: number;
  }[];
  sources: { source: string | null; orders: number }[];
  funnel: { started: number; completed: number };
  returns: { returned: number; settled: number };
  couriers: { provider: string; delivered: number; returned: number; settled: number }[];
  callList: { abandonedOpen: number; abandonedValue: number };
  parcels: { inTransit: number; needsAttention: number; failing: number };
  stock: { productId: string; name: string; stockQuantity: number; daysLeft: number | null }[];
  returnRisk: { phone: string; name: string; returned: number; settled: number }[];
}

const PASSWORD = "OverviewTest#2026";

let ctx: TestContext;
let adminToken = "";
let managerToken = "";
let categoryId = "";
let productId = "";
/** Stocked at exactly its low-stock threshold, so it is always in the forecast. */
let lowStockProductId = "";

/** The shop's own day, which is what every window on this screen is cut on. */
function shopToday(): string {
  return new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10);
}

function todayRange(): string {
  const day = shopToday();
  return `?dateFrom=${encodeURIComponent(`${day}T00:00:00+06:00`)}&dateTo=${encodeURIComponent(
    `${day}T23:59:59.999+06:00`,
  )}`;
}

async function overview(query = "", token = adminToken): Promise<Overview> {
  const res = await api<Envelope<{ overview: Overview }>>(
    ctx.baseUrl,
    `/api/v1/admin/overview${query}`,
    { accessToken: token },
  );
  assert.equal(res.status, 200, `overview failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.overview;
}

async function createProduct(body: Record<string, unknown>): Promise<string> {
  const res = await api<Envelope<{ product: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/products",
    { method: "POST", accessToken: adminToken, body },
  );
  assert.equal(res.status, 201, `product fixture failed: ${JSON.stringify(res.body)}`);
  return res.body.data.product.id;
}

async function placeOrder(
  phone: string,
  items: Record<string, unknown>[],
): Promise<{ id: string; orderNumber: string }> {
  const res = await api<Envelope<{ order: { orderNumber: string } }>>(
    ctx.baseUrl,
    "/api/v1/checkout/order",
    {
      method: "POST",
      body: {
        customerName: "Rahim Uddin",
        phone,
        address: "House 12, Road 5",
        areaText: "Dhanmondi, Dhaka",
        items,
      },
    },
  );
  assert.equal(res.status, 201, `order failed: ${JSON.stringify(res.body)}`);

  /* Checkout answers with the number a customer is told; the status route is
     keyed by the id, so the order is read back rather than guessed at. */
  const { orderNumber } = res.body.data.order;
  const loaded = await api<Envelope<{ order: { id: string } }>>(
    ctx.baseUrl,
    `/api/v1/admin/orders/${orderNumber}`,
    { accessToken: adminToken },
  );
  assert.equal(loaded.status, 200, `could not load ${orderNumber}`);
  return { id: loaded.body.data.order.id, orderNumber };
}

/** Walks an order through the whole status path, because the API refuses jumps. */
async function advance(orderId: string, target: "delivered" | "returned"): Promise<void> {
  const path = ["confirmed", "processing", "packed", "shipped", "delivered"];
  if (target === "returned") path.push("returned");

  for (const status of path) {
    const res = await api(ctx.baseUrl, `/api/v1/admin/orders/${orderId}/status`, {
      method: "PATCH",
      accessToken: adminToken,
      body: { status },
    });
    assert.equal(res.status, 200, `could not move to ${status}: ${JSON.stringify(res.body)}`);
  }
}

before(async () => {
  ctx = await startTestServer();

  adminToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "overview-admin@gng.com.bd",
    password: PASSWORD,
    role: "admin",
  });
  managerToken = await seedAdminAndLogin(ctx.baseUrl, {
    email: "overview-manager@gng.com.bd",
    password: PASSWORD,
    role: "manager",
  });

  const category = await api<Envelope<{ category: { id: string } }>>(
    ctx.baseUrl,
    "/api/v1/admin/categories",
    { method: "POST", accessToken: adminToken, body: { name: "Gadgets" } },
  );
  categoryId = category.body.data.category.id;

  productId = await createProduct({
    name: "Overview Lamp",
    sku: "OVERVIEW-LAMP",
    categoryId,
    price: 1000,
    costPrice: 600,
    stockQuantity: 500,
    status: "active",
  });

  lowStockProductId = await createProduct({
    name: "Overview Attar",
    sku: "OVERVIEW-ATTAR",
    categoryId,
    price: 450,
    costPrice: 200,
    stockQuantity: 3,
    lowStockThreshold: 5,
    status: "active",
  });
});

after(async () => {
  await ctx.close();
});

describe("Overview — the window", () => {
  it("serves an empty shop without inventing numbers", async () => {
    const data = await overview(todayRange());

    assert.equal(data.money?.current.placedOrders, 0);
    /* Not zero. An average of no orders does not exist, and a ৳0 average order
       value on the dashboard reads as "our orders are worthless". */
    assert.equal(data.money?.averageOrderValue, null);
    assert.deepEqual(data.series, []);
    assert.deepEqual(data.returnRisk, []);
  });

  it("buckets by hour for a single day and by day for a month", async () => {
    const day = await overview(todayRange());
    assert.equal(day.range.bucket, "hour");

    const today = shopToday();
    const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const month = await overview(
      `?dateFrom=${encodeURIComponent(`${monthAgo}T00:00:00+06:00`)}` +
        `&dateTo=${encodeURIComponent(`${today}T23:59:59.999+06:00`)}`,
    );
    assert.equal(month.range.bucket, "day");
  });

  it("refuses a range that ends before it starts", async () => {
    const res = await api<Envelope<unknown>>(
      ctx.baseUrl,
      "/api/v1/admin/overview?dateFrom=2026-08-30T00:00:00%2B06:00&dateTo=2026-08-01T00:00:00%2B06:00",
      { accessToken: adminToken },
    );
    assert.equal(res.status, 400);
  });

  it("refuses a date it cannot parse rather than silently reporting all time", async () => {
    const res = await api<Envelope<unknown>>(
      ctx.baseUrl,
      "/api/v1/admin/overview?dateFrom=last-tuesday",
      { accessToken: adminToken },
    );
    assert.equal(res.status, 400);
  });
});

describe("Overview — what the orders say", () => {
  before(async () => {
    /* One delivered, one still pending, one returned — enough to tell the
       three apart everywhere they are counted separately. */
    const delivered = await placeOrder("01711111111", [{ productId, quantity: 2 }]);
    await advance(delivered.id, "delivered");

    await placeOrder("01722222222", [{ productId, quantity: 1 }]);

    const returned = await placeOrder("01733333333", [{ productId, quantity: 1 }]);
    await advance(returned.id, "returned");
  });

  it("counts placed and delivered without adding them together", async () => {
    const data = await overview(todayRange());

    assert.equal(data.money?.current.placedOrders, 3);
    assert.equal(data.money?.current.deliveredOrders, 1);
    /* 2 × 1000 plus delivery. Placed value includes all three orders, so the
       two must not be equal — that would mean one column was read twice. */
    assert.ok((data.money?.current.delivered ?? 0) > 0);
    assert.notEqual(data.money?.current.delivered, data.money?.current.placedValue);
  });

  it("averages over delivered orders, not placed ones", async () => {
    const data = await overview(todayRange());
    assert.equal(data.money?.averageOrderValue, data.money?.current.delivered);
  });

  it("draws one order into two buckets when it was placed and delivered", async () => {
    const data = await overview(todayRange());

    const placed = data.series.reduce((sum, point) => sum + point.placedOrders, 0);
    const delivered = data.series.reduce((sum, point) => sum + point.deliveredOrders, 0);

    assert.equal(placed, 3);
    assert.equal(delivered, 1);
  });

  it("labels series buckets in Dhaka wall-clock, with no zone suffix", async () => {
    const data = await overview(todayRange());
    assert.ok(data.series.length > 0);

    for (const point of data.series) {
      assert.match(point.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, point.at);
      /* The whole point of the fixed offset: a bucket drawn for a Dhaka day
         must carry that day's date, not the browser's or the server's. */
      assert.equal(point.at.slice(0, 10), shopToday());
    }
  });

  it("reports the return rate over orders that actually finished", async () => {
    const data = await overview(todayRange());
    assert.equal(data.returns.returned, 1);
    assert.equal(data.returns.settled, 2);
  });

  it("takes profit from the profit report rather than a second sum", async () => {
    const data = await overview(todayRange());
    assert.ok(data.money?.profit, "profit should be present for an admin");

    const res = await api<Envelope<{ report: { realised: { netProfit: number } } }>>(
      ctx.baseUrl,
      `/api/v1/admin/reports/profit?from=${shopToday()}&to=${shopToday()}`,
      { accessToken: adminToken },
    );
    assert.equal(res.status, 200);
    assert.equal(data.money?.profit?.net, res.body.data.report.realised.netProfit);
  });

  it("excludes an order from a window it falls outside of", async () => {
    const past = await overview("?dateFrom=2020-01-01T00:00:00%2B06:00&dateTo=2020-01-02T00:00:00%2B06:00");
    assert.equal(past.money?.current.placedOrders, 0);
    assert.equal(past.returns.settled, 0);
  });

  it("keeps the customer who returned twice off the watchlist until the second one", async () => {
    const before = await overview(todayRange());
    assert.deepEqual(before.returnRisk, [], "one return is not yet a pattern");

    const second = await placeOrder("01733333333", [{ productId, quantity: 1 }]);
    await advance(second.id, "returned");

    const after = await overview(todayRange());
    assert.equal(after.returnRisk.length, 1);
    assert.equal(after.returnRisk[0]?.phone, "01733333333");
    assert.equal(after.returnRisk[0]?.returned, 2);
    /* The watchlist is a standing fact about a number, not a fact about the
       chosen range — a customer does not stop being a risk because the picker
       says "yesterday". */
    const past = await overview("?dateFrom=2020-01-01T00:00:00%2B06:00&dateTo=2020-01-02T00:00:00%2B06:00");
    assert.equal(past.returnRisk.length, 1);
  });

  it("says nothing about a courier that was never used", async () => {
    const data = await overview(todayRange());
    assert.deepEqual(data.couriers, []);
    assert.deepEqual(data.money?.courierCash, []);
  });

});

describe("Overview — stock about to run out", () => {
  it("forecasts nothing for a product with no recent sales", async () => {
    const data = await overview(todayRange());
    const attar = data.stock.find((row) => row.productId === lowStockProductId);

    assert.ok(attar, "a product at its low-stock threshold belongs in the forecast");
    assert.equal(attar.stockQuantity, 3);
    /* No sales means no rate, and no rate means no forecast. Not a very large
       number of days, which would read as "plenty of time". */
    assert.equal(attar.daysLeft, null);
  });

  it("leaves a well-stocked product out of the forecast entirely", async () => {
    const data = await overview(todayRange());
    assert.equal(data.stock.some((row) => row.productId === productId), false);
  });

  it("forecasts a stockout date once the product starts selling", async () => {
    const order = await placeOrder("01744444444", [
      { productId: lowStockProductId, quantity: 2 },
    ]);
    await advance(order.id, "delivered");

    const data = await overview(todayRange());
    const attar = data.stock.find((row) => row.productId === lowStockProductId);

    assert.ok(attar);
    assert.equal(attar.stockQuantity, 1);
    /* 2 units over a 14-day window is one unit per week, and one unit is left. */
    assert.equal(attar.daysLeft, 7);
  });
});

describe("Overview — the checkout funnel", () => {
  it("never reports more completions than starts", async () => {
    const data = await overview(todayRange());
    assert.ok(
      data.funnel.started >= data.funnel.completed,
      `started ${data.funnel.started} < completed ${data.funnel.completed}`,
    );
  });

  it("counts a checkout that was abandoned and never finished", async () => {
    const before = await overview(todayRange());

    const res = await api(ctx.baseUrl, "/api/v1/checkout/incomplete", {
      method: "POST",
      body: {
        customerName: "Farhana Yasmin",
        phone: "01755555555",
        items: [{ productId, quantity: 1 }],
      },
    });
    assert.equal(res.status, 204, `abandoned save failed: ${JSON.stringify(res.body)}`);

    const after = await overview(todayRange());
    assert.equal(after.funnel.started, before.funnel.started + 1);
    assert.equal(after.funnel.completed, before.funnel.completed);
    /* The gap between the two IS the abandoned checkout — that is the whole
       number the card exists to report. */
    assert.equal(after.funnel.started - after.funnel.completed, 1);
    assert.equal(after.callList.abandonedOpen, before.callList.abandonedOpen + 1);
    /* The banner's whole purpose is the number beside the count. */
    assert.equal(after.callList.abandonedValue, before.callList.abandonedValue + 1000);
  });
});

describe("Overview — what the order desk may not see", () => {
  it("withholds money from a manager rather than sending it to be hidden", async () => {
    const data = await overview(todayRange(), managerToken);

    assert.equal(data.money, undefined);
    /* Serialised, because the guarantee is about what crosses the wire — a key
       set to undefined would still be a key an object spread could revive. */
    const wire = JSON.stringify(data);
    assert.equal(wire.includes("averageOrderValue"), false);
    assert.equal(wire.includes("courierCash"), false);
    assert.equal(wire.includes("marginPercent"), false);
  });

  it("strips the taka out of the series rather than handing over the addends", async () => {
    const desk = await overview(todayRange(), managerToken);
    assert.ok(desk.series.length > 0, "the desk should still get the shape of the day");

    for (const point of desk.series) {
      assert.equal("placedValue" in point, false);
      assert.equal("deliveredValue" in point, false);
      /* Counts stay: how busy the day was is the desk's own work. */
      assert.equal(typeof point.placedOrders, "number");
    }

    /* And an admin still gets them, or the chart above has nothing to draw. */
    const owner = await overview(todayRange(), adminToken);
    assert.ok(owner.series.some((point) => (point.placedValue ?? 0) > 0));
  });

  it("still gives the manager the work: the call list, parcels and stock", async () => {
    const data = await overview(todayRange(), managerToken);

    assert.ok(Array.isArray(data.stock));
    assert.ok(typeof data.callList.abandonedOpen === "number");
    assert.ok(typeof data.parcels.inTransit === "number");
    assert.ok(Array.isArray(data.series));
  });
});
