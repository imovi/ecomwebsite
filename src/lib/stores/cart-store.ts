"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CartLine } from "@/types";

/**
 * Cart state.
 *
 * Two deliberate design points:
 *
 * 1. Lines store only `{ productId, variantId, qty }`. Prices are re-resolved
 *    from the catalog on every render and re-validated again server-side at
 *    order placement, so a cart that sat in localStorage for a month can never
 *    buy at last month's price.
 *
 * 2. Buy Now writes to a SEPARATE slice, never to `items`. If it merged into
 *    the cart, backing out of checkout would silently leave the product behind
 *    in the customer's cart — a classic source of accidental double orders.
 *
 * 3. That slice is SAVED, not merely held in memory. It used to live only in
 *    memory, on the reasoning that it belongs to one checkout attempt rather
 *    than to the customer's saved state — true as far as it goes, but it made
 *    reloading the checkout page empty it. On a phone that is not an edge case:
 *    switching to another app to copy an address is enough for the browser to
 *    drop the tab and reload it on return, and the customer came back to "Your
 *    cart is empty" with the product they were buying gone. The contact details
 *    beside it were already saved for exactly this reason; the thing being
 *    bought was not.
 */

/**
 * How long a saved Buy Now stays valid.
 *
 * Long enough to survive a reload, a phone call, or sleeping on it; short
 * enough that an abandoned express checkout does not reappear on a visit weeks
 * later attached to a product they have forgotten choosing.
 */
const BUY_NOW_TTL_MS = 24 * 60 * 60 * 1000;

interface CartState {
  items: CartLine[];
  /** Single-line "buy this one thing now" purchase, outside the cart. */
  buyNow: CartLine | null;
  /** When `buyNow` was set, so a stale one can be dropped on load. */
  buyNowAt: number | null;
  /** False until localStorage has been read. Guards against hydration drift. */
  hydrated: boolean;

  addItem: (line: CartLine, maxQty?: number) => void;
  setQty: (productId: string, variantId: string | undefined, qty: number) => void;
  removeItem: (productId: string, variantId: string | undefined) => void;
  /**
   * Drops several lines at once, for lines the server has confirmed are
   * unbuyable.
   *
   * Bulk rather than a loop of `removeItem` because each `set` is a separate
   * render and a separate localStorage write; more importantly, a loop would let
   * a re-render observe a half-pruned cart.
   */
  removeLines: (lines: { productId: string; variantId?: string | undefined }[]) => void;
  /**
   * Swaps the whole cart for a known-good set of lines.
   *
   * For resuming an abandoned checkout from a WhatsApp link. Replaces rather
   * than merges: the customer tapped a link about one specific basket, and
   * quietly adding it to whatever else was in the cart from three days ago
   * would hand them an order they did not agree to at a total they did not
   * expect — on cash on delivery, at the door.
   */
  replaceItems: (lines: CartLine[]) => void;
  clear: () => void;

  startBuyNow: (line: CartLine) => void;
  clearBuyNow: () => void;
}

const sameLine = (a: CartLine, b: CartLine) =>
  a.productId === b.productId && a.variantId === b.variantId;

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      buyNow: null,
      buyNowAt: null,
      hydrated: false,

      addItem: (line, maxQty = 99) =>
        set((state) => {
          const existing = state.items.find((l) => sameLine(l, line));
          if (existing) {
            return {
              items: state.items.map((l) =>
                sameLine(l, line)
                  ? { ...l, qty: Math.min(l.qty + line.qty, maxQty) }
                  : l,
              ),
            };
          }
          return { items: [...state.items, { ...line, qty: Math.min(line.qty, maxQty) }] };
        }),

      setQty: (productId, variantId, qty) =>
        set((state) => ({
          items:
            qty <= 0
              ? state.items.filter(
                  (l) => !sameLine(l, { productId, variantId, qty: 0 }),
                )
              : state.items.map((l) =>
                  sameLine(l, { productId, variantId, qty: 0 }) ? { ...l, qty } : l,
                ),
        })),

      removeItem: (productId, variantId) =>
        set((state) => ({
          items: state.items.filter(
            (l) => !sameLine(l, { productId, variantId, qty: 0 }),
          ),
        })),

      removeLines: (lines) =>
        set((state) => {
          if (lines.length === 0) return state;

          const doomed = new Set(
            lines.map((l) => `${l.productId}::${l.variantId ?? ""}`),
          );
          const items = state.items.filter(
            (l) => !doomed.has(`${l.productId}::${l.variantId ?? ""}`),
          );

          /* Returning the same array when nothing matched keeps subscribers from
             re-rendering on a no-op prune, which happens on every cart view once
             the cart is clean. */
          return items.length === state.items.length ? state : { items };
        }),

      replaceItems: (lines) => set({ items: lines.filter((line) => line.qty > 0) }),

      clear: () => set({ items: [] }),

      startBuyNow: (line) => set({ buyNow: line, buyNowAt: Date.now() }),
      clearBuyNow: () => set({ buyNow: null, buyNowAt: null }),
    }),
    {
      name: "gng-cart-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        buyNow: state.buyNow,
        buyNowAt: state.buyNowAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        /* Checked here rather than when it is read: load is the one moment a
           stale value can appear, and doing it once means every reader sees
           the same answer without repeating the rule. */
        const expired =
          state.buyNow !== null &&
          (state.buyNowAt === null || Date.now() - state.buyNowAt > BUY_NOW_TTL_MS);

        if (expired) {
          state.buyNow = null;
          state.buyNowAt = null;
        }

        state.hydrated = true;
      },
    },
  ),
);

/** Total units in the cart. Returns 0 until hydrated so SSR and the first
 *  client render agree. */
export function useCartCount(): number {
  return useCartStore((s) =>
    s.hydrated ? s.items.reduce((sum, l) => sum + l.qty, 0) : 0,
  );
}
