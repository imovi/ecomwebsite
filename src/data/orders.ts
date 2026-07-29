import type { Order, OrderItem, OrderStatus } from "@/types";
import { products } from "./products";
import { settings } from "./store";

/**
 * Seeded order history.
 *
 * Generated rather than hand-written so the admin dashboard, the customer list
 * and the Trending rail all have believable, *consistent* numbers to work
 * from. A fixed seed means the same data every run — no hydration surprises
 * and no flaky snapshots.
 *
 * Replace `lib/data/orders.ts` with real queries and this file goes away.
 */

/* --- Deterministic PRNG (mulberry32) -------------------------------------- */
function makeRandom(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = makeRandom(20260729);

const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

/* --- Source pools --------------------------------------------------------- */

const FIRST_NAMES = [
  "Rahim", "Karim", "Sadia", "Tanvir", "Nusrat", "Arif", "Mehedi", "Farhana",
  "Sabbir", "Jannat", "Rifat", "Sumaiya", "Imran", "Tasnia", "Shakib",
  "Mim", "Rakib", "Nafisa", "Fahim", "Anika", "Rasel", "Sharmin", "Nayeem",
  "Tuhin", "Priya", "Asif", "Lamia", "Riyad", "Sanjida", "Mahmud",
];

const LAST_NAMES = [
  "Uddin", "Hossain", "Islam", "Ahmed", "Rahman", "Chowdhury", "Akter",
  "Khan", "Sarker", "Mia", "Alam", "Sultana", "Haque", "Bhuiyan", "Talukder",
];

const INSIDE_AREAS = [
  "Dhanmondi, Dhaka", "Mirpur 10, Dhaka", "Uttara Sector 7, Dhaka",
  "Bashundhara R/A, Dhaka", "Mohammadpur, Dhaka", "Banani, Dhaka",
  "Khilgaon, Dhaka", "Jatrabari, Dhaka", "Badda, Dhaka", "Gulshan 2, Dhaka",
  "Rampura, Dhaka", "Shyamoli, Dhaka", "Motijheel, Dhaka", "Mugda, Dhaka",
];

const OUTSIDE_AREAS = [
  "Savar, Dhaka", "Gazipur Chowrasta", "Narayanganj Sadar", "Chattogram, Agrabad",
  "Sylhet Sadar", "Rajshahi Sadar", "Khulna Sadar", "Bogura Sadar",
  "Cumilla Kandirpar", "Mymensingh Sadar", "Rangpur Sadar", "Jashore Sadar",
  "Barishal Sadar", "Tongi, Gazipur", "Keraniganj, Dhaka", "Noakhali Maijdee",
];

const ROADS = [
  "House 12, Road 5", "House 43/A, Road 11", "Flat B4, House 27",
  "House 8, Lane 3", "Holding 214, Ward 6", "House 91, Road 2, Block C",
  "Flat 5C, House 66", "House 3, Road 15, Block D",
];

/**
 * Sale weight per product. Higher = sells more. Roughly mirrors what actually
 * moves in a BD gadget store: accessories and mid-range phones outsell
 * flagships by volume even though flagships dominate revenue.
 */
const WEIGHTS: Record<string, number> = {
  "p-ugreen-100w-cable": 10,
  "p-baseus-gan-65w": 9,
  "p-redragon-k552": 7,
  "p-anker-powerbank-20k": 8,
  "p-soundcore-liberty-4-nc": 8,
  "p-redmi-note-13-pro": 7,
  "p-dualsense-controller": 6,
  "p-logitech-g502-hero": 5,
  "p-jbl-flip-6": 5,
  "p-airpods-pro-2": 5,
  "p-soundcore-motion-300": 4,
  "p-amazfit-gtr-4": 4,
  "p-galaxy-watch-6": 3,
  "p-apple-watch-s9": 3,
  "p-sony-wh1000xm5": 2,
  "p-marshall-emberton-2": 2,
  "p-lenovo-ideapad-slim-3": 2,
  "p-asus-vivobook-15": 2,
  "p-iphone-15-pro-max": 2,
  "p-galaxy-s24-ultra": 2,
  "p-macbook-air-m3": 1,
  "p-dji-osmo-action-4": 1,
  "p-insta360-x3": 1,
  "p-canon-eos-r50": 1,
};

const WEIGHTED_POOL: string[] = Object.entries(WEIGHTS).flatMap(([id, weight]) =>
  Array.from({ length: weight }, () => id),
);

const STATUS_POOL: OrderStatus[] = [
  ...Array<OrderStatus>(58).fill("delivered"),
  ...Array<OrderStatus>(8).fill("shipped"),
  ...Array<OrderStatus>(5).fill("packed"),
  ...Array<OrderStatus>(8).fill("confirmed"),
  ...Array<OrderStatus>(8).fill("pending"),
  ...Array<OrderStatus>(8).fill("cancelled"),
  ...Array<OrderStatus>(5).fill("returned"),
];

/* --- Generation ----------------------------------------------------------- */

/** Captured once at module load so every derived date is stable per process. */
const NOW = Date.now();
const DAY = 86_400_000;

function buildItem(productId: string): OrderItem {
  const product = products.find((p) => p.id === productId)!;
  const variant = product.variants.length ? pick(product.variants) : undefined;
  const price = variant?.price ?? product.price;

  return {
    productId: product.id,
    variantId: variant?.id,
    slug: product.slug,
    titleSnapshot: product.title,
    variantLabel: variant ? Object.values(variant.options).join(" · ") : undefined,
    priceSnapshot: price,
    imageSnapshot: product.images[variant?.imageIndex ?? 0] ?? product.images[0],
    // Cheap accessories get bought in twos and threes, phones do not.
    qty: price < 3000 ? between(1, 3) : 1,
  };
}

function generateOrders(count: number): Order[] {
  const list: Order[] = [];

  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(rand() * 75);
    const createdAt = new Date(
      NOW - daysAgo * DAY - Math.floor(rand() * DAY),
    ).toISOString();

    const inside = rand() < 0.62;
    const items = Array.from({ length: rand() < 0.72 ? 1 : 2 }, () =>
      buildItem(pick(WEIGHTED_POOL)),
    );

    const subtotal = items.reduce((sum, it) => sum + it.priceSnapshot * it.qty, 0);
    const zone = inside ? "inside_dhaka" : "outside_dhaka";
    const baseCharge = inside
      ? settings.deliveryInsideDhaka
      : settings.deliveryOutsideDhaka;
    const deliveryCharge =
      settings.freeDeliveryThreshold > 0 && subtotal >= settings.freeDeliveryThreshold
        ? 0
        : baseCharge;

    // Recent orders can't already be delivered — respect the real lifecycle.
    let status = pick(STATUS_POOL);
    if (daysAgo < 2 && (status === "delivered" || status === "returned")) {
      status = rand() < 0.5 ? "pending" : "confirmed";
    }
    if (daysAgo > 20 && (status === "pending" || status === "confirmed")) {
      status = "delivered";
    }

    const notes: string[] = [];
    if (status !== "pending") notes.push("Confirmed by phone call.");
    if (status === "cancelled") notes.push("Customer did not respond after 3 attempts.");
    if (status === "returned") notes.push("Refused at delivery.");

    list.push({
      id: `ord_${(1000 + i).toString(36)}`,
      orderNumber: `GNG-${10000 + i}`,
      customerName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      phone: `01${between(3, 9)}${between(10000000, 99999999)}`,
      address: pick(ROADS),
      areaText: inside ? pick(INSIDE_AREAS) : pick(OUTSIDE_AREAS),
      zone,
      items,
      subtotal,
      deliveryCharge,
      discount: 0,
      total: subtotal + deliveryCharge,
      paymentMethod: "cod",
      status,
      notes,
      createdAt,
    });
  }

  return list.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Mutable in-memory table. Server actions push new orders here and update
 * statuses, which is exactly the surface a real repository will expose.
 */
export const orders: Order[] = generateOrders(96);

/** Next order number, continuing the seeded sequence. */
let sequence = 10000 + orders.length;
export function nextOrderNumber(): string {
  sequence += 1;
  return `GNG-${sequence}`;
}
