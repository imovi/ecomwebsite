/**
 * Seeds a starter catalogue through the public API.
 *
 *   node --env-file-if-exists=.env dist/server.js &
 *   node scripts/seed-catalog.mjs
 *
 * Goes through the HTTP API rather than writing to the database directly, so it
 * exercises exactly the same validation, slug generation and stock handling a
 * merchant would hit in the admin panel. If this script succeeds, the admin
 * panel will too.
 *
 * Idempotent by SKU: re-running skips anything that already exists, so it is
 * safe to run against a store that already has products.
 *
 * These are realistic Bangladeshi gadget-store items with realistic taka
 * pricing — enough to see the homepage, categories, search, variants and
 * checkout working. Replace them with your real catalogue; nothing here is
 * referenced by code.
 */

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:4000";
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@gng.com.bd";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMeLocally123";

let token = "";

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
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(
      `${method} ${path} -> ${response.status}: ${JSON.stringify(parsed?.error ?? parsed)}`,
    );
    error.status = response.status;
    error.code = parsed?.error?.code;
    throw error;
  }
  return parsed.data;
}

/* --- Catalogue ------------------------------------------------------------ */

const CATEGORIES = [
  { name: "Smartphones", icon: "mobile", sortOrder: 1 },
  { name: "Audio", icon: "headphones", sortOrder: 2 },
  { name: "Smartwatches", icon: "watch", sortOrder: 3 },
  { name: "Laptops", icon: "laptop", sortOrder: 4 },
  { name: "Power", icon: "power", sortOrder: 5 },
  { name: "Gaming", icon: "gamepad", sortOrder: 6 },
];

