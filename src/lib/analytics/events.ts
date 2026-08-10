"use client";

/**
 * Browser-side commerce events.
 *
 * Each function reports the same shopper action to two places at once:
 *
 *   - the **Meta Pixel** via `fbq`, using Meta's event names and field shapes;
 *   - the **`dataLayer`** for Google Tag Manager, using GA4's recommended
 *     ecommerce names (`view_item`, `add_to_cart`, …) so a GA4 tag configured in
 *     GTM works with no custom mapping.
 *
 * One function per action rather than two parallel APIs, because the failure mode
 * of the alternative is a call site that remembers one and forgets the other —
 * and a funnel with a hole in it is worse than no funnel.
 *
 * Only engagement events live here. Purchase is different: for Meta it is sent by
 * the API (a conversion that decides ad spend must not depend on a script
 * surviving an ad blocker), while GTM has no server-side counterpart and so gets
 * its `purchase` push from the confirmation page — see `trackPurchaseView`.
 *
 * Every function is a no-op when the relevant script has not loaded, so a blocked
 * script or an unconfigured environment can never turn an "add to cart" tap into
 * a client-side crash.
 */

type FbqArgs = [track: string, event: string, data?: Record<string, unknown>];

declare global {
  interface Window {
    fbq?: (...args: FbqArgs) => void;
    dataLayer?: Record<string, unknown>[];
  }
}

/**
 * Events waiting for the pixel to exist.
 *
 * THE BUG THIS FIXES
 * ------------------
 * This function used to return early when `window.fbq` was undefined, and that
 * silently threw the event away. It looked harmless — the pixel loads on every
 * page, so surely it is there — but the pixel is a third-party script loaded
 * `afterInteractive`, while these calls come from React effects that run at
 * hydration. The effect usually wins the race, and the event is destroyed.
 *
 * It was not a rare edge. Measured against the live shop: 1,362 people clicked
 * through from an ad and Meta recorded 39 ViewContent — under 3%. Meta's own
 * PageView-derived metric, which fires from INSIDE the pixel snippet and so
 * cannot lose this race, recorded 85% of clicks over the same period. That gap
 * is the race, and nothing else.
 *
 * What it cost: the campaign optimises for ViewContent. Meta was learning from
 * thirty-nine data points instead of thirteen hundred, and the reported cost
 * per result was inflated by the same factor.
 *
 * THE FIX
 * -------
 * Hold the event until the pixel arrives, then send it. This is exactly what
 * `fireGoogle` already gets for free: `dataLayer` is an ordinary array that
 * exists before GTM does, and GTM drains whatever it finds. Meta's snippet has
 * the same design — `fbq` is a stub with its own queue — but only once the
 * snippet has run, and that is the window this closes.
 */
interface PendingEvent {
  event: string;
  data?: Record<string, unknown> | undefined;
}

const pending: PendingEvent[] = [];
let waiting: ReturnType<typeof setInterval> | null = null;
let deadline = 0;

/**
 * The pixel was waited for and never came, so stop waiting for it again.
 *
 * Without this, a visitor with an ad blocker — where `fbq` never appears at all
 * — starts a FRESH thirty-second poll on every tracked interaction, one after
 * another for the whole visit. That would be worse than the silent drop this
 * change replaces, and worse for exactly the traffic that was already giving us
 * nothing. Sending is unaffected: if the pixel does turn up later, the ready
 * branch still fires normally. Only the buffering gives up.
 */
let abandoned = false;

/**
 * How long to keep holding events.
 *
 * Generous, because the visitor this matters most for is on a slow phone where
 * the pixel takes seconds to arrive — cutting it short would drop exactly the
 * traffic the fix is for. Bounded all the same: a blocked pixel never arrives,
 * and a timer that runs for the life of the page is a leak.
 */
const WAIT_TIMEOUT_MS = 30_000;
const WAIT_INTERVAL_MS = 200;

/**
 * A cap, so a page that somehow fires hundreds of events without a pixel cannot
 * grow this without limit. Real pages queue one or two.
 */
const MAX_PENDING = 20;

function pixelReady(): boolean {
  return typeof window !== "undefined" && typeof window.fbq === "function";
}

function send(event: string, data?: Record<string, unknown>): void {
  try {
    window.fbq?.("track", event, data);
  } catch {
    /* Analytics must never break a purchase flow. */
  }
}

function stopWaiting(): void {
  if (waiting === null) return;
  clearInterval(waiting);
  waiting = null;
}

/** Sends everything held, oldest first, so the funnel keeps its order. */
function flushPending(): void {
  while (pending.length > 0) {
    const queued = pending.shift();
    if (queued) send(queued.event, queued.data);
  }
}

function startWaiting(): void {
  /* Pushed forward by every new event, not fixed when the first one arrives.
     Sharing one clock across a queuing episode would give the LAST event the
     least grace — an AddToCart queued at twenty-nine seconds would get one, and
     be discarded — which is backwards: the later event is the one closer to a
     sale. Each event is owed the full wait. */
  deadline = Date.now() + WAIT_TIMEOUT_MS;

  if (waiting !== null) return;

  waiting = setInterval(() => {
    if (pixelReady()) {
      stopWaiting();
      flushPending();
      return;
    }

    if (Date.now() >= deadline) {
      /* The pixel is blocked or absent — an ad blocker, or a shop with no
         pixel configured at all. Let the events go rather than hold a timer
         and a list for the rest of the visit, and do not arm this again. */
      stopWaiting();
      pending.length = 0;
      abandoned = true;
    }
  }, WAIT_INTERVAL_MS);
}

