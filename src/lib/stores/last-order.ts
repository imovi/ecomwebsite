"use client";

import type { ApiOrderConfirmation } from "@/lib/api/types";

/**
 * The just-placed order, held for the confirmation screen.
 *
 * WHY sessionStorage RATHER THAN A LOOKUP
 * ---------------------------------------
 * The success page wants to show what the customer bought, but there is no
 * public endpoint that returns an order from its number alone — deliberately,
 * because order numbers are sequential and a lookup keyed on one would let
 * anyone walk the sequence and read other people's orders.
 *
 * Checkout already has the full confirmation in hand, so it stashes it here and
 * the success page reads it back. Nothing sensitive crosses the network, and the
 * data lives only in this tab.
 *
 * `sessionStorage`, not `localStorage`: a confirmation is relevant for one visit
 * and should not still be sitting there next week.
 *
 * Every read is defensive. A refresh, a shared link, a browser in private mode
 * or a cleared tab all produce "no stashed order", and the page falls back to
 * showing the order number from the URL — which is the one thing the customer
 * actually needs.
 */

const KEY = "gng-last-order-v1";

export function rememberOrder(order: ApiOrderConfirmation): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* Private mode or a full quota. The success page degrades gracefully. */
  }
}

export function recallOrder(orderNumber: string): ApiOrderConfirmation | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as ApiOrderConfirmation;

    /* Only return it if it is the order actually being viewed — otherwise a
       stale stash would render the wrong order's contents under a correct
       heading, which is worse than showing nothing. */
    return parsed.orderNumber === orderNumber ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetOrder(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Nothing to do. */
  }
}
