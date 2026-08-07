"use client";

import { useEffect, useRef, useState } from "react";
import { resolveCartAction, type ResolvedCartLine } from "@/app/actions";
import { useCartStore } from "@/lib/stores/cart-store";
import type { CartLine } from "@/types";

/**
 * Joins the browser's cart against live catalogue data.
 *
 * The cart stores only `{ productId, variantId, qty }`. Everything a shopper
 * sees — name, image, price, stock ceiling — is fetched fresh from the server on
 * every cart view, so a cart left open for a week shows today's prices and
 * today's availability rather than a stale snapshot.
 *
 * IT ALSO PRUNES
 * --------------
 * The header badge counts the STORED lines, while this hook decides what the cart
 * page renders. When resolution dropped a line and the store kept it, the badge
 * read "1" over an empty cart. Lines the server confirms are unbuyable are
 * therefore removed from the store here, so the two can no longer disagree.
 *
 * Only confirmed-unbuyable lines: `resolveCartAction` deliberately does not report
 * a line that merely failed to load, so an API outage cannot empty a real cart.
 *
 * Keyed on the cart CONTENTS rather than the array identity, so a re-render does
 * not trigger a refetch but changing a quantity does.
 */

/**
 * How long a quantity change settles before the server is asked about it.
 *
 * The stepper reports every tap immediately — it must, or the number under the
 * customer's finger would lag — and the cart key includes the quantity, so
 * without this each tap was its own round trip. Going from one to five sent five
 * resolutions, each of them a request per distinct product in the cart, and a
 * customer adjusting quantities does that on the two pages where the server is
 * already busiest.
 *
 * Long enough to swallow a run of taps, short enough that a deliberate single
 * change still feels immediate.
 */
const SETTLE_MS = 350;

export function useResolvedCart(lines: CartLine[], enabled = true) {
  const removeLines = useCartStore((s) => s.removeLines);

  const [resolved, setResolved] = useState<ResolvedCartLine[]>([]);
  /** Lines actually taken out of the cart, because the server said they are gone. */
  const [removed, setRemoved] = useState(0);
  /**
   * Lines that could not be loaded at all and are STILL in the cart.
   *
   * Kept apart from `removed` because the honest message differs: "no longer
   * available" is a lie when the API simply timed out, and it tells a shopper to
   * give up on an item that will be back on the next refresh.
   */
  const [unloadable, setUnloadable] = useState(0);
  const [loading, setLoading] = useState(true);

  const cartKey = lines
    .map((line) => `${line.productId}:${line.variantId ?? ""}:${line.qty}`)
    .join("|");

  /* The first resolution is what the page renders from, so it must not wait.
     Only CHANGES are worth settling — those come from a stepper being tapped. */
  const settled = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    if (lines.length === 0) {
      /* An emptied cart must clear immediately rather than keep rendering the
         last resolved lines. Synchronous on purpose: deferring it would leave
         removed items on screen for a frame. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolved([]);
      setRemoved(0);
      setUnloadable(0);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const resolve = () => {
      void resolveCartAction(
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          qty: line.qty,
        })),
      ).then((result) => {
        if (cancelled) return;

        /* Zero-quantity lines mean the item sold out entirely while the cart sat
           open; they leave the display and are reported as removed. */
        setResolved(result.lines.filter((line) => line.qty > 0));
        setRemoved(result.dropped.length);
        /* Whatever `unavailable` counted beyond what was dropped could not be
           reached — those lines stay in the cart. */
        setUnloadable(Math.max(0, result.unavailable - result.dropped.length));
        setLoading(false);

        /* Bring the stored cart in line with what is actually buyable. Called after
           the state updates above so the shopper still sees the "removed" notice on
           this view rather than the cart silently shrinking under them. */
        if (result.dropped.length > 0) removeLines(result.dropped);
      });
    };

    if (!settled.current) {
      settled.current = true;
      resolve();
      return () => {
        cancelled = true;
      };
    }

    /* A change. The previous figures stay on screen while this settles, which is
       what the display already did during a fetch — the alternative is the cart
       total flickering to a skeleton on every tap of the stepper. */
    const timer = setTimeout(resolve, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    /* Intentionally keyed on the serialised contents, not the array. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, enabled]);

  const subtotal = resolved.reduce((sum, line) => sum + line.lineTotal, 0);
  const count = resolved.reduce((sum, line) => sum + line.qty, 0);

  return { lines: resolved, removed, unloadable, loading, subtotal, count };
}
