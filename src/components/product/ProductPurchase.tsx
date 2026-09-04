"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Product, VariantOptionName } from "@/types";
import {
  cheapestVariant,
  findVariant,
  isSelectionComplete,
  LOW_STOCK_THRESHOLD,
} from "@/lib/catalog-utils";
import { formatTaka, savings } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { useCartStore } from "@/lib/stores/cart-store";
import { toast } from "@/lib/stores/toast-store";
import { trackAddToCart, trackViewContent } from "@/lib/analytics/events";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Price } from "@/components/ui/Price";
import { Sheet } from "@/components/ui/Sheet";
import { Gallery } from "./Gallery";
import { LightPill, OffFrame, useLightSwitch } from "./LightSwitch";
import { QtyStepper } from "./QtyStepper";
import { StickyBuyBar } from "./StickyBuyBar";
import { VariantPicker } from "./VariantPicker";
import { ProductLiveBadge } from "./ProductLiveBadge";

type Selection = Partial<Record<VariantOptionName, string>>;

/**
 * Owns everything above the fold on a product page: gallery, price, variant
 * selection, quantity and both purchase actions.
 *
 * These are one component because they are one piece of state — changing the
 * storage option has to move the price, the gallery, the stock line and the
 * button's enabled state together, atomically.
 */
