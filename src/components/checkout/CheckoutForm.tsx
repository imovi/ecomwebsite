"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DeliveryZone, StoreSettings } from "@/types";
import { useResolvedCart } from "@/lib/hooks/use-resolved-cart";
import { suggestZone, type ZoneSuggestion } from "@/lib/geo";
import { trackInitiateCheckout } from "@/lib/analytics/events";
import { rememberOrder } from "@/lib/stores/last-order";
import { useCartStore } from "@/lib/stores/cart-store";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka, normalizePhone } from "@/lib/utils";
import { copy } from "@/lib/copy";
import {
  placeOrderAction,
  quoteAction,
  recordIncompleteCheckoutAction,
} from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { EmptyState, Skeleton } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";
import { AreaField } from "./AreaField";
import { ZoneSelector } from "./ZoneSelector";
import { OrderSummary } from "./OrderSummary";

const DRAFT_KEY = "gng-checkout-draft-v1";

/**
 * The idempotency key for the checkout attempt in progress.
 *
 * Stored beside the draft rather than held only in memory. A key that lives in a
 * ref dies with the mount, and the mount dies on a reload — so the one scenario
 * it exists to cover was the one it did not: the request times out at eight
 * seconds while the order actually commits, the shopper sees "we could not reach
 * our system", refreshes, and submits again. A fresh key makes that a second
 * real order, with a second set of stock reserved and a second parcel to send
 * out cash-on-delivery.
 *
 * Cleared once an order comes back, so the next customer on a shared phone — and
 * the same customer buying again tomorrow — starts a genuinely new attempt.
 */
const ATTEMPT_KEY = "gng-checkout-attempt-v1";

/**
 * Reads the current attempt's key, minting and persisting one if there is none.
 *
 * Runs on submit rather than at mount: touching storage during render would be
 * read on the server too, and the value is not needed until there is something
 * to send.
 */
function currentAttemptKey(): string {
  try {
    const existing = sessionStorage.getItem(ATTEMPT_KEY);
    if (existing) return existing;

    const minted = crypto.randomUUID();
    sessionStorage.setItem(ATTEMPT_KEY, minted);
    return minted;
  } catch {
    /* Private mode or a blocked store. A per-call key is still better than
       none: it covers the client's own retry of a single submit, which is what
       `apiRequest` and a double-tapped button produce. */
    return crypto.randomUUID();
  }
}

