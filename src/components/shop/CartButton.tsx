"use client";

import Link from "next/link";
import { useCartCount } from "@/lib/stores/cart-store";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

/**
 * The count comes from a persisted store, so it is 0 on the server and during
 * the first client render (see `useCartCount`). Rendering the badge only after
 * hydration avoids a mismatch, at the cost of the badge appearing a frame late
 * — which is invisible in practice and strictly better than a hydration error.
 */
export function CartButton() {
  const count = useCartCount();

  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `${copy.nav.cart}, ${copy.cart.itemCount(count)}` : copy.nav.cart}
      className="relative flex size-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface"
    >
      <Icon name="cart" size={21} />
      {count > 0 && (
        <span className="tnum absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sale px-1 text-micro font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
