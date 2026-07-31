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
 */

interface CartState {
  items: CartLine[];
  /** Ephemeral single-line "buy this one thing now" purchase. */
  buyNow: CartLine | null;
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

      clear: () => set({ items: [] }),

      startBuyNow: (line) => set({ buyNow: line }),
      clearBuyNow: () => set({ buyNow: null }),
    }),
    {
      name: "gng-cart-v1",
      storage: createJSONStorage(() => localStorage),
      // buyNow is intentionally not persisted: it belongs to one checkout
      // attempt, not to the customer's saved state.
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
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
