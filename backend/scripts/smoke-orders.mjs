/**
 * End-to-end smoke test against a RUNNING server.
 *
 *   node --env-file-if-exists=.env dist/server.js &
 *   node scripts/smoke-orders.mjs
 *
 * Exercises the order flow over real HTTP against the compiled build: place an
 * order as a guest, edit it as an admin, and check that the audit log, totals
 * and stock all moved correctly. The integration suite covers far more; this
 * exists to prove the *built and deployed* artefact behaves, not just the
 * TypeScript sources under the test runner.
 */

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:4000";
const EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@gng.com.bd";
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMeLocally123";

let token = "";
let failures = 0;

async function call(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth && token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }

  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed.data;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

const unique = Date.now().toString(36).toUpperCase();

console.log(`\nSmoke test against ${BASE}\n`);

/* --- Sign in ------------------------------------------------------------- */
const login = await call("/api/v1/auth/login", {
  method: "POST",
  auth: false,
  body: { email: EMAIL, password: PASSWORD },
});
token = login.accessToken;
console.log(`signed in as ${login.admin.email} (${login.admin.role})\n`);

/* --- Catalogue fixtures --------------------------------------------------- */
const { category } = await call("/api/v1/admin/categories", {
  method: "POST",
  body: { name: `Smoke Category ${unique}` },
});

const { product } = await call("/api/v1/admin/products", {
  method: "POST",
  body: {
    name: `Smoke Phone ${unique}`,
    sku: `SMOKE-${unique}`,
    brand: "Testco",
    categoryId: category.id,
    price: 50000,
    status: "active",
    variantOptions: [{ name: "Storage", values: ["256GB", "512GB"] }],
    variants: [
      { sku: `SMOKE-${unique}-256`, options: { Storage: "256GB" }, price: 50000, stockQuantity: 10 },
      { sku: `SMOKE-${unique}-512`, options: { Storage: "512GB" }, price: 60000, stockQuantity: 10 },
    ],
  },
});

const v256 = product.variants.find((v) => v.sku.endsWith("-256"));
const v512 = product.variants.find((v) => v.sku.endsWith("-512"));

/* --- Guest checkout ------------------------------------------------------- */
console.log("checkout");

const quote = await call("/api/v1/checkout/quote", {
  method: "POST",
  auth: false,
  body: {
    items: [{ productId: product.id, variantId: v256.id, quantity: 2 }],
    areaText: "Savar, Dhaka",
  },
});
check("Savar bills at the outside-Dhaka rate", quote.deliveryCharge, 130);
check("zone inferred", quote.deliveryZone, "outside_dhaka");

const placed = await call("/api/v1/checkout/order", {
  method: "POST",
  auth: false,
  body: {
    customerName: "Rahim Uddin",
    phone: "+8801712345678",
    address: "House 12, Road 5, Block C",
    areaText: "Dhanmondi",
    items: [{ productId: product.id, variantId: v256.id, quantity: 2 }],
  },
});

check("phone normalised", placed.order.phone, "01712345678");
check("zone inferred as inside Dhaka", placed.order.deliveryZone, "inside_dhaka");
check("subtotal", placed.order.subtotal, 100000);
check("delivery charge", placed.order.deliveryCharge, 80);
check("grand total", placed.order.grandTotal, 100080);
check("status", placed.order.status, "pending");

const orderNumber = placed.order.orderNumber;
const { order: loaded } = await call(`/api/v1/admin/orders/${orderNumber}`);
const orderId = loaded.id;
const itemId = loaded.items[0].id;

/* --- Admin edits ---------------------------------------------------------- */
console.log("\nadmin edits");

const afterArea = await call(`/api/v1/admin/orders/${orderId}/customer`, {
  method: "PATCH",
  body: { areaText: "Sylhet Sadar", note: "Address corrected on the confirmation call" },
});
check("zone recalculated", afterArea.order.deliveryZone, "outside_dhaka");
check("delivery charge recalculated", afterArea.order.deliveryCharge, 130);
check("grand total recalculated", afterArea.order.grandTotal, 100130);

const afterVariant = await call(`/api/v1/admin/orders/${orderId}/items/${itemId}/variant`, {
  method: "PATCH",
  body: { variantId: v512.id },
});
check("unit price follows the new variant", afterVariant.order.items[0].unitPrice, 60000);
check("subtotal recalculated", afterVariant.order.subtotal, 120000);

const afterQty = await call(`/api/v1/admin/orders/${orderId}/items/${itemId}/quantity`, {
  method: "PATCH",
  body: { quantity: 1 },
});
check("subtotal after quantity change", afterQty.order.subtotal, 60000);
check("grand total after quantity change", afterQty.order.grandTotal, 60130);

/* --- Stock ---------------------------------------------------------------- */
const { product: refreshed } = await call(`/api/v1/admin/products/${product.id}`);
const stock256 = refreshed.variants.find((v) => v.id === v256.id).stockQuantity;
const stock512 = refreshed.variants.find((v) => v.id === v512.id).stockQuantity;
check("256GB stock fully restored after the swap", stock256, 10);
check("512GB stock holds exactly the current quantity", stock512, 9);

/* --- Audit log ------------------------------------------------------------ */
console.log("\naudit log");

const { timeline } = await call(`/api/v1/admin/orders/${orderId}/timeline`);
timeline.forEach((entry, index) => {
  console.log(
    `  ${String(index + 1).padStart(2)}  ${entry.type.padEnd(24)} ${(entry.field ?? "-").padEnd(24)}` +
      ` ${JSON.stringify(entry.previousValue)} -> ${JSON.stringify(entry.newValue)}  [${entry.actorName}]`,
  );
});

const nullNewValues = timeline.filter(
  (entry) => entry.type === "totals_recalculated" && entry.newValue === null,
);
check("no recalculation logged a null new value", nullNewValues.length, 0);

const zoneAt = timeline.findIndex((e) => e.field === "customer.deliveryZone");
const chargeAt = timeline.findIndex((e) => e.type === "delivery_charge_updated");
check("zone change precedes the charge it caused", zoneAt < chargeAt, true);

/* --- Invoice -------------------------------------------------------------- */
console.log("\ninvoice");

const { invoice } = await call(`/api/v1/admin/orders/${orderId}/invoice`);
check("invoice reflects the edited quantity", invoice.items[0].quantity, 1);
check("invoice reflects the edited zone", invoice.customer.deliveryZone, "outside_dhaka");
check("invoice total matches the order", invoice.totals.grandTotal, 60130);
check("amount due is unpaid on COD", invoice.order.paymentStatus, "unpaid");

const htmlResponse = await fetch(`${BASE}/api/v1/admin/orders/${orderId}/invoice?format=html`, {
  headers: { authorization: `Bearer ${token}` },
});
const html = await htmlResponse.text();
check("printable HTML renders", html.includes("INVOICE") && html.includes(orderNumber), true);

/* --- Security ------------------------------------------------------------- */
console.log("\nsecurity");

const unauth = await fetch(`${BASE}/api/v1/admin/orders`);
check("admin list rejects an anonymous caller", unauth.status, 401);

const lookup = await fetch(`${BASE}/api/v1/orders/${orderNumber}`);
check("no public order lookup exists", lookup.status, 404);

/* --- Result --------------------------------------------------------------- */
console.log(
  failures === 0
    ? `\nAll smoke checks passed (order ${orderNumber}).\n`
    : `\n${failures} smoke check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