export function ProductPurchase({ product }: { product: Product }) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const startBuyNow = useCartStore((s) => s.startBuyNow);

  /**
   * Nothing is pre-selected.
   *
   * The page used to open on the cheapest in-stock variant, which saved a tap
   * but meant a customer could buy a colour or a pack size they never looked
   * at — and the shop only finds out when the wrong item comes back. On a
   * product with variants the choice is the customer's to make, so an
   * unanswered axis blocks the purchase and says which one is unanswered.
   */
  const [selection, setSelection] = useState<Selection>({});
  const [requestedQty, setRequestedQty] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [errorAxes, setErrorAxes] = useState<VariantOptionName[]>([]);

  /**
   * The light switch.
   *
   * The hook runs for every product — hooks cannot be conditional — but it is
   * only two `useState` calls and it costs nothing when unused. What IS
   * conditional is the markup: `lit` gates both render props below, so a
   * product without the feature gets a gallery with no overlay slots filled,
   * no second image, and no control.
   *
   * `interactiveEnabled` alone is not enough. The shop can switch the feature
   * on before uploading any unlit photo, and a switch with nothing behind it
   * would be a control that does nothing.
   */
  const light = useLightSwitch({ offByIndex: product.imageStates, title: product.title });
  const lit = product.interactiveEnabled && product.imageStates.some(Boolean);

  const inlineActionsRef = useRef<HTMLDivElement>(null);
  const variantsRef = useRef<HTMLDivElement>(null);

  const hasVariants = product.options.length > 0;
  const variant = useMemo(
    () => findVariant(product, selection),
    [product, selection],
  );

  const price = variant?.price ?? product.price;
  const oldPrice = variant?.oldPrice ?? product.oldPrice;
  const stock = hasVariants ? (variant?.stock ?? 0) : 99;
  const complete = isSelectionComplete(product, selection);
  const inStock = complete && stock > 0;

  /**
   * Sold out is a dead end; an unanswered option is not.
   *
   * Disabling the buttons until every axis is chosen would be the obvious
   * reading of "you must choose first", but a disabled button explains
   * nothing — the customer taps it, nothing happens, and they leave. They stay
   * live while the selection is incomplete precisely so the tap can produce
   * the warning.
   */
  const purchaseBlocked = complete && !inStock;

  /**
   * What the price block shows.
   *
   * Until an axis is answered there is no one price, so the cheapest variant's
   * is shown under a "From" — a bare figure would read as the price and then
   * change when the customer picks the twin pack. Its own old price travels
   * with it, or the discount badge would be computed across two variants.
   */
  const from = hasVariants && !complete ? cheapestVariant(product) : undefined;
  const shownPrice = from?.price ?? price;
  const shownOldPrice = from ? from.oldPrice : oldPrice;
  const saved = savings(shownPrice, shownOldPrice);

  /* Quantity is derived, not synced. Switching to a variant with less stock
     clamps the displayed value immediately, and switching back restores what
     the customer originally asked for. An effect here would need an extra
     render and would lose the original intent. */
  const qty = Math.max(1, Math.min(requestedQty, Math.max(stock, 1)));

  /* Report the product view to Meta once per mount. Guarded by a ref rather
     than an empty dep array so a variant change cannot re-fire it — one page
     view is one ViewContent, or the audience Facebook builds is skewed towards
     indecisive shoppers. */
  const reportedView = useRef(false);
  useEffect(() => {
    if (reportedView.current) return;
    reportedView.current = true;
    trackViewContent({ sku: product.sku, title: product.title, price });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  /* Show the sticky bar only once the inline buttons have scrolled away. */
  useEffect(() => {
    const target = inlineActionsRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  /* ---------------------------------------------------------------------- */

  function missingAxes(): VariantOptionName[] {
    return product.options
      .filter((o) => !selection[o.name])
      .map((o) => o.name);
  }

  /** Returns true when the action may proceed. */
  function ensureSelection(): boolean {
    const missing = missingAxes();
    if (missing.length === 0) return true;

    setErrorAxes(missing);
    toast(copy.product.selectRequired(missing), { tone: "error" });
    variantsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  function handleAddToCart() {
    if (!ensureSelection() || !inStock) return;
    addItem({ productId: product.id, variantId: variant?.id, qty }, stock);
    trackAddToCart({
      sku: variant?.sku ?? product.sku,
      title: product.title,
      price,
      quantity: qty,
    });
    setSheetOpen(false);
    toast(copy.product.addedToast, {
      tone: "positive",
      action: { label: copy.product.viewCart, href: "/cart" },
    });
  }

  function handleBuyNow() {
    if (!ensureSelection() || !inStock) return;
    // Deliberately NOT added to the cart — see the note in cart-store.ts.
    startBuyNow({ productId: product.id, variantId: variant?.id, qty });
    setSheetOpen(false);
    router.push("/checkout?mode=buynow");
  }

  /**
   * From the sticky bar we open the variant sheet first when the product has
   * options. The customer is 4 screens below the picker at that point and
   * should be able to see and change what they're buying without scrolling
   * back up.
   */
  function stickyAction(direct: () => void) {
    if (hasVariants) setSheetOpen(true);
    else direct();
  }

  /* ---------------------------------------------------------------------- */

  const stockLine = !complete ? null : stock <= 0 ? (
    <Badge tone="saleSoft" size="md">
      {copy.product.outOfStock}
    </Badge>
  ) : stock <= LOW_STOCK_THRESHOLD ? (
    <Badge tone="warn" size="md">
      {copy.product.lowStock(stock)}
    </Badge>
  ) : (
    <Badge tone="positive" size="md">
      <Icon name="check" size={12} />
      {copy.product.inStock}
    </Badge>
  );

  return (
    <>
      <div className="md:grid md:grid-cols-2 md:gap-10">
        <div className="flex flex-col">
          <Gallery
            images={product.images}
            title={product.title}
            activeIndex={variant?.imageIndex}
            {...(lit
              ? {
                  renderFrameOverlay: (i: number) => (
                    <OffFrame
                      state={product.imageStates[i] ?? null}
                      title={product.title}
                      index={i}
                      total={product.images.length}
                      visible={light.isOff(i)}
                    />
                  ),
                  renderOverlay: (i: number) =>
                    light.hasPair(i) ? (
                      <LightPill isOff={light.isOff(i)} onToggle={() => light.toggle(i)} />
                    ) : null,
                }
              : {})}
          />
          {product.videoUrl && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("open-product-video"));
                }}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/90 px-4 py-2 text-caption font-medium text-ink shadow-sm hover:border-ink/30 transition-all hover:bg-surface active:scale-95"
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-white">
                  <svg className="size-3 translate-x-0.5 fill-current" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <span>Watch Product Video</span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-5 md:mt-0">
          {/* Title stays first in the DOM — it is the h1, and a screen reader or
              a crawler should meet the product's name before its price.

              On a phone the two are reordered visually: the shopper arrives from
              a video ad already knowing what the lamp is, and the one thing they
              came to find out is what it costs. Above 768px there is no fold to
              fight and the conventional title-then-price order is restored. */}
          <div>
            {/* Brand is optional. The element is dropped rather than rendered
                empty, so an unbranded product does not sit under a blank line
                that reads as a loading failure. */}
            {product.brand && (
              <p className="text-caption font-medium text-muted">{product.brand}</p>
            )}
            {/* One step down from display on a phone. At 28px a keyword-stuffed
                title runs to six lines and pushes the price, the stock line and
                both buttons off the first screen; the title is not what has to
                be read first, so it is the one that gives up the space. */}
            <h1
              className={
                product.brand
                  ? "mt-1 text-title text-ink md:text-display"
                  : "text-title text-ink md:text-display"
              }
            >
              {product.title}
            </h1>
            <ProductLiveBadge slug={product.slug} />
          </div>

          {/* Only the price is reordered, and it moves to -1 rather than the
              rest moving to 2 and 3: every sibling defaults to `order: 0`, so
              numbering just this one above them would have sent the quantity
              stepper and both buttons above the title instead. */}
          <div className="-order-1 flex flex-col gap-2 md:order-none">
            <Price
              price={shownPrice}
              oldPrice={shownOldPrice}
              size="page"
              showBadge
              prefix={from ? copy.product.priceFrom : undefined}
            />
            <div className="flex flex-wrap items-center gap-2">
              {stockLine}
              {saved > 0 && (
                <span className="text-caption text-muted">
                  {copy.product.save(formatTaka(saved))}
                </span>
              )}
            </div>
          </div>

          {hasVariants && (
            <div ref={variantsRef}>
              <VariantPicker
                product={product}
                selection={selection}
                errorAxes={errorAxes}
                onChange={(next) => {
                  setSelection(next);
                  setErrorAxes([]);
                }}
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <span className="text-caption font-medium text-muted">
              {copy.product.quantity}
            </span>
            <QtyStepper value={qty} onChange={setRequestedQty} max={Math.max(stock, 1)} />
          </div>

          {/* Two full-width buttons, stacked, with Buy Now FIRST.
              On a phone the top button is the one under the thumb after reading
              the price, so the direct path to checkout gets that position and Add
              to Cart takes the secondary slot below it. */}
          <div ref={inlineActionsRef} className="flex flex-col gap-2.5">
            <Button
              variant="primary"
              size="xl"
              fullWidth
              onClick={handleBuyNow}
              disabled={purchaseBlocked}
            >
              {copy.product.buyNow}
            </Button>
            <Button
              variant="secondary"
              size="xl"
              fullWidth
              onClick={handleAddToCart}
              disabled={purchaseBlocked}
            >
              <Icon name="cart" size={19} />
              {copy.product.addToCart}
            </Button>
          </div>

          <TrustRow warranty={product.warranty} />
        </div>
      </div>

      <StickyBuyBar
        visible={stickyVisible && !sheetOpen}
        image={product.images[variant?.imageIndex ?? 0] ?? product.images[0]}
        title={product.title}
        price={shownPrice}
        disabled={purchaseBlocked}
        onAddToCart={() => stickyAction(handleAddToCart)}
        onBuyNow={() => stickyAction(handleBuyNow)}
      />

      {hasVariants && (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={product.title}
        >
          <div className="flex flex-col gap-5 px-gutter pb-6">
            <div className="flex gap-3">
              <div className="relative size-20 shrink-0 overflow-hidden rounded-sm bg-surface">
                <Image
                  src={product.images[variant?.imageIndex ?? 0] ?? product.images[0]}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </div>
              <div className="flex min-w-0 flex-col justify-center gap-1.5">
                <Price
                  price={shownPrice}
                  oldPrice={shownOldPrice}
                  size="row"
                  showBadge
                  prefix={from ? copy.product.priceFrom : undefined}
                />
                {stockLine}
              </div>
            </div>

            <VariantPicker
              product={product}
              selection={selection}
              errorAxes={errorAxes}
              onChange={(next) => {
                setSelection(next);
                setErrorAxes([]);
              }}
            />

            <div className="flex items-center justify-between">
              <span className="text-caption font-medium text-muted">
                {copy.product.quantity}
              </span>
              <QtyStepper value={qty} onChange={setRequestedQty} max={Math.max(stock, 1)} />
            </div>

            <div className="flex flex-col gap-2.5">
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={handleAddToCart}
                disabled={purchaseBlocked}
              >
                {copy.product.addToCart}
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={handleBuyNow}
                disabled={purchaseBlocked}
                data-autofocus
              >
                {copy.product.buyNow}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Trust signals stand in for the reviews and ratings this store deliberately
 * does not have. For an unknown brand selling COD in Bangladesh these move
 * conversion more than star ratings would — and unlike an empty review
 * section, they can't look bad on launch day.
 */
function TrustRow({ warranty }: { warranty: string }) {
  const items = [
    { icon: "cash", label: copy.trust.cod },
    { icon: "shield", label: copy.trust.warranty(warranty) },
    { icon: "refresh", label: copy.trust.replacement },
    { icon: "truck", label: copy.trust.fastDelivery },
  ];

  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-4">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-caption text-ink-soft">
          <Icon name={item.icon} size={16} className="text-muted" />
          <span className="min-w-0">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
