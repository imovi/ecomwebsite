"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Product, VariantOptionName } from "@/types";
import {
  defaultSelection,
  findVariant,
  isSelectionComplete,
} from "@/lib/catalog-utils";
import { formatTaka, savings } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { useCartStore } from "@/lib/stores/cart-store";
import { toast } from "@/lib/stores/toast-store";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Price } from "@/components/ui/Price";
import { Sheet } from "@/components/ui/Sheet";
import { Gallery } from "./Gallery";
import { QtyStepper } from "./QtyStepper";
import { StickyBuyBar } from "./StickyBuyBar";
import { VariantPicker } from "./VariantPicker";

type Selection = Partial<Record<VariantOptionName, string>>;

/** Below this, show the exact count instead of a generic "In stock". */
const LOW_STOCK_THRESHOLD = 5;

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

  /* Pre-select the cheapest in-stock variant. One less tap between arriving
     and buying, and it guarantees the page never opens on a sold-out combo. */
  const [selection, setSelection] = useState<Selection>(() =>
    defaultSelection(product),
  );
  const [requestedQty, setRequestedQty] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);
  const [errorAxes, setErrorAxes] = useState<VariantOptionName[]>([]);

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
  const saved = savings(price, oldPrice);

  /* Quantity is derived, not synced. Switching to a variant with less stock
     clamps the displayed value immediately, and switching back restores what
     the customer originally asked for. An effect here would need an extra
     render and would lose the original intent. */
  const qty = Math.max(1, Math.min(requestedQty, Math.max(stock, 1)));

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
    toast(copy.product.selectRequired, { tone: "error" });
    variantsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }

  function handleAddToCart() {
    if (!ensureSelection() || !inStock) return;
    addItem({ productId: product.id, variantId: variant?.id, qty }, stock);
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
        <Gallery
          images={product.images}
          title={product.title}
          activeIndex={variant?.imageIndex}
        />

        <div className="mt-5 flex flex-col gap-5 md:mt-0">
          <div>
            <p className="text-caption font-medium text-muted">{product.brand}</p>
            <h1 className="mt-1 text-display text-ink">{product.title}</h1>
          </div>

          <div className="flex flex-col gap-2">
            <Price price={price} oldPrice={oldPrice} size="page" showBadge />
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

          {/* Two full-width buttons, stacked. Buy Now is the dominant one. */}
          <div ref={inlineActionsRef} className="flex flex-col gap-2.5">
            <Button
              variant="secondary"
              size="xl"
              fullWidth
              onClick={handleAddToCart}
              disabled={!inStock}
            >
              <Icon name="cart" size={19} />
              {copy.product.addToCart}
            </Button>
            <Button
              variant="primary"
              size="xl"
              fullWidth
              onClick={handleBuyNow}
              disabled={!inStock}
            >
              {copy.product.buyNow}
            </Button>
          </div>

          <TrustRow warranty={product.warranty} />
        </div>
      </div>

      <StickyBuyBar
        visible={stickyVisible && !sheetOpen}
        image={product.images[variant?.imageIndex ?? 0] ?? product.images[0]}
        title={product.title}
        price={price}
        disabled={!inStock && complete}
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
                <Price price={price} oldPrice={oldPrice} size="row" showBadge />
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
                disabled={!inStock}
              >
                {copy.product.addToCart}
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={handleBuyNow}
                disabled={!inStock}
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
