import "server-only";

import { nextOrderNumber, orders } from "@/data/orders";
import { coupons, settings } from "@/data/store";
import { products } from "@/data/products";
import { computeTotals } from "@/lib/pricing";
import { normalizePhone } from "@/lib/utils";
import type {
  Coupon,
  Customer,
  DeliveryZone,
  Order,
  OrderItem,
  OrderStatus,
  StoreSettings,
} from "@/types";

/* -------------------------------------------------------------------------- */
/* Settings & coupons                                                         */
/* -------------------------------------------------------------------------- */

export async function getSettings(): Promise<StoreSettings> {
  return settings;
}

export async function getCoupons(): Promise<Coupon[]> {
  return [...coupons];
}

export async function findCoupon(code: string): Promise<Coupon | undefined> {
  return coupons.find((c) => c.code.toLowerCase() === code.trim().toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listOrders(filter?: {
  status?: OrderStatus | "all";
  query?: string;
}): Promise<Order[]> {
  let list = [...orders];

  if (filter?.status && filter.status !== "all") {
    list = list.filter((o) => o.status === filter.status);
  }

  if (filter?.query) {
    const q = filter.query.trim().toLowerCase();
    list = list.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.phone.includes(q) ||
        o.customerName.toLowerCase().includes(q),
    );
  }

  return list;
}

export async function getOrderById(id: string): Promise<Order | null> {
  return orders.find((o) => o.id === id) ?? null;
}

/**
 * Customer-facing lookup. Requires BOTH order number and phone — the order
 * number alone is guessable (it's sequential), and order records contain a
 * full delivery address.
 */
export async function findOrderForCustomer(
  orderNumber: string,
  phone: string,
): Promise<Order | null> {
  const num = orderNumber.trim().toUpperCase();
  const tel = normalizePhone(phone);
  return (
    orders.find(
      (o) => o.orderNumber.toUpperCase() === num && normalizePhone(o.phone) === tel,
    ) ?? null
  );
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface PlaceOrderInput {
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  zone: DeliveryZone;
  couponCode?: string;
  lines: { productId: string; variantId?: string; qty: number }[];
}

export type PlaceOrderResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

/**
 * Creates an order.
 *
 * Prices, stock and totals are all re-resolved from the catalog here — never
 * trusted from the client. A cart that has been sitting in localStorage for a
 * week must not be able to buy at last week's price.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  if (!input.lines.length) return { ok: false, error: "Your cart is empty." };

  const items: OrderItem[] = [];

  for (const line of input.lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product || product.status !== "active") {
      return { ok: false, error: "One of the products is no longer available." };
    }

    const variant = line.variantId
      ? product.variants.find((v) => v.id === line.variantId)
      : undefined;

    if (product.variants.length && !variant) {
      return { ok: false, error: `Please choose an option for ${product.title}.` };
    }

    // Re-check stock at placement time. The product page's view of stock is
    // always stale by the time an order actually arrives.
    const available = variant ? variant.stock : 99;
    if (available <= 0) {
      return { ok: false, error: `${product.title} just went out of stock.` };
    }
    const qty = Math.min(line.qty, available);

    items.push({
      productId: product.id,
      variantId: variant?.id,
      slug: product.slug,
      titleSnapshot: product.title,
      variantLabel: variant ? Object.values(variant.options).join(" · ") : undefined,
      priceSnapshot: variant?.price ?? product.price,
      imageSnapshot: product.images[variant?.imageIndex ?? 0] ?? product.images[0],
      qty,
    });
  }

  const coupon = input.couponCode ? await findCoupon(input.couponCode) : undefined;

  const totals = computeTotals({
    lines: items.map((i) => ({ unitPrice: i.priceSnapshot, qty: i.qty })),
    zone: input.zone,
    coupon,
    settings,
  });

  const order: Order = {
    id: `ord_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    orderNumber: nextOrderNumber(),
    customerName: input.customerName.trim(),
    phone: normalizePhone(input.phone),
    address: input.address.trim(),
    areaText: input.areaText.trim(),
    zone: input.zone,
    items,
    subtotal: totals.subtotal,
    deliveryCharge: totals.deliveryCharge,
    discount: totals.discount,
    couponCode: totals.discount > 0 ? coupon?.code : undefined,
    total: totals.total,
    paymentMethod: "cod",
    status: "pending",
    notes: [],
    createdAt: new Date().toISOString(),
  };

  // Reserve stock immediately, released again if the order is cancelled.
  for (const item of items) {
    if (!item.variantId) continue;
    const product = products.find((p) => p.id === item.productId);
    const variant = product?.variants.find((v) => v.id === item.variantId);
    if (variant) variant.stock -= item.qty;
  }

  if (coupon && totals.discount > 0) coupon.usedCount += 1;

  orders.unshift(order);
  return { ok: true, order };
}

/** Valid forward transitions. Prevents the admin UI from producing nonsense
 *  like a delivered order going back to pending. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: [],
  cancelled: [],
  returned: [],
};

export function allowedTransitions(status: OrderStatus): OrderStatus[] {
  return TRANSITIONS[status];
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const order = orders.find((o) => o.id === id);
  if (!order) return { ok: false, error: "Order not found." };

  if (!TRANSITIONS[order.status].includes(status)) {
    return {
      ok: false,
      error: `Cannot move an order from ${order.status} to ${status}.`,
    };
  }

  // Cancelling or returning puts the reserved units back on the shelf.
  if (status === "cancelled" || status === "returned") {
    for (const item of order.items) {
      if (!item.variantId) continue;
      const product = products.find((p) => p.id === item.productId);
      const variant = product?.variants.find((v) => v.id === item.variantId);
      if (variant) variant.stock += item.qty;
    }
  }

  order.status = status;
  if (note) order.notes.push(note);
  return { ok: true };
}

export async function addOrderNote(id: string, note: string): Promise<void> {
  const order = orders.find((o) => o.id === id);
  if (order && note.trim()) order.notes.push(note.trim());
}

/* -------------------------------------------------------------------------- */
/* Derived views                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Customers are derived from orders keyed by phone — there are no accounts.
 * `returnedCount` is the field that matters operationally: it's how the team
 * spots a repeat refuser before dispatching another COD parcel.
 */
export async function getCustomers(): Promise<Customer[]> {
  const map = new Map<string, Customer>();

  for (const order of orders) {
    const phone = normalizePhone(order.phone);
    const existing = map.get(phone);
    const revenue = order.status === "delivered" ? order.total : 0;

    if (existing) {
      existing.ordersCount += 1;
      existing.deliveredCount += order.status === "delivered" ? 1 : 0;
      existing.returnedCount += order.status === "returned" ? 1 : 0;
      existing.totalSpent += revenue;
      if (order.createdAt > existing.lastOrderAt) {
        existing.lastOrderAt = order.createdAt;
        existing.name = order.customerName;
      }
    } else {
      map.set(phone, {
        phone,
        name: order.customerName,
        ordersCount: 1,
        deliveredCount: order.status === "delivered" ? 1 : 0,
        returnedCount: order.status === "returned" ? 1 : 0,
        totalSpent: revenue,
        lastOrderAt: order.createdAt,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
}

export interface DashboardStats {
  revenue30d: number;
  orders30d: number;
  pendingCount: number;
  deliveredRate: number;
  returnRate: number;
  averageOrderValue: number;
  /** Last 14 days of delivered revenue, oldest first, for the sparkline. */
  revenueSeries: { date: string; value: number }[];
  topProducts: { title: string; units: number; revenue: number }[];
  lowStock: { title: string; variant: string; stock: number; slug: string }[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = Date.now();
  const DAY = 86_400_000;
  const recent = orders.filter(
    (o) => now - new Date(o.createdAt).getTime() < 30 * DAY,
  );

  const delivered = recent.filter((o) => o.status === "delivered");
  const returned = recent.filter((o) => o.status === "returned");
  const revenue30d = delivered.reduce((sum, o) => sum + o.total, 0);

  // Revenue is recognised on delivery, not on placement — the whole point of
  // the confirmation workflow is that a placed COD order is not yet money.
  const revenueSeries: { date: string; value: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const start = now - (i + 1) * DAY;
    const end = now - i * DAY;
    const value = orders
      .filter((o) => {
        const t = new Date(o.createdAt).getTime();
        return o.status === "delivered" && t >= start && t < end;
      })
      .reduce((sum, o) => sum + o.total, 0);
    revenueSeries.push({ date: new Date(end).toISOString().slice(0, 10), value });
  }

  const productTotals = new Map<string, { title: string; units: number; revenue: number }>();
  for (const order of delivered) {
    for (const item of order.items) {
      const entry = productTotals.get(item.productId) ?? {
        title: item.titleSnapshot,
        units: 0,
        revenue: 0,
      };
      entry.units += item.qty;
      entry.revenue += item.priceSnapshot * item.qty;
      productTotals.set(item.productId, entry);
    }
  }

  const lowStock = products
    .flatMap((p) =>
      p.variants.map((v) => ({
        title: p.title,
        variant: Object.values(v.options).join(" · "),
        stock: v.stock,
        slug: p.slug,
      })),
    )
    .filter((v) => v.stock <= 3)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 8);

  return {
    revenue30d,
    orders30d: recent.length,
    pendingCount: orders.filter((o) => o.status === "pending").length,
    deliveredRate: recent.length ? delivered.length / recent.length : 0,
    returnRate: recent.length ? returned.length / recent.length : 0,
    averageOrderValue: delivered.length ? Math.round(revenue30d / delivered.length) : 0,
    revenueSeries,
    topProducts: [...productTotals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6),
    lowStock,
  };
}
