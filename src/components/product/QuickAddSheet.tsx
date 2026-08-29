"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Money, VariantOptionName } from "@/types";
import {
  cheapestVariant,
  findVariant,
  isSelectionComplete,
  LOW_STOCK_THRESHOLD,
  type QuickAddProduct,
} from "@/lib/catalog-utils";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { useCartStore } from "@/lib/stores/cart-store";
import { toast } from "@/lib/stores/toast-store";
import { trackAddToCart } from "@/lib/analytics/events";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Price } from "@/components/ui/Price";
import { Sheet } from "@/components/ui/Sheet";
import { QtyStepper } from "./QtyStepper";
import { VariantPicker } from "./VariantPicker";

type Selection = Partial<Record<VariantOptionName, string>>;

/** What the listing card already knows, drawn while the real product loads. */
export interface QuickAddSummary {
  id: string;
  slug: string;
  title: string;
  image: string;
  price: Money;
  oldPrice?: Money;
}

/**
 * Buying without leaving the listing.
 *
 * The same sheet the product page opens from its sticky bar, reachable from a
 * card. It deliberately does NOT add straight to the cart on tap:
 *
 * - On a product with options there is no correct variant to assume. Picking
 *   the first one silently is how a shop ends up couriering a size S to
 *   somebody who wanted XL, and on cash on delivery that parcel comes back at
 *   the shop's expense in both directions. Nothing is pre-selected here for the
 *   same reason the product page pre-selects nothing.
 * - On a product without options there is nothing to choose, but the sheet
 *   still earns its place: it carries the quantity stepper and Buy Now, so the
 *   fast path from a category page to checkout is two taps.
 *
 * `product` is null until the fetch lands. Both actions are withheld during
 * that window rather than shown against the summary's price — the summary
 * cannot say which variant is being bought, and a button that adds the wrong
 * thing quickly is worse than one that waits.
 *
 * Selection state is local, and cleared on every opening — see `prevOpen`. A
 * size abandoned on one card must not be waiting there when it is reopened.
 */