function fireMeta(event: string, data?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;

  if (pixelReady()) {
    /* Anything held from before the pixel arrived goes first — an AddToCart
       must not overtake the ViewContent that preceded it. */
    stopWaiting();
    flushPending();
    send(event, data);
    return;
  }

  /* Waited once, nothing came. Drop as the old code did rather than start
     another poll — see `abandoned`. */
  if (abandoned) return;

  if (pending.length >= MAX_PENDING) return;
  pending.push({ event, data });
  startWaiting();
}

/**
 * Pushes onto the GTM data layer.
 *
 * The array is created if absent so a push that happens before GTM's script has
 * loaded is not lost — GTM replays whatever it finds on startup. That also means
 * this works, harmlessly, when GTM is not configured at all: the events queue in
 * an array nobody reads.
 */
function fireGoogle(event: string, data?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;

  try {
    window.dataLayer = window.dataLayer ?? [];
    /* `ecommerce: null` first clears the previous event's object. Without it GA4
       merges the old items array into the new event and reports phantom
       products — the single most common GTM ecommerce bug. */
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event, ...(data ?? {}) });
  } catch {
    /* Same contract as Meta: never break the flow. */
  }
}

export interface TrackedProduct {
  sku: string;
  title: string;
  price: number;
  quantity?: number;
}

/** GA4 item shape. `item_id` is the SKU, matching Meta's `content_ids`. */
function toGa4Item(product: TrackedProduct, quantity = 1) {
  return {
    item_id: product.sku,
    item_name: product.title,
    price: product.price,
    quantity,
  };
}

/** Product detail view. */
export function trackViewContent(product: TrackedProduct): void {
  fireMeta("ViewContent", {
    content_type: "product",
    content_ids: [product.sku],
    content_name: product.title,
    currency: "BDT",
    value: product.price,
  });

  fireGoogle("view_item", {
    ecommerce: {
      currency: "BDT",
      value: product.price,
      items: [toGa4Item(product)],
    },
  });
}

export function trackAddToCart(product: TrackedProduct): void {
  const quantity = product.quantity ?? 1;

  fireMeta("AddToCart", {
    content_type: "product",
    content_ids: [product.sku],
    content_name: product.title,
    currency: "BDT",
    value: product.price * quantity,
    contents: [{ id: product.sku, quantity }],
  });

  fireGoogle("add_to_cart", {
    ecommerce: {
      currency: "BDT",
      value: product.price * quantity,
      items: [toGa4Item(product, quantity)],
    },
  });
}

/**
 * Reaching the checkout page.
 *
 * Together with Purchase, this is what lets both platforms report a
 * checkout-to-purchase rate — the number that tells you whether the ad or the
 * checkout is the problem.
 */
export function trackInitiateCheckout(input: {
  value: number;
  /** `sku` must be the real SKU — every other event in the funnel matches on it. */
  items: { sku: string; title?: string; quantity: number }[];
}): void {
  fireMeta("InitiateCheckout", {
    content_type: "product",
    content_ids: input.items.map((item) => item.sku),
    currency: "BDT",
    value: input.value,
    num_items: input.items.reduce((sum, item) => sum + item.quantity, 0),
    contents: input.items.map((item) => ({ id: item.sku, quantity: item.quantity })),
  });

  fireGoogle("begin_checkout", {
    ecommerce: {
      currency: "BDT",
      value: input.value,
      items: input.items.map((item) => ({
        item_id: item.sku,
        ...(item.title ? { item_name: item.title } : {}),
        quantity: item.quantity,
      })),
    },
  });
}

export function trackSearch(term: string): void {
  fireMeta("Search", { search_string: term });
  fireGoogle("search", { search_term: term });
}

/**
 * Purchase, for Google only.
 *
 * Meta's Purchase is sent by the API and must NOT be duplicated here — the
 * deduplication key would not match a browser-side send, so Facebook would count
 * the sale twice.
 *
 * GTM has no server-side path in this system, so its `purchase` event has to come
 * from the confirmation page. That page is reachable by refresh and by a shared
 * link, so the send is guarded by a per-order marker in `sessionStorage`:
 * without it, one refresh becomes two conversions and the reported revenue drifts
 * upward for the rest of the campaign.
 */
export function trackPurchaseView(input: {
  orderNumber: string;
  value: number;
  shipping: number;
  items: { sku: string; title: string; price: number; quantity: number }[];
}): void {
  if (typeof window === "undefined") return;

  const marker = `gng_purchase_reported:${input.orderNumber}`;

  try {
    if (window.sessionStorage.getItem(marker)) return;
    window.sessionStorage.setItem(marker, "1");
  } catch {
    /* Private mode can throw on sessionStorage. Reporting once too often beats
       never reporting at all, so fall through rather than returning. */
  }

  fireGoogle("purchase", {
    ecommerce: {
      transaction_id: input.orderNumber,
      currency: "BDT",
      value: input.value,
      shipping: input.shipping,
      items: input.items.map((item) => ({
        item_id: item.sku,
        item_name: item.title,
        price: item.price,
        quantity: item.quantity,
      })),
    },
  });
}
