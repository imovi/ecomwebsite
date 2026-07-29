"use server";

import { revalidatePath } from "next/cache";
import {
  addOrderNote,
  findCoupon,
  findOrderForCustomer,
  getSettings,
  placeOrder,
  updateOrderStatus,
} from "@/lib/data/orders";
import { evaluateCoupon } from "@/lib/pricing";
import { isValidPhone } from "@/lib/utils";
import type { DeliveryZone, Order, OrderStatus } from "@/types";

/**
 * Server actions — the only write path in the app.
 *
 * Everything the client sends is re-validated here. Prices, stock and totals
 * are recomputed from the catalog inside `placeOrder`, so a tampered request
 * cannot buy a ৳168,000 phone for ৳1.
 */

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

export interface CheckoutInput {
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  zone: DeliveryZone;
  couponCode?: string;
  lines: { productId: string; variantId?: string; qty: number }[];
}

export type CheckoutResult =
  | { ok: true; orderId: string; orderNumber: string }
  | { ok: false; error: string; field?: string };

export async function placeOrderAction(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  if (input.customerName.trim().length < 3) {
    return { ok: false, error: "Enter your full name", field: "customerName" };
  }
  if (!isValidPhone(input.phone)) {
    return {
      ok: false,
      error: "Enter a valid 11-digit mobile number",
      field: "phone",
    };
  }
  if (input.address.trim().length < 8) {
    return { ok: false, error: "Please enter a complete address", field: "address" };
  }
  if (input.areaText.trim().length < 2) {
    return { ok: false, error: "This field is required", field: "areaText" };
  }
  if (input.zone !== "inside_dhaka" && input.zone !== "outside_dhaka") {
    return { ok: false, error: "Choose your delivery area", field: "zone" };
  }

  const result = await placeOrder(input);
  if (!result.ok) return { ok: false, error: result.error };

  // Stock changed, so cached product pages are now stale.
  revalidatePath("/", "layout");

  return {
    ok: true,
    orderId: result.order.id,
    orderNumber: result.order.orderNumber,
  };
}

export type CouponResult =
  | { ok: true; code: string; discount: number }
  | { ok: false; message: string };

export async function applyCouponAction(
  code: string,
  subtotal: number,
): Promise<CouponResult> {
  const coupon = await findCoupon(code);
  const { discount, error } = evaluateCoupon(coupon, subtotal);

  if (error) {
    const messages: Record<string, string> = {
      not_found: "That coupon code doesn't exist.",
      inactive: "That coupon is no longer active.",
      expired: "That coupon has expired.",
      used_up: "That coupon has reached its usage limit.",
      min_order: coupon
        ? `Spend at least ৳${coupon.minOrder.toLocaleString("en-US")} to use this coupon.`
        : "Order value is too low for this coupon.",
    };
    return { ok: false, message: messages[error] ?? "Coupon could not be applied." };
  }

  return { ok: true, code: coupon!.code, discount };
}

/* -------------------------------------------------------------------------- */
/* Order tracking                                                             */
/* -------------------------------------------------------------------------- */

export async function trackOrderAction(
  orderNumber: string,
  phone: string,
): Promise<Order | null> {
  if (!orderNumber.trim() || !phone.trim()) return null;
  return findOrderForCustomer(orderNumber, phone);
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export async function updateOrderStatusAction(
  id: string,
  status: OrderStatus,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await updateOrderStatus(id, status, note);
  if (result.ok) {
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    revalidatePath("/admin");
  }
  return result;
}

export async function addOrderNoteAction(id: string, note: string): Promise<void> {
  await addOrderNote(id, note);
  revalidatePath(`/admin/orders/${id}`);
}

export async function getDeliverySettingsAction() {
  return getSettings();
}