export function QuickAddSheet({
  summary,
  product,
  failed,
  open,
  onClose,
}: {
  summary: QuickAddSummary;
  /** Null until the variant data arrives. */
  product: QuickAddProduct | null;
  /** True when the lookup failed — deleted product, or the API is unwell. */
  failed: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const startBuyNow = useCartStore((s) => s.startBuyNow);

  const [selection, setSelection] = useState<Selection>({});
  const [requestedQty, setRequestedQty] = useState(1);
  const [errorAxes, setErrorAxes] = useState<VariantOptionName[]>([]);

  /**
   * Every opening starts with nothing chosen.
   *
   * The sheet stays mounted while closed so it can animate out, which means its
   * state outlives the closing — a size picked and then abandoned was still
   * selected the next time the same card was tapped. That is exactly the
   * pre-selection this component exists to avoid, arrived at from the other
   * direction: the shopper is shown a size they did not choose *this time*.
   *
   * Reset on the way IN rather than on the way out, or the chosen size visibly
   * clears itself while the panel is still sliding away. Adjusted during render
   * on a prop change, which is the pattern `Sheet` itself uses for the same
   * reason: no effect, no extra paint.
   */
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setSelection({});
      setRequestedQty(1);
      setErrorAxes([]);
    }
  }

  const hasVariants = (product?.options.length ?? 0) > 0;
  const variant = useMemo(
    () => (product ? findVariant(product, selection) : undefined),
    [product, selection],
  );

  const price = variant?.price ?? product?.price ?? summary.price;
  const oldPrice = variant?.oldPrice ?? product?.oldPrice ?? summary.oldPrice;
  const stock = hasVariants ? (variant?.stock ?? 0) : 99;
  const complete = product ? isSelectionComplete(product, selection) : false;
  const inStock = complete && stock > 0;

  /* Live while the selection is incomplete, so the tap can explain what is
     missing. A disabled button teaches nothing — see ProductPurchase. */
  const purchaseBlocked = complete && !inStock;

  const from =
    product && hasVariants && !complete ? cheapestVariant(product) : undefined;
  const shownPrice = from?.price ?? price;
  const shownOldPrice = from ? from.oldPrice : oldPrice;

  /* Derived, not synced: switching to a variant with less stock clamps the
     shown value, and switching back restores what was originally asked for. */
  const qty = Math.max(1, Math.min(requestedQty, Math.max(stock, 1)));

  const image =
    (product && product.images[variant?.imageIndex ?? 0]) ?? summary.image;

  /* ------------------------------------------------------------------ */

  /** Returns true when the action may proceed. */
  function ensureSelection(): boolean {
    if (!product) return false;

    const missing = product.options
      .filter((o) => !selection[o.name])
      .map((o) => o.name);
    if (missing.length === 0) return true;

    setErrorAxes(missing);
    toast(copy.product.selectRequired(missing), { tone: "error" });
    return false;
  }

  function handleAddToCart() {
    if (!product || !ensureSelection() || !inStock) return;
    addItem({ productId: product.id, variantId: variant?.id, qty }, stock);
    trackAddToCart({
      sku: variant?.sku ?? product.sku,
      title: product.title,
      price,
      quantity: qty,
    });
    onClose();
    toast(copy.product.addedToast, {
      tone: "positive",
      action: { label: copy.product.viewCart, href: "/cart" },
    });
  }

  function handleBuyNow() {
    if (!product || !ensureSelection() || !inStock) return;
    // Deliberately NOT added to the cart — see the note in cart-store.ts.
    startBuyNow({ productId: product.id, variantId: variant?.id, qty });
    onClose();
    router.push("/checkout?mode=buynow");
  }

  /* ------------------------------------------------------------------ */

  const stockLine = !product || !complete ? null : stock <= 0 ? (
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
    /* `hideHeader` because the title belongs BESIDE the photo here, not in a
       bar above it: the shopper tapped a card they were already looking at, and
       a full-width header repeating the name pushes the size buttons — the only
       thing they came here to answer — below the fold on a small phone. */
    <Sheet open={open} onClose={onClose} title={summary.title} hideHeader>
      <div className="flex flex-col gap-6 px-gutter pb-6 pt-2">
        <div className="flex items-start gap-4">
          <div className="relative size-[88px] shrink-0 overflow-hidden rounded-md bg-surface">
            {image && (
              <Image src={image} alt="" fill sizes="88px" className="object-cover" />
            )}
          </div>

          {/* `items-start` so the stock badge hugs its text — a flex column
              stretches its children, which made "In stock" a full-width bar. */}
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <h2 className="clamp-2 text-body font-medium leading-snug text-ink">
              {summary.title}
            </h2>
            <Price
              price={shownPrice}
              oldPrice={shownOldPrice}
              size="row"
              showBadge
              prefix={from ? copy.product.priceFrom : undefined}
            />
            {stockLine}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={copy.nav.close}
            className={cn(
              "-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full",
              "border border-line text-muted transition-colors",
              "hover:border-ink hover:text-ink",
            )}
          >
            <Icon name="close" size={17} />
          </button>
        </div>

        {failed ? (
          /* The sheet cannot say what is buyable, so it stops claiming to and
             hands over to the page that can. */
          <div className="flex flex-col gap-3">
            <p className="text-caption text-muted">{copy.product.quickAddFailed}</p>
            <Button
              href={`/product/${summary.slug}`}
              variant="primary"
              size="lg"
              fullWidth
              className="rounded-full"
            >
              {copy.product.viewDetails}
            </Button>
          </div>
        ) : !product ? (
          <div
            className="flex items-center justify-center py-8 text-muted"
            role="status"
            aria-label={copy.common.loading}
          >
            <Icon name="spinner" size={22} className="animate-spin motion-reduce:animate-none" />
          </div>
        ) : (
          <>
            {hasVariants && (
              <VariantPicker
                product={product}
                selection={selection}
                errorAxes={errorAxes}
                shape="pill"
                onChange={(next) => {
                  setSelection(next);
                  setErrorAxes([]);
                }}
              />
            )}

            {/* Quantity sits BESIDE the button rather than on its own labelled
                row. In a sheet this size the stepper's own +/- are label enough,
                and the row it used to occupy is what pushed the actions down. */}
            <div className="flex items-center gap-3">
              <QtyStepper
                value={qty}
                onChange={setRequestedQty}
                max={Math.max(stock, 1)}
                className="shrink-0 overflow-hidden rounded-full"
              />
              <Button
                variant="primary"
                size="lg"
                onClick={handleAddToCart}
                disabled={purchaseBlocked}
                data-autofocus
                className="min-w-0 flex-1 rounded-full"
              >
                <Icon name="cart" size={18} />
                {copy.product.addToCart}
              </Button>
            </div>

            {/* Add to Cart is the dominant action here, unlike the product page.
                The shopper opened this from a grid they were browsing, so the
                likely next move is to keep browsing with the item put away. */}
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={handleBuyNow}
              disabled={purchaseBlocked}
              className="-mt-2 rounded-full"
            >
              {copy.product.buyNow}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
