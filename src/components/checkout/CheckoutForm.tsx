"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DeliveryZone, StoreSettings } from "@/types";
import { resolveLines, type CatalogMap } from "@/lib/catalog-utils";
import { suggestZone, type ZoneSuggestion } from "@/lib/geo";
import { deliveryChargeFor } from "@/lib/pricing";
import { useCartStore } from "@/lib/stores/cart-store";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka, normalizePhone } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { placeOrderAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { EmptyState, Skeleton } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";
import { AreaField } from "./AreaField";
import { ZoneSelector } from "./ZoneSelector";
import { OrderSummary, type AppliedCoupon } from "./OrderSummary";

const DRAFT_KEY = "gng-checkout-draft-v1";

interface Draft {
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
}

/**
 * Checkout.
 *
 * Four fields, one payment method, and a total that never changes after the
 * customer reads it. Two behaviours worth calling out:
 *
 *  - `mode=buynow` reads the ephemeral single-line slice instead of the cart,
 *    so Buy Now genuinely bypasses the cart rather than quietly adding to it.
 *  - Contact details are cached locally as the customer types. A returning
 *    buyer gets a pre-filled form, which is the single cheapest conversion win
 *    available on a guest checkout.
 */
export function CheckoutForm({
  catalog,
  settings,
}: {
  catalog: CatalogMap;
  settings: StoreSettings;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const buyNowMode = searchParams.get("mode") === "buynow";

  const items = useCartStore((s) => s.items);
  const buyNow = useCartStore((s) => s.buyNow);
  const hydrated = useCartStore((s) => s.hydrated);
  const clearCart = useCartStore((s) => s.clear);
  const clearBuyNow = useCartStore((s) => s.clearBuyNow);

  const [form, setForm] = useState<Draft>({
    customerName: "",
    phone: "",
    address: "",
    areaText: "",
  });
  /** Set only when the customer picks a zone themselves. Once set, it wins
   *  over any suggestion — their choice is what gets stored on the order. */
  const [zoneOverride, setZoneOverride] = useState<DeliveryZone | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  /* --- Lines ------------------------------------------------------------ */

  const sourceLines = useMemo(() => {
    if (!hydrated) return [];
    if (buyNowMode) return buyNow ? [buyNow] : [];
    return items;
  }, [hydrated, buyNowMode, buyNow, items]);

  const lines = useMemo(
    () => resolveLines(catalog, sourceLines).filter((l) => l.qty > 0),
    [catalog, sourceLines],
  );

  /* --- Draft restore / persist ------------------------------------------ */

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      // Reading a browser-only store on mount. A lazy useState initialiser
      // would run during SSR and produce a hydration mismatch on the inputs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setForm(JSON.parse(saved) as Draft);
    } catch {
      // A corrupt draft is not worth surfacing — just start blank.
    }
  }, []);

  useEffect(() => {
    if (!form.phone && !form.customerName) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {
      // Private mode / quota. Non-fatal: the form still works.
    }
  }, [form]);

  /* --- Zone suggestion --------------------------------------------------- */

  const suggestion: ZoneSuggestion | null = useMemo(
    () => suggestZone(form.areaText),
    [form.areaText],
  );

  /* Zone is derived, never synced through an effect: the customer's explicit
     choice, falling back to what the area text suggests. That ordering is the
     whole safety property — text matching can only ever pre-fill. */
  const zoneTouched = zoneOverride !== null;
  const zone: DeliveryZone | null = zoneOverride ?? suggestion?.zone ?? null;

  /* --- Totals ------------------------------------------------------------ */

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const discount = Math.min(coupon?.discount ?? 0, subtotal);
  const payable = subtotal - discount;
  const deliveryCharge = zone ? deliveryChargeFor(zone, payable, settings) : 0;
  const total = payable + deliveryCharge;
  const freeDeliveryRemaining =
    settings.freeDeliveryThreshold > 0 && payable < settings.freeDeliveryThreshold
      ? settings.freeDeliveryThreshold - payable
      : 0;

  /* --- Submit ------------------------------------------------------------ */

  function update<K extends keyof Draft>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.customerName.trim().length < 3) next.customerName = copy.checkout.invalidName;
    if (!/^01[3-9]\d{8}$/.test(normalizePhone(form.phone)))
      next.phone = copy.checkout.invalidPhone;
    if (form.address.trim().length < 8) next.address = copy.checkout.shortAddress;
    if (form.areaText.trim().length < 2) next.areaText = copy.checkout.required;
    if (!zone) next.zone = copy.checkout.zoneManual;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (lines.length === 0) {
      toast(copy.checkout.emptyCart, { tone: "error" });
      return;
    }
    if (!validate()) {
      // Send focus to the first problem so the customer isn't hunting for it.
      document
        .querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSubmitting(true);

    const result = await placeOrderAction({
      customerName: form.customerName,
      phone: form.phone,
      address: form.address,
      areaText: form.areaText,
      zone: zone!,
      couponCode: coupon?.code,
      lines: lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        qty: l.qty,
      })),
    });

    if (!result.ok) {
      setSubmitting(false);
      if (result.field) setErrors({ [result.field]: result.error });
      toast(result.error, { tone: "error" });
      return;
    }

    // Clear only what was actually purchased.
    if (buyNowMode) clearBuyNow();
    else clearCart();

    // replace(), not push() — Back from the success page must not return to a
    // checkout form that would place a second order.
    router.replace(`/order/success/${result.orderId}`);
  }

  /* --- Render ------------------------------------------------------------ */

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <EmptyState
        icon="cart"
        title={copy.cart.empty}
        body={
          buyNowMode
            ? "This express checkout expired. Open the product again to buy it."
            : undefined
        }
      >
        <Button href="/category/all" variant="primary" size="lg">
          {copy.cart.emptyAction}
        </Button>
      </EmptyState>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-10">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-4">
          <h2 className="text-title text-ink">{copy.checkout.contactHeading}</h2>

          <Input
            label={copy.checkout.fullName}
            placeholder={copy.checkout.fullNamePlaceholder}
            value={form.customerName}
            onChange={(e) => update("customerName", e.target.value)}
            error={errors.customerName}
            autoComplete="name"
            required
          />

          <Input
            label={copy.checkout.phone}
            placeholder={copy.checkout.phonePlaceholder}
            hint={copy.checkout.phoneHint}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            error={errors.phone}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={14}
            required
          />

          <Textarea
            label={copy.checkout.address}
            placeholder={copy.checkout.addressPlaceholder}
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            error={errors.address}
            autoComplete="street-address"
            rows={3}
            required
          />

          <AreaField
            value={form.areaText}
            onChange={(value) => update("areaText", value)}
            error={errors.areaText}
          />

          <ZoneSelector
            value={zone}
            onChange={(next) => {
              setZoneOverride(next);
              setErrors((e) => {
                const rest = { ...e };
                delete rest.zone;
                return rest;
              });
            }}
            insideCharge={settings.deliveryInsideDhaka}
            outsideCharge={settings.deliveryOutsideDhaka}
            suggestion={zoneTouched ? null : suggestion}
            freeDelivery={
              settings.freeDeliveryThreshold > 0 &&
              payable >= settings.freeDeliveryThreshold
            }
            error={errors.zone}
          />
        </section>

        <section>
          <h2 className="mb-2 text-title text-ink">{copy.checkout.paymentHeading}</h2>
          {/* One method today. Rendered as a selected option rather than plain
              text so adding bKash or card later is purely additive. */}
          <div className="flex items-center gap-3 rounded-sm border border-ink bg-surface px-3.5 py-3.5">
            <Icon name="cash" size={20} className="text-ink" />
            <div className="flex-1">
              <p className="text-caption font-semibold text-ink">{copy.checkout.cod}</p>
              <p className="text-caption text-muted">{copy.checkout.codHint}</p>
            </div>
            <Icon name="checkCircle" size={19} className="text-positive" />
          </div>
        </section>
      </div>

      <div className="mt-8 lg:mt-0">
        <OrderSummary
          lines={lines}
          subtotal={subtotal}
          discount={discount}
          deliveryCharge={deliveryCharge}
          total={total}
          zoneChosen={zone !== null}
          coupon={coupon}
          onCouponChange={setCoupon}
          freeDeliveryRemaining={freeDeliveryRemaining}
        />

        {/* Sticky on mobile, inline on desktop. */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-gutter py-3 pb-safe shadow-bar backdrop-blur-md lg:static lg:mt-4 lg:border-0 lg:p-0 lg:shadow-none lg:backdrop-blur-none">
          <div className="mx-auto max-w-[var(--container-page)]">
            <Button
              type="submit"
              variant="primary"
              size="xl"
              fullWidth
              loading={submitting}
              disabled={submitting}
            >
              {submitting
                ? copy.checkout.placingOrder
                : `${copy.checkout.placeOrder} · ${formatTaka(total)}`}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
