"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/lib/stores/cart-store";
import type { CartLine } from "@/types";

/**
 * Puts an abandoned basket back in the cart and sends the shopper to checkout.
 *
 * WHY THIS IS A PAGE AND NOT A REDIRECT
 * The cart lives in the browser, in localStorage. A server redirect cannot
 * write it, so something has to run on the client between the tap and the
 * checkout — this is that something, and it exists for about one frame.
 *
 * WHY IT REPLACES THE CART RATHER THAN ADDING TO IT
 * The customer tapped a message about one specific basket. Merging it with
 * whatever was left in the cart from a previous visit would hand them an order
 * they never agreed to, at a total they find out about when a courier is
 * standing at their door asking for cash.
 *
 * The cart store persists asynchronously, so the write happens only after
 * hydration — navigating before that races the rehydration and the customer
 * arrives at an empty checkout.
 */
export function ResumeCheckout({
  lines,
  couponCode,
}: {
  lines: CartLine[];
  couponCode: string;
}) {
  const router = useRouter();
  const hydrated = useCartStore((state) => state.hydrated);
  const replaceItems = useCartStore((state) => state.replaceItems);

  /* Once. Without this, React's development double-invoke and any re-render
     during the navigation would rewrite the cart underneath a shopper who has
     already started editing it. */
  const done = useRef(false);

  useEffect(() => {
    if (!hydrated || done.current) return;
    done.current = true;

    if (lines.length > 0) replaceItems(lines);

    /* `replace`, not `push`: Back from the checkout should return to wherever
       the customer came from, not to this page — which would rebuild the cart
       and bounce them forward again, trapping them. */
    router.replace(couponCode ? `/checkout?c=${encodeURIComponent(couponCode)}` : "/checkout");
  }, [hydrated, lines, replaceItems, router, couponCode]);

  return (
    <p className="py-16 text-center text-body text-muted" role="status">
      Opening your checkout session…
    </p>
  );
}
