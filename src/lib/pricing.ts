import type { Coupon, DeliveryZone, Money, StoreSettings } from "@/types";

/**
 * All order arithmetic lives here.
 *
 * The checkout page and the order-creation action both call `computeTotals`,
 * so the number the customer agrees to and the number stored on the order are
 * produced by the same code path. Duplicating this math is how stores end up
 * shipping orders whose totals don't add up.
 */

export interface CouponResult {
  discount: Money;
  error?: "not_found" | "inactive" | "expired" | "min_order" | "used_up";
}

export function evaluateCoupon(
  coupon: Coupon | undefined,
  subtotal: Money,
): CouponResult {
  if (!coupon) return { discount: 0, error: "not_found" };
  if (!coupon.active) return { discount: 0, error: "inactive" };
  if (new Date(coupon.expiresAt).getTime() < Date.now()) {
    return { discount: 0, error: "expired" };
  }
  if (coupon.usedCount >= coupon.usageLimit) return { discount: 0, error: "used_up" };
  if (subtotal < coupon.minOrder) return { discount: 0, error: "min_order" };

  let discount =
    coupon.type === "percent"
      ? Math.round((subtotal * coupon.value) / 100)
      : coupon.value;

  if (coupon.type === "percent" && coupon.maxDiscount > 0) {
    discount = Math.min(discount, coupon.maxDiscount);
  }

  // A coupon can never exceed the goods value — delivery is not discountable.
  return { discount: Math.min(discount, subtotal) };
}

export function deliveryChargeFor(
  zone: DeliveryZone,
  /** Subtotal *after* any discount — the amount the customer actually pays. */
  payableSubtotal: Money,
  settings: StoreSettings,
): Money {
  if (
    settings.freeDeliveryThreshold > 0 &&
    payableSubtotal >= settings.freeDeliveryThreshold
  ) {
    return 0;
  }
  return zone === "inside_dhaka"
    ? settings.deliveryInsideDhaka
    : settings.deliveryOutsideDhaka;
}

export interface Totals {
  subtotal: Money;
  discount: Money;
  deliveryCharge: Money;
  total: Money;
  /** How much more to spend to unlock free delivery. 0 when already free. */
  freeDeliveryRemaining: Money;
}

export function computeTotals({
  lines,
  zone,
  coupon,
  settings,
}: {
  lines: { unitPrice: Money; qty: number }[];
  /** null before the customer has told us where they are. */
  zone: DeliveryZone | null;
  coupon?: Coupon;
  settings: StoreSettings;
}): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const { discount } = evaluateCoupon(coupon, subtotal);
  const payable = subtotal - discount;

  const deliveryCharge = zone ? deliveryChargeFor(zone, payable, settings) : 0;

  const freeDeliveryRemaining =
    settings.freeDeliveryThreshold > 0 && payable < settings.freeDeliveryThreshold
      ? settings.freeDeliveryThreshold - payable
      : 0;

  return {
    subtotal,
    discount,
    deliveryCharge,
    total: payable + deliveryCharge,
    freeDeliveryRemaining,
  };
}
