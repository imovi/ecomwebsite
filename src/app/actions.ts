"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { ApiError, ApiUnavailableError, apiRequest } from "@/lib/api/client";
import { PLACEHOLDER_IMAGE } from "@/lib/api/adapters";
import type {
  ApiDeliveryZone,
  ApiOrderConfirmation,
  ApiOrderTracking,
  ApiProduct,
  ApiQuote,
} from "@/lib/api/types";

/**
 * Storefront server actions.
 *
 * The browser never talks to the API directly — these run on the Next server,
 * which means the backend can sit on a private network and no API credential
 * ever reaches the client.
 *
 * Nothing here trusts a price. The cart sends product ids, variant ids and
 * quantities; the API resolves prices from the catalogue and computes the
 * totals. There is no field in any of these payloads that can influence what a
 * customer is charged.
 */

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

export interface CartLineInput {
  productId: string;
  variantId?: string | undefined;
  qty: number;
}

/** Maps a cart line onto the API's item shape. */
function toApiItems(lines: CartLineInput[]) {
  return lines.map((line) => ({
    productId: line.productId,
    ...(line.variantId ? { variantId: line.variantId } : {}),
    quantity: line.qty,
  }));
}

/**
 * Turns any thrown error into a message safe to show a shopper.
 *
 * Validation and conflict errors from the API are already written for humans —
 * "Only 2 of X are left" is exactly what the customer needs. Anything else
 * becomes a generic message, because the alternative is leaking a stack trace
 * or a connection string onto the checkout page.
 */
function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500) return error.message;
    return "Something went wrong on our side. Please try again in a moment.";
  }

  if (error instanceof ApiUnavailableError) {
    return "We could not reach our system. Please check your connection and try again.";
  }

  return "Something went wrong. Please try again.";
}

/** Field-level errors, so the checkout form can highlight the right input. */
function toFieldError(error: unknown): { field?: string; message: string } {
  if (error instanceof ApiError && error.details?.length) {
    const first = error.details[0]!;
    /* The API namespaces paths as `body.phone`; the form knows them as `phone`. */
    return { field: first.field.replace(/^body\./, ""), message: first.message };
  }
  return { message: toUserMessage(error) };
}

/* -------------------------------------------------------------------------- */
/* Cart resolution                                                            */
/* -------------------------------------------------------------------------- */

export interface CartResolution {
  lines: ResolvedCartLine[];
  /** How many lines could not be shown, for the shopper-facing notice. */
  unavailable: number;
  /**
   * Lines the server CONFIRMED are unbuyable — deleted, unpublished, or out of
   * stock. Safe for the client to prune from the stored cart.
   *
   * Deliberately excludes lines that merely failed to resolve: a timeout or a 500
   * must never empty someone's cart.
   */
  dropped: CartLineInput[];
}

export interface ResolvedCartLine {
  productId: string;
  variantId?: string | undefined;
  qty: number;
  slug: string;
  title: string;
  sku: string;
  image: string;
  variantLabel?: string | undefined;
  unitPrice: number;
  oldUnitPrice?: number | undefined;
  lineTotal: number;
  /** Live stock ceiling for this exact variant, for the quantity stepper. */
  maxQty: number;
  /** True when the stored quantity had to be clamped, or stock hit zero. */
  adjusted: boolean;
}

/**
 * Joins the browser's cart against live catalogue data.
 *
 * WHY A SERVER ACTION RATHER THAN A CATALOGUE PROP
 * ------------------------------------------------
 * The cart lives in the browser, so a server component cannot know its contents
 * at render time. The obvious workaround — ship the whole catalogue down and
 * resolve on the client — breaks in two ways: it sends every product to every
 * shopper on every cart view, and the listing endpoint does not return real
 * variant ids, so a cart line referencing a variant would silently fail to
 * match and vanish from the cart.
 *
 * Fetching exactly the products in the cart fixes both. It is one request per
 * distinct product, typically one or two, and each is ISR-cached.
 *
 * Prices and stock always come from here, never from the browser, so a cart
 * left open for a week cannot check out at last week's price.
 */