const PRODUCTS = [
  {
    category: "Smartphones",
    name: "Samsung Galaxy S24 Ultra 5G",
    sku: "SAM-S24U",
    brand: "Samsung",
    price: 152000,
    oldPrice: 172000,
    shortDescription: "Titanium flagship with a built-in S Pen and Galaxy AI.",
    description:
      "A titanium-framed flagship with a built-in S Pen and Galaxy AI running on-device. The flat 6.8-inch QHD+ display reaches 2600 nits, and the 200MP main sensor pairs with dual telephoto lenses for 5x optical and 100x Space Zoom.",
    warranty: "1 year official",
    tags: ["5g", "flagship", "s-pen"],
    specifications: [
      { label: "Display", value: '6.8" QHD+ Dynamic AMOLED 2X, 1-120Hz' },
      { label: "Processor", value: "Snapdragon 8 Gen 3 for Galaxy" },
      { label: "Rear camera", value: "200MP + 50MP 5x + 10MP 3x + 12MP Ultra Wide" },
      { label: "Battery", value: "5000mAh, 45W wired charging" },
      { label: "Water resistance", value: "IP68" },
    ],
    whatsIncluded: ["Galaxy S24 Ultra", "S Pen", "USB-C cable", "SIM ejector tool"],
    variantOptions: [{ name: "Storage", values: ["256GB", "512GB"] }],
    variants: [
      { sku: "SAM-S24U-256", options: { Storage: "256GB" }, price: 152000, oldPrice: 172000, stockQuantity: 6 },
      { sku: "SAM-S24U-512", options: { Storage: "512GB" }, price: 166000, oldPrice: 186000, stockQuantity: 3 },
    ],
  },
  {
    category: "Smartphones",
    name: "Xiaomi Redmi Note 13 Pro 5G",
    sku: "XIA-RN13P",
    brand: "Xiaomi",
    price: 32500,
    oldPrice: 37000,
    shortDescription: "200MP OIS camera and 67W charging at a mid-range price.",
    description:
      "The value champion of the mid-range. A 200MP OIS main camera, 1.5K AMOLED display at 120Hz and 67W turbo charging that refills the 5100mAh battery in well under an hour.",
    warranty: "1 year official",
    tags: ["5g", "budget", "amoled"],
    specifications: [
      { label: "Display", value: '6.67" 1.5K AMOLED, 120Hz' },
      { label: "Processor", value: "Snapdragon 7s Gen 2" },
      { label: "Battery", value: "5100mAh, 67W turbo charging" },
    ],
    whatsIncluded: ["Redmi Note 13 Pro", "67W charger", "USB-C cable", "Protective case"],
    variantOptions: [{ name: "Storage", values: ["128GB", "256GB"] }],
    variants: [
      { sku: "XIA-RN13P-128", options: { Storage: "128GB" }, price: 32500, oldPrice: 37000, stockQuantity: 14 },
      { sku: "XIA-RN13P-256", options: { Storage: "256GB" }, price: 36000, oldPrice: 40500, stockQuantity: 9 },
    ],
  },
  {
    category: "Audio",
    name: "Apple AirPods Pro (2nd Gen, USB-C)",
    sku: "APL-APP2",
    brand: "Apple",
    price: 26500,
    oldPrice: 31000,
    shortDescription: "Active Noise Cancellation with Adaptive Audio.",
    description:
      "Up to twice the Active Noise Cancellation of the previous generation, Adaptive Audio that blends transparency and ANC on the fly, and Personalised Spatial Audio. The USB-C case charges with the same cable as your phone.",
    warranty: "1 year",
    tags: ["anc", "wireless", "earbuds"],
    specifications: [
      { label: "Chip", value: "Apple H2" },
      { label: "Battery", value: "6h per charge, 30h total with case" },
      { label: "Resistance", value: "IP54 dust, sweat and water" },
    ],
    whatsIncluded: ["AirPods Pro", "MagSafe Charging Case", "Silicone tips (4 sizes)", "USB-C cable"],
    stockQuantity: 12,
  },
  {
    category: "Audio",
    name: "Anker Soundcore Liberty 4 NC",
    sku: "ANK-L4NC",
    brand: "Anker",
    price: 8900,
    oldPrice: 11500,
    shortDescription: "Adaptive noise cancelling with 50 hours of playtime.",
    description:
      "Adaptive noise cancelling that scans your surroundings 100 times a second, 11mm drivers tuned with LDAC hi-res audio, and 50 hours of total playtime. The best noise cancelling available under ten thousand taka.",
    warranty: "18 months",
    tags: ["anc", "wireless", "earbuds", "ldac"],
    specifications: [
      { label: "Drivers", value: "11mm dynamic" },
      { label: "Codecs", value: "LDAC, AAC, SBC" },
      { label: "Battery", value: "10h buds, 50h with case" },
    ],
    whatsIncluded: ["Liberty 4 NC earbuds", "Charging case", "USB-C cable", "Ear tips"],
    variantOptions: [{ name: "Color", values: ["Black", "White"] }],
    variants: [
      { sku: "ANK-L4NC-BLK", options: { Color: "Black" }, price: 8900, oldPrice: 11500, stockQuantity: 20 },
      { sku: "ANK-L4NC-WHT", options: { Color: "White" }, price: 8900, oldPrice: 11500, stockQuantity: 11 },
    ],
  },
  {
    category: "Smartwatches",
    name: "Amazfit GTR 4 Smart Watch",
    sku: "AMZ-GTR4",
    brand: "Amazfit",
    price: 18500,
    oldPrice: 22000,
    shortDescription: "Fourteen days of battery and dual-band GPS.",
    description:
      "Fourteen days of battery on a single charge, dual-band GPS with a circularly polarised antenna for genuinely accurate route tracking, and over 150 sport modes.",
    warranty: "1 year",
    tags: ["fitness", "gps"],
    specifications: [
      { label: "Display", value: '1.43" AMOLED, 466x466' },
      { label: "Battery", value: "475mAh, up to 14 days" },
      { label: "Resistance", value: "5 ATM" },
    ],
    whatsIncluded: ["Amazfit GTR 4", "Charging dock", "User manual"],
    stockQuantity: 8,
  },
  {
    category: "Laptops",
    name: "Asus Vivobook 15 Core i5 13th Gen",
    sku: "ASU-VB15",
    brand: "Asus",
    price: 82000,
    oldPrice: 92000,
    shortDescription: "13th-gen Core i5 with 16GB RAM and a 512GB NVMe SSD.",
    description:
      "A dependable everyday 15-inch with a 13th-gen Core i5, 16GB of RAM and a fast 512GB NVMe SSD. Backlit keyboard, fingerprint login and a full-size number pad for spreadsheet work.",
    warranty: "2 years",
    tags: ["laptop", "student"],
    specifications: [
      { label: "Processor", value: "Intel Core i5-1335U, 10 cores" },
      { label: "Memory", value: "16GB DDR4 3200MHz" },
      { label: "Storage", value: "512GB PCIe 4.0 NVMe SSD" },
      { label: "Display", value: '15.6" FHD, anti-glare' },
    ],
    whatsIncluded: ["Vivobook 15", "65W adapter", "Warranty card"],
    stockQuantity: 5,
  },
  {
    category: "Power",
    name: "Anker PowerCore 20000mAh 30W PD",
    sku: "ANK-PC20K",
    brand: "Anker",
    price: 5400,
    oldPrice: 6800,
    shortDescription: "20000mAh with 30W USB-C Power Delivery.",
    description:
      "Enough capacity to charge a phone four times over, with 30W USB-C Power Delivery that also tops up a laptop or tablet at full speed. Anker's MultiProtect safety system throughout.",
    warranty: "18 months",
    tags: ["power-bank", "usb-c", "fast-charging"],
    specifications: [
      { label: "Capacity", value: "20000mAh / 72Wh" },
      { label: "Output", value: "USB-C 30W PD, USB-A 18W" },
      { label: "Weight", value: "343g" },
    ],
    whatsIncluded: ["PowerCore 20000", "USB-C cable", "Travel pouch"],
    stockQuantity: 25,
  },
  {
    category: "Power",
    name: "Baseus GaN5 Pro 65W Charger",
    sku: "BAS-GAN5",
    brand: "Baseus",
    price: 2450,
    oldPrice: 3200,
    shortDescription: "Three ports and 65W in a compact GaN body.",
    description:
      "Three ports and 65W of total output in something barely bigger than a stock 20W brick. GaN means it runs cooler and smaller — one charger for a laptop, a phone and earbuds.",
    warranty: "1 year",
    tags: ["charger", "gan", "usb-c"],
    specifications: [
      { label: "Total output", value: "65W" },
      { label: "Ports", value: "2x USB-C + 1x USB-A" },
      { label: "Protocols", value: "PD 3.0, QC 4+, PPS" },
    ],
    whatsIncluded: ["GaN5 Pro charger", "User manual"],
    stockQuantity: 30,
  },
  {
    category: "Gaming",
    name: "Sony DualSense Wireless Controller",
    sku: "SNY-DUALSENSE",
    brand: "Sony",
    price: 8500,
    oldPrice: 10500,
    shortDescription: "Haptic feedback and adaptive triggers.",
    description:
      "Haptic feedback and adaptive triggers that change the feel of every game — you can feel the tension of a bowstring or the grit of a road surface. Works with PS5, PC and mobile.",
    warranty: "1 year",
    tags: ["controller", "ps5"],
    specifications: [
      { label: "Feedback", value: "Haptic feedback, adaptive triggers" },
      { label: "Battery", value: "1560mAh rechargeable" },
      { label: "Compatibility", value: "PS5, PC, Mac, Android, iOS" },
    ],
    whatsIncluded: ["DualSense controller", "USB-C cable"],
    variantOptions: [{ name: "Color", values: ["White", "Midnight Black"] }],
    variants: [
      { sku: "SNY-DS-WHT", options: { Color: "White" }, price: 8500, oldPrice: 10500, stockQuantity: 15 },
      { sku: "SNY-DS-BLK", options: { Color: "Midnight Black" }, price: 8900, oldPrice: 10900, stockQuantity: 7 },
    ],
  },
  {
    category: "Gaming",
    name: "Redragon K552 RGB Mechanical Keyboard",
    sku: "RED-K552",
    brand: "Redragon",
    price: 3400,
    oldPrice: 4400,
    shortDescription: "Compact 87-key mechanical board with real blue switches.",
    description:
      "A compact 87-key tenkeyless board with real mechanical blue switches, a metal top plate that does not flex, and full anti-ghosting. The default recommendation for a first mechanical keyboard.",
    warranty: "1 year",
    tags: ["keyboard", "mechanical", "rgb"],
    specifications: [
      { label: "Layout", value: "87-key tenkeyless" },
      { label: "Switches", value: "Mechanical blue, 50M keystrokes" },
      { label: "Backlight", value: "RGB, multiple modes" },
    ],
    whatsIncluded: ["K552 keyboard", "Keycap puller", "User manual"],
    stockQuantity: 18,
  },
];