function clearAttemptKey(): void {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* Nothing was stored, so nothing to clear. */
  }
}

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
export function CheckoutForm({ settings }: { settings: StoreSettings }) {
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  /* The key itself lives in `sessionStorage` — see `currentAttemptKey`. It has
     to outlive this component, because a reload after a timeout is exactly the
     retry it exists to make safe. */

  /* --- Lines ------------------------------------------------------------ */

  const sourceLines = useMemo(() => {
    if (!hydrated) return [];
    if (buyNowMode) return buyNow ? [buyNow] : [];
    return items;
  }, [hydrated, buyNowMode, buyNow, items]);

  /* Resolved server-side against live catalogue data, so prices and stock are
     current rather than whatever was cached when the cart was filled. */
  const { lines, loading: resolvingCart } = useResolvedCart(sourceLines, hydrated);

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

  /* --- Recording an incomplete checkout ---------------------------------
     A customer who typed their number and then vanished is a warm lead with a
     known phone, and today that information dies with the tab. Saved on a
     debounce once the number is actually valid, so a half-typed number never
     creates a lead nobody can ring.

     The record closes itself when the order arrives — see the server action —
     so finishing normally never puts anyone on the call list. */

  const savedLeadRef = useRef<string>("");

  useEffect(() => {
    const phone = normalizePhone(form.phone);
    if (!/^01[3-9]\d{8}$/.test(phone)) return;
    if (lines.length === 0) return;

    /* A snapshot of what would be saved. Skipping an unchanged one keeps a
       customer tabbing between fields from generating a request per keystroke
       batch. */
    const fingerprint = JSON.stringify([
      phone,
      form.customerName.trim(),
      form.address.trim(),
      form.areaText.trim(),
      lines.map((l) => [l.productId, l.variantId, l.qty]),
    ]);
    if (fingerprint === savedLeadRef.current) return;

    const timer = setTimeout(() => {
      savedLeadRef.current = fingerprint;

      void recordIncompleteCheckoutAction({
        phone,
        ...(form.customerName.trim() ? { customerName: form.customerName.trim() } : {}),
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        ...(form.areaText.trim() ? { areaText: form.areaText.trim() } : {}),
        ...(zone ? { deliveryZone: zone } : {}),
        lines: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
        })),
      });
    }, 1500);

    return () => clearTimeout(timer);
    /* `zone` is intentionally absent: it is derived from `areaText`, which is
       already a dependency, and including it would re-fire on every
       suggestion recalculation. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.phone, form.customerName, form.address, form.areaText, lines]);


  /* --- Totals ------------------------------------------------------------
     Priced by the API, not here. The same calculation runs again at order
     placement, so the number the customer agrees to is the number the order is
     written with — a locally computed total could disagree with the server the
     moment a price or a delivery charge changed.

     The local subtotal is kept only as an optimistic value so the summary is
     not blank on first paint. */

  const localSubtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const [quote, setQuote] = useState<{
    subtotal: number;
    deliveryCharge: number;
    grandTotal: number;
    amountToFreeDelivery: number;
  } | null>(null);
  const [pricing, setPricing] = useState(false);

  const subtotal = quote?.subtotal ?? localSubtotal;
  const deliveryCharge = quote?.deliveryCharge ?? 0;
  const total = quote?.grandTotal ?? localSubtotal;
  const freeDeliveryRemaining = quote?.amountToFreeDelivery ?? 0;

  /* Re-price whenever the cart or the delivery zone changes. Debounced,
     because the zone re-derives on every keystroke in the area field and a
     request per character would hammer the API for nothing. */
  const cartKey = lines
    .map((l) => `${l.productId}:${l.variantId ?? ""}:${l.qty}`)
    .join("|");

  useEffect(() => {
    /* No lines means the empty state is rendered and the quote is never read,
       so there is nothing to clear. */
    if (lines.length === 0) return;

    let cancelled = false;
    /* Flags the summary as pending while a fresh quote is in flight, so the
       figures dim on the same paint as the change that invalidated them. The
       alternative — setting it inside the debounce timer — leaves stale totals
       looking authoritative for 250ms, which is exactly the window in which a
       customer reads the number and taps Place Order. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPricing(true);

    const timer = setTimeout(() => {
      void quoteAction({
        lines: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
        })),
        ...(zone ? { deliveryZone: zone } : {}),
      }).then((result) => {
        if (cancelled) return;
        setPricing(false);
        if (result.ok) {
          setQuote({
            subtotal: result.subtotal,
            deliveryCharge: result.deliveryCharge,
            grandTotal: result.grandTotal,
            amountToFreeDelivery: result.amountToFreeDelivery,
          });
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    /* Keyed on the cart contents and the zone rather than the array identity,
       which changes on every render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, zone]);

  /**
   * Report reaching checkout, so both platforms can report a
   * checkout-to-purchase rate.
   *
   * NOT on arrival. This used to fire the moment the cart was priced, which
   * meant every visitor who so much as landed on the page counted as having
   * begun a checkout — including the ones who took one look at the delivery
   * charge and left without touching a field. That inflates the top of the
   * funnel with people who never intended anything, and since Meta optimises
   * delivery toward whoever produces the event, it teaches the ad account to
   * find more of exactly that person.
   *
   * A name and a working phone number is where intent becomes real on a
   * cash-on-delivery store: it is the point where the shopper has handed over
   * the thing the shop would actually call them on.
   *
   * The thresholds are the form's OWN — `validate()` accepts a name of three
   * characters and a Bangladeshi mobile, and this deliberately reuses both
   * rather than inventing a second standard. A number that would be rejected at
   * Place Order must not be good enough to report a checkout.
   *
   * Still once per page, by the ref: the fields keep changing after this fires
   * and a second event would double-count one shopper.
   */
  const reportedCheckout = useRef(false);
  useEffect(() => {
    if (reportedCheckout.current || lines.length === 0) return;

    /* The phone pattern only matches a complete number, so this cannot fire
       part-way through someone typing one. */
    const named = form.customerName.trim().length >= 3;
    const reachable = /^01[3-9]\d{8}$/.test(normalizePhone(form.phone));
    if (!named || !reachable) return;

    reportedCheckout.current = true;

    trackInitiateCheckout({
      value: localSubtotal,
      /* The SKU, not the product id. Both platforms match items on this field,
         and every other event in the funnel — view_item, add_to_cart, purchase —
         reports the SKU. A product id here would make this look like a different
         product and break the funnel entirely. */
      items: lines.map((l) => ({ sku: l.sku, title: l.title, quantity: l.qty })),
    });
    /* The two fields are dependencies now, not just the cart: the whole point is
       that this re-checks as the shopper types and fires on the keystroke that
       completes their phone number. Keyed on `lines.length` rather than `lines`
       so a quantity change does not re-enter — the ref would stop it anyway,
       but only after the work. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, form.customerName, form.phone]);

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

  /**
   * Top to bottom, matching the form. The first problem in this order is the
   * one the customer is told about — listing four at once on a phone is how a
   * checkout gets abandoned.
   */
  const FIELD_ORDER = ["customerName", "phone", "address", "areaText", "zone"] as const;

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (form.customerName.trim().length < 3) next.customerName = copy.checkout.invalidName;
    if (!/^01[3-9]\d{8}$/.test(normalizePhone(form.phone)))
      next.phone = copy.checkout.invalidPhone;
    if (form.address.trim().length < 8) next.address = copy.checkout.shortAddress;
    if (form.areaText.trim().length < 2) next.areaText = copy.checkout.required;
    if (!zone) next.zone = copy.checkout.zoneManual;

    setErrors(next);
    return next;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (lines.length === 0) {
      toast(copy.checkout.emptyCart, { tone: "error" });
      return;
    }
    const problems = validate();
    if (Object.keys(problems).length > 0) {
      const first = FIELD_ORDER.find((field) => problems[field]);

      /* Say what is wrong, rather than only marking it red further up the page.
         The Place Order button sits at the bottom on a phone, so an inline
         error on a field that scrolled out of view reads as a dead button —
         the customer taps again, nothing happens, and they leave. */
      if (first) toast(problems[first] ?? copy.checkout.required, { tone: "error" });

      /* Then take them to it. The zone selector is a pair of buttons rather
         than an input, so it is found by its own marker, not by
         `aria-invalid`. */
      const target =
        document.querySelector<HTMLElement>(`[data-field="${first ?? ""}"]`) ??
        document.querySelector<HTMLElement>('[aria-invalid="true"]');

      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      /* Focus only what can take it — scrolling is enough for the rest. */
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus({ preventScroll: true });
      }
      return;
    }

    setSubmitting(true);

    const result = await placeOrderAction({
      customerName: form.customerName,
      phone: form.phone,
      address: form.address,
      areaText: form.areaText,
      deliveryZone: zone!,
      lines: lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        qty: l.qty,
      })),
      /* Stable for this checkout attempt — across a retry, a re-render AND a
         reload — so a submit that timed out on the way back returns the
         original order instead of creating a second. */
      idempotencyKey: currentAttemptKey(),
    });

    if (!result.ok) {
      setSubmitting(false);
      if (result.field) setErrors({ [result.field]: result.error });
      toast(result.error, { tone: "error" });
      return;
    }

    /* Stash the confirmation so the success page can itemise the order
       without a public lookup endpoint. */
    rememberOrder(result.order);

    /* This attempt is over. Leaving the key behind would make the customer's
       NEXT order — same tab, ten minutes later — replay this one and hand them
       a confirmation for a parcel they already have. */
    clearAttemptKey();

    // Clear only what was actually purchased.
    if (buyNowMode) clearBuyNow();
    else clearCart();

    // replace(), not push() — Back from the success page must not return to a
    // checkout form that would place a second order.
    router.replace(`/order/success/${encodeURIComponent(result.order.orderNumber)}`);
  }

  /* --- Render ------------------------------------------------------------ */

  if (!hydrated || resolvingCart) {
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
            data-field="customerName"
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
            data-field="phone"
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
            data-field="address"
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
            /* Taken from the quote rather than recomputed: the API owns the
               free-delivery rule, and a local copy of it would eventually
               disagree with the charge actually applied. */
            freeDelivery={zone !== null && deliveryCharge === 0}
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
          deliveryCharge={deliveryCharge}
          total={total}
          zoneChosen={zone !== null}
          freeDeliveryRemaining={freeDeliveryRemaining}
          isPricing={pricing}
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