export async function resolveCartAction(
  lines: CartLineInput[],
): Promise<CartResolution> {
  if (lines.length === 0) return { lines: [], unavailable: 0, dropped: [] };

  const productIds = [...new Set(lines.map((line) => line.productId))];

  /* Three outcomes per product, and the difference matters: `gone` means the API
     answered 404, `unreachable` means it did not answer at all. Collapsing them
     into one null — as this used to — is what made a network blip look identical
     to a deleted product, and pruning on that would empty a real cart. */
  const lookups = await Promise.all(
    productIds.map(async (id) => {
      try {
        const data = await apiRequest<{ product: ApiProduct }>(
          `/api/v1/products/${id}`,
          { revalidate: 30 },
        );
        return { id, product: data.product, gone: false };
      } catch (error) {
        const gone = error instanceof ApiError && error.isNotFound;
        return { id, product: null, gone };
      }
    }),
  );

  const byId = new Map(
    lookups
      .filter((entry): entry is typeof entry & { product: ApiProduct } => entry.product !== null)
      .map((entry) => [entry.id, entry.product]),
  );
  const goneIds = new Set(lookups.filter((entry) => entry.gone).map((entry) => entry.id));

  const resolved: ResolvedCartLine[] = [];
  const dropped: CartLineInput[] = [];
  let unavailable = 0;

  for (const line of lines) {
    const product = byId.get(line.productId);

    /* A product that has been unpublished or deleted is dropped rather than
       rendered as a broken row — the shopper cannot act on it either way. */
    if (!product) {
      unavailable++;
      /* Only reported as removable when the API actually said it is gone. On an
         outage the line stays in the cart and comes back when the API does. */
      if (goneIds.has(line.productId)) dropped.push(line);
      continue;
    }

    const variant = line.variantId
      ? product.variants.find((v) => v.id === line.variantId)
      : undefined;

    if (line.variantId && !variant) {
      /* The product answered, so this variant is genuinely gone. */
      unavailable++;
      dropped.push(line);
      continue;
    }

    const featured =
      product.images.find((image) => image.isFeatured) ?? product.images[0] ?? null;

    const maxQty = variant ? variant.stockQuantity : product.stockQuantity;
    const qty = Math.max(0, Math.min(line.qty, maxQty));
    const unitPrice = variant?.price ?? product.price;
    const oldPrice = variant?.oldPrice ?? product.oldPrice;

    resolved.push({
      productId: product.id,
      variantId: variant?.id,
      qty,
      slug: product.slug,
      title: product.name,
      sku: variant?.sku ?? product.sku,
      image: variant?.imageUrl ?? featured?.url ?? PLACEHOLDER_IMAGE,
      variantLabel: variant
        ? Object.values(variant.options).filter(Boolean).join(" · ") || undefined
        : undefined,
      unitPrice,
      oldUnitPrice: oldPrice ?? undefined,
      lineTotal: unitPrice * qty,
      maxQty,
      adjusted: qty !== line.qty,
    });

    /* Resolved to zero: in stock terms the shopper cannot buy it. Reported as
       removable so the header badge stops counting something the cart page will
       not show — the mismatch that made the badge read "1" over an empty cart. */
    if (qty === 0) dropped.push(line);
  }

  return { lines: resolved, unavailable, dropped };
}

/* -------------------------------------------------------------------------- */
/* Quote                                                                      */
/* -------------------------------------------------------------------------- */

export interface QuoteResult {
  ok: boolean;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  deliveryZone: ApiDeliveryZone | null;
  zoneInferred: boolean;
  zoneMatchedOn: string | null;
  amountToFreeDelivery: number;
  error?: string;
}