/* --- Run ------------------------------------------------------------------ */

console.log(`\nSeeding catalogue at ${BASE}\n`);

const login = await call("/api/v1/auth/login", {
  method: "POST",
  auth: false,
  body: { email: EMAIL, password: PASSWORD },
});
token = login.accessToken;
console.log(`signed in as ${login.admin.email}\n`);

/* Categories, keyed by name so products can look theirs up. */
const categoryIds = new Map();
const existing = await call("/api/v1/admin/categories");
for (const category of existing.categories) categoryIds.set(category.name, category.id);

for (const category of CATEGORIES) {
  if (categoryIds.has(category.name)) {
    console.log(`  = ${category.name} (exists)`);
    continue;
  }
  const created = await call("/api/v1/admin/categories", { method: "POST", body: category });
  categoryIds.set(category.name, created.category.id);
  console.log(`  + ${category.name}`);
}

console.log();

let added = 0;
let skipped = 0;

for (const product of PRODUCTS) {
  const { category, ...rest } = product;
  const categoryId = categoryIds.get(category);

  if (!categoryId) {
    console.log(`  ! ${product.sku} — category "${category}" missing, skipped`);
    continue;
  }

  try {
    await call("/api/v1/admin/products", {
      method: "POST",
      body: { ...rest, categoryId, status: "active", isVisible: true },
    });
    added++;
    console.log(`  + ${product.sku.padEnd(16)} ${product.name}`);
  } catch (error) {
    /* A duplicate SKU means this product is already seeded. Anything else is a
       real failure worth surfacing. */
    if (error.code === "ALREADY_EXISTS") {
      skipped++;
      console.log(`  = ${product.sku.padEnd(16)} (exists)`);
    } else {
      console.error(`  ! ${product.sku}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

console.log(`\n${added} product(s) added, ${skipped} already present.`);
console.log(
  "\nProducts have no images yet — upload them in the admin panel, or the\n" +
    "storefront shows an 'image coming soon' placeholder.\n",
);
