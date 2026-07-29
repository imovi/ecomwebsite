"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { resolveLines, type CatalogMap } from "@/lib/catalog-utils";
import { useCartStore } from "@/lib/stores/cart-store";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";
import { Price } from "@/components/ui/Price";
import { QtyStepper } from "@/components/product/QtyStepper";

/**
 * Cart.
 *
 * Prices come from `catalog`, which the server rendered from live data — the
 * store only ever holds `{ productId, variantId, qty }`. A cart left open in a
 * tab for a week therefore shows today's prices, not last week's.
 */
export function CartView({ catalog }: { catalog: CatalogMap }) {
  const items = useCartStore((s) => s.items);
  const hydrated = useCartStore((s) => s.hydrated);
  const setQty = useCartStore((s) => s.setQty);
  const removeItem = useCartStore((s) => s.removeItem);

  const lines = useMemo(() => resolveLines(catalog, items), [catalog, items]);
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const count = lines.reduce((sum, l) => sum + l.qty, 0);

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <EmptyState icon="cart" title={copy.cart.empty}>
        <Button href="/category/all" variant="primary" size="lg">
          {copy.cart.emptyAction}
        </Button>
      </EmptyState>
    );
  }

  return (
    <>
      <p className="text-caption text-muted">{copy.cart.itemCount(count)}</p>

      <ul className="mt-4 flex flex-col">
        {lines.map((line) => (
          <li
            key={`${line.productId}-${line.variantId ?? ""}`}
            className="flex gap-3 border-b border-line py-4 first:pt-0"
          >
            <Link
              href={`/product/${line.slug}`}
              className="relative size-[88px] shrink-0 overflow-hidden rounded-sm bg-surface"
            >
              <Image
                src={line.image}
                alt={line.title}
                fill
                sizes="88px"
                loading="lazy"
                className="object-cover"
              />
            </Link>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-start gap-2">
                <Link href={`/product/${line.slug}`} className="min-w-0 flex-1">
                  <p className="clamp-2 text-caption leading-snug text-ink">
                    {line.title}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    removeItem(line.productId, line.variantId);
                    toast(copy.cart.removed);
                  }}
                  aria-label={`${copy.cart.remove} — ${line.title}`}
                  className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-sale"
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>

              {line.variantLabel && (
                <p className="text-micro text-muted">{line.variantLabel}</p>
              )}

              <Price
                price={line.unitPrice}
                oldPrice={line.oldUnitPrice}
                size="row"
              />

              <div className="mt-1 flex items-center justify-between gap-3">
                <QtyStepper
                  size="sm"
                  value={line.qty}
                  max={line.maxQty}
                  onChange={(qty) => setQty(line.productId, line.variantId, qty)}
                />
                {/* Line subtotal — shown only when it differs from the unit
                    price, so single-quantity rows aren't cluttered. */}
                {line.qty > 1 && (
                  <span className="tnum text-caption font-semibold text-ink">
                    {formatTaka(line.lineTotal)}
                  </span>
                )}
              </div>

              {line.adjusted && (
                <p className="text-micro text-warn">
                  Quantity reduced — only {line.maxQty} left in stock.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-body text-muted">{copy.cart.subtotal}</span>
        <span className="tnum text-title font-semibold text-ink">
          {formatTaka(subtotal)}
        </span>
      </div>
      <p className="mt-1 text-caption text-muted">{copy.cart.deliveryNote}</p>

      {/* Sticky on mobile so the action is always reachable, inline on
          desktop where the whole cart fits on one screen. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-gutter py-3 pb-safe shadow-bar backdrop-blur-md md:static md:mt-6 md:border-0 md:p-0 md:shadow-none md:backdrop-blur-none">
        <div className="mx-auto max-w-[var(--container-page)]">
          <Button href="/checkout" variant="primary" size="xl" fullWidth>
            {copy.cart.checkout} · {formatTaka(subtotal)}
          </Button>
        </div>
      </div>
    </>
  );
}