/**
 * Prices a cart without committing anything.
 *
 * The delivery charge shown at checkout comes from here rather than from a
 * local calculation, so the figure the shopper sees is the one the API will
 * charge. It is recomputed server-side again at placement, so a stale quote
 * cannot become a wrong order.
 */
export async function quoteAction(input: {
  lines: CartLineInput[];
  areaText?: string;
  deliveryZone?: ApiDeliveryZone;
}): Promise<QuoteResult> {
  const empty: QuoteResult = {
    ok: false,
    subtotal: 0,
    deliveryCharge: 0,
    grandTotal: 0,
    deliveryZone: null,
    zoneInferred: false,
    zoneMatchedOn: null,
    amountToFreeDelivery: 0,
  };

  if (input.lines.length === 0) return { ...empty, error: "Your cart is empty." };

  try {
    /* The shopper's address, for the same reason the order call sends it: the
       quote limiter is 120 in fifteen minutes, and without this every shopper
       on the site is drawing from that one allowance. The checkout page
       re-quotes on load and on every address change, so a few dozen shoppers
       in a quarter of an hour was enough to start answering the whole shop
       with "too many requests" at the last step before the sale. */
    const quote = await apiRequest<ApiQuote>("/api/v1/checkout/quote", {
      method: "POST",
      body: {
        items: toApiItems(input.lines),
        ...(input.areaText ? { areaText: input.areaText } : {}),
        ...(input.deliveryZone ? { deliveryZone: input.deliveryZone } : {}),
      },
      headers: forwardClientHints(await headers()),
    });

    return {
      ok: true,
      subtotal: quote.subtotal,
      deliveryCharge: quote.deliveryCharge,
      grandTotal: quote.grandTotal,
      deliveryZone: quote.deliveryZone,
      zoneInferred: quote.zoneInferred,
      zoneMatchedOn: quote.zoneMatchedOn,
      amountToFreeDelivery: quote.amountToFreeDelivery,
    };
  } catch (error) {
    return { ...empty, error: toUserMessage(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Incomplete checkout                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Records a checkout that has a phone number but no order behind it yet.
 *
 * Fire-and-forget by design. This runs while the customer is still typing, and
 * nothing about it may interrupt them: it returns nothing, it never throws, and
 * a failure is silent. A shopper must never see an error from a background save
 * they did not ask for — that would cost a real order to protect a lead.
 *
 * The record closes itself when the order arrives, so a customer who simply
 * takes a minute to finish is never called about it.
 */
export async function recordIncompleteCheckoutAction(input: {
  phone: string;
  customerName?: string;
  address?: string;
  areaText?: string;
  deliveryZone?: ApiDeliveryZone;
  lines: CartLineInput[];
}): Promise<void> {
  try {
    await apiRequest("/api/v1/checkout/incomplete", {
      method: "POST",
      body: {
        phone: input.phone,
        ...(input.customerName ? { customerName: input.customerName } : {}),
        ...(input.address ? { address: input.address } : {}),
        ...(input.areaText ? { areaText: input.areaText } : {}),
        ...(input.deliveryZone ? { deliveryZone: input.deliveryZone } : {}),
        items: toApiItems(input.lines),
      },
    });
  } catch {
    /* Deliberately swallowed — see above. */
  }
}

/* -------------------------------------------------------------------------- */
/* Place order                                                                */
/* -------------------------------------------------------------------------- */

export interface CheckoutInput {
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  deliveryZone: ApiDeliveryZone;
  lines: CartLineInput[];
  customerNote?: string | undefined;
  /**
   * Generated by the browser and kept stable across retries of one checkout
   * attempt, so a dropped connection cannot create two orders.
   */
  idempotencyKey?: string | undefined;
}

export type CheckoutResult =
  | { ok: true; order: ApiOrderConfirmation }
  | { ok: false; error: string; field?: string };

export async function placeOrderAction(input: CheckoutInput): Promise<CheckoutResult> {
  if (input.lines.length === 0) {
    return { ok: false, error: "There's nothing to check out." };
  }

  const requestHeaders = await headers();

  try {
    const result = await apiRequest<{ order: ApiOrderConfirmation; replayed?: boolean }>(
      "/api/v1/checkout/order",
      {
        method: "POST",
        body: {
          customerName: input.customerName,
          phone: input.phone,
          address: input.address,
          areaText: input.areaText,
          deliveryZone: input.deliveryZone,
          items: toApiItems(input.lines),
          ...(input.customerNote ? { customerNote: input.customerNote } : {}),
        },
        headers: {
          "idempotency-key": input.idempotencyKey ?? randomUUID(),
          /* Forwarded so the API records the shopper's address rather than
             this server's, which matters for the fraud signals on a
             cash-on-delivery order. */
          ...forwardClientHints(requestHeaders),
        },
      },
    );

    const order = result.order;

    /*
     * The Meta Purchase event is NOT sent from here.
     *
     * The API emits it, from the same transaction boundary that created the
     * order, using the Conversions API token stored in its own settings. Three
     * reasons that is the right place:
     *
     *   - the token stays in one process and never has to be handed to this
     *     server, so there is no second copy to leak or rotate;
     *   - it is configurable from the admin dashboard, because that is where the
     *     settings row lives;
     *   - a replayed idempotent order does not re-emit `order.created`, so a
     *     duplicate submission cannot double-count a sale.
     *
     * Browser-side engagement events (ViewContent, AddToCart,
     * InitiateCheckout) still come from the pixel — see `lib/analytics/events`.
     */

    /* The full confirmation goes back to the client, which stashes it for the
       success page. That keeps the confirmation screen informative without
       needing a public order-lookup endpoint. */
    return { ok: true, order };
  } catch (error) {
    const { field, message } = toFieldError(error);
    return { ok: false, error: message, ...(field ? { field } : {}) };
  }
}

/** The shopper's IP and user agent, for the API's audit trail and for Meta. */
function forwardClientHints(requestHeaders: Headers): Record<string, string> {
  const forwarded: Record<string, string> = {};

  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    undefined;

  if (ip) {
    forwarded["x-forwarded-for"] = ip;
    /**
     * The same address again, under a name only this pair of services uses.
     *
     * The API's public rate limiters key on this. They cannot key on the
     * connection, because every shopper reaches the API through this server
     * and would share one bucket; and keying on `x-forwarded-for` alone would
     * make the limit depend on `TRUST_PROXY_HOPS` being right, which is a
     * setting that fails silently and turns a per-visitor limit into a
     * shop-wide one. The API honours this header only from a caller on the
     * private network.
     */
    forwarded["x-customer-ip"] = ip;
  }

  const userAgent = requestHeaders.get("user-agent");
  if (userAgent) forwarded["user-agent"] = userAgent;

  return forwarded;
}

/* -------------------------------------------------------------------------- */
/* Track order                                                                */
/* -------------------------------------------------------------------------- */

export type TrackOrderResult =
  | { ok: true; order: ApiOrderTracking }
  | { ok: false; error: string };

/**
 * Looks up an order for a customer.
 *
 * Requires both the order number and the phone it was placed with. The API
 * returns an identical response for "no such order" and "wrong phone", so this
 * cannot be used to discover which order numbers exist.
 */
export async function trackOrderAction(
  orderNumber: string,
  phone: string,
): Promise<TrackOrderResult> {
  if (!orderNumber.trim() || !phone.trim()) {
    return { ok: false, error: "Enter both your order ID and phone number." };
  }

  try {
    const data = await apiRequest<{ order: ApiOrderTracking }>(
      "/api/v1/storefront/track-order",
      { method: "POST", body: { orderNumber: orderNumber.trim(), phone: phone.trim() } },
    );
    return { ok: true, order: data.order };
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) {
      return { ok: false, error: "No order found with that ID and phone number." };
    }
    return { ok: false, error: toUserMessage(error) };
  }
}
