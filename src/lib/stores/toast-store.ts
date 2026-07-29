"use client";

import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  tone: "default" | "positive" | "error";
  /** Optional single action, e.g. "View cart" after Add to Cart. */
  action?: { label: string; href: string };
}

interface ToastState {
  toasts: Toast[];
  show: (toast: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/**
 * A store rather than a React context so any component — including ones deep
 * inside server-rendered trees — can fire a toast without provider plumbing.
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: ({ message, tone = "default", action }) => {
    const id = nextId++;
    // Only ever one toast on screen; a second Add to Cart replaces the first
    // rather than stacking a tower of notifications over the buy bar.
    set({ toasts: [{ id, message, tone, action }] });
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 2800);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience so call sites read as `toast("Added to cart")`. */
export function toast(
  message: string,
  options?: { tone?: Toast["tone"]; action?: Toast["action"] },
) {
  useToastStore.getState().show({ message, ...options });
}
