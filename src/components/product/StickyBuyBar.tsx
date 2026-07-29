"use client";

import Image from "next/image";
import { cn, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";

interface StickyBuyBarProps {
  visible: boolean;
  image: string;
  title: string;
  price: number;
  disabled: boolean;
  onAddToCart: () => void;
  onBuyNow: () => void;
}

/**
 * The single highest-leverage element on the product page.
 *
 * The inline buttons sit above ~4 screens of description, specs and related
 * products on a phone. Without this bar, a customer who reads to the bottom
 * has no call to action in front of them and has to scroll back up.
 *
 * It fades in only once the inline buttons have left the viewport, so the two
 * never compete for attention.
 */
export function StickyBuyBar({
  visible,
  image,
  title,
  price,
  disabled,
  onAddToCart,
  onBuyNow,
}: StickyBuyBarProps) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur-md",
        "shadow-bar transition-transform duration-200 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0" : "translate-y-full",
      )}
      // Hidden from assistive tech while off-screen; the inline buttons are
      // the canonical controls and duplicating them would be noise.
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="mx-auto flex max-w-[var(--container-page)] items-center gap-3 px-gutter py-2.5 pb-safe">
        {/* Product identity, desktop only — on a phone every pixel of width
            belongs to the two buttons. */}
        <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
          <div className="relative size-11 shrink-0 overflow-hidden rounded-xs bg-surface">
            <Image src={image} alt="" fill sizes="44px" className="object-cover" />
          </div>
          <div className="min-w-0">
            <p className="clamp-2 text-caption font-medium text-ink">{title}</p>
            <p className="tnum text-caption font-semibold text-sale">
              {formatTaka(price)}
            </p>
          </div>
        </div>

        <div className="flex flex-1 gap-2 sm:flex-none">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1 sm:flex-none"
            onClick={onAddToCart}
            disabled={disabled}
          >
            {copy.product.addToCart}
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1 sm:flex-none"
            onClick={onBuyNow}
            disabled={disabled}
          >
            {copy.product.buyNow}
          </Button>
        </div>
      </div>
    </div>
  );
}
