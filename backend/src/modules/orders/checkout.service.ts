import { inArray } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { products, type ProductRow } from "../../db/schema/products.js";
import { productVariants, type ProductVariantRow } from "../../db/schema/product-variants.js";
import { productImages } from "../../db/schema/product-images.js";
import { BadRequestError, ConflictError, ValidationError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { markRecovered } from "./abandoned.service.js";
import { orderEvents as orderEventBus } from "../../lib/events/order-events.js";
import { suggestDeliveryZone } from "../../lib/geo/delivery-zone.js";
import { calculateTotals, getSettings } from "../settings/settings.service.js";
import {
  findOrderByIdempotencyKey,
  findRecentOrdersByPhone,
  insertOrder,
  insertOrderItems,
  listOrderItems,
  nextOrderNumber,
} from "./order.repository.js";
import { recordEvent, CUSTOMER_ACTOR } from "./order-event.repository.js";
import { reserveStock, syncSimpleProductStatus, type StockLine } from "./stock.service.js";
import { toOrderConfirmationDto, type OrderConfirmationDto } from "./order.types.js";
import type { PlaceOrderInput, QuoteInput } from "./order.validation.js";
import type { DeliveryZone } from "../../db/schema/order-enums.js";

/**
 * Checkout — the public, unauthenticated write path.
 *
 * Two rules govern everything here:
 *
 * 1. **Nothing about money comes from the client.** Prices are read from the
 *    catalogue inside the transaction, totals are computed from those prices
 *    and the settings row. The request body has no price field at all, and
 *    `.strict()` rejects one if it appears.
 *
 * 2. **Placement is one transaction.** Order, items and stock decrements
 *    commit together or not at all. A stock decrement that survives a failed
 *    order insert is inventory that has silently vanished.
 */

const log = createLogger("checkout");

/** Window in which an identical repeat submission is treated as a double-tap. */
const DUPLICATE_WINDOW_SECONDS = 120;

interface ResolvedLine {
  product: ProductRow;
  variant: ProductVariantRow | null;
  quantity: number;
  unitPrice: number;
  /**
   * What this unit costs the shop right now, or null when nobody has recorded
   * it. Captured here so it can be frozen onto the order line — see the insert.
   */
  unitCost: number | null;
  variantLabel: string | null;
  imageKey: string | null;
}

/* -------------------------------------------------------------------------- */
/* Cart resolution                                                            */
/* -------------------------------------------------------------------------- */

function variantLabelOf(variant: ProductVariantRow): string {
  const values = Object.values(variant.options).filter(Boolean);
  return values.length > 0 ? values.join(" · ") : variant.sku;
}

/**
 * Resolves cart lines against the live catalogue.
 *
 * Runs inside the caller's transaction so the prices used for the totals are
 * the prices the order is written with — reading them on a separate connection
 * leaves a window where a repricing lands between quote and insert.
 *
 * Every failure names the offending product, because "invalid cart" is
 * useless to a customer trying to fix it.
 */
async function resolveLines(
  items: { productId: string; variantId?: string | null; quantity: number }[],
  executor: DatabaseExecutor,
  options: { maxQuantityPerItem: number },
): Promise<ResolvedLine[]> {
  /* Reject duplicates up front: two lines for the same variant would each
     reserve stock independently and produce a confusing invoice. */
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const key = `${item.productId}:${item.variantId ?? ""}`;
    if (seen.has(key)) {
      throw new ValidationError([
        {
          field: `body.items[${index}]`,
          message: "This item appears twice. Combine them into a single line.",
        },
      ]);
    }
    seen.add(key);
  }

  const productIds = [...new Set(items.map((item) => item.productId))];
  const variantIds = items
    .map((item) => item.variantId)
    .filter((id): id is string => typeof id === "string");

  /* Two batched reads rather than one per line — a 20-item cart must not be
     40 round trips. */
  const [productRows, variantRows, imageRows] = await Promise.all([
    executor.select().from(products).where(inArray(products.id, productIds)),
    variantIds.length > 0
      ? executor.select().from(productVariants).where(inArray(productVariants.id, variantIds))
      : Promise.resolve([] as ProductVariantRow[]),
    executor
      .select()
      .from(productImages)
      .where(inArray(productImages.productId, productIds)),
  ]);

  const productsById = new Map(productRows.map((row) => [row.id, row]));
  const variantsById = new Map(variantRows.map((row) => [row.id, row]));

  /* Featured image, falling back to the first — matches what the storefront
     showed the customer. */
  const imageByProduct = new Map<string, string>();
  for (const image of [...imageRows].sort(
    (a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.sortOrder - b.sortOrder,
  )) {
    if (!imageByProduct.has(image.productId)) {
      imageByProduct.set(image.productId, image.storageKey);
    }
  }

  return items.map((item, index) => {
    const field = `body.items[${index}]`;
    const product = productsById.get(item.productId);

    if (!product) {
      throw new ValidationError([
        { field: `${field}.productId`, message: "This product no longer exists." },
      ]);
    }

    /* A draft or hidden product must not be purchasable by guessing its id. */
    if (product.status !== "active" || !product.isVisible) {
      throw new ValidationError([
        { field: `${field}.productId`, message: `"${product.name}" is not available for sale.` },
      ]);
    }

    if (item.quantity > options.maxQuantityPerItem) {
      throw new ValidationError([
        {
          field: `${field}.quantity`,
          message: `At most ${options.maxQuantityPerItem} of "${product.name}" per order.`,
        },
      ]);
    }

    const hasVariants = product.variantOptions.length > 0;
    let variant: ProductVariantRow | null = null;

    if (hasVariants) {
      if (!item.variantId) {
        throw new ValidationError([
          {
            field: `${field}.variantId`,
            message: `Choose an option for "${product.name}".`,
          },
        ]);
      }

      variant = variantsById.get(item.variantId) ?? null;

      if (!variant || variant.productId !== product.id) {
        throw new ValidationError([
          {
            field: `${field}.variantId`,
            message: `That option is not available for "${product.name}".`,
          },
        ]);
      }

      if (!variant.isActive) {
        throw new ValidationError([
          {
            field: `${field}.variantId`,
            message: `That option of "${product.name}" is no longer sold.`,
          },
        ]);
      }
    } else if (item.variantId) {
      throw new ValidationError([
        {
          field: `${field}.variantId`,
          message: `"${product.name}" has no options to choose.`,
        },
      ]);
    }

    /* Availability is checked here for a clear message, but the real guarantee
       is the conditional decrement in `reserveStock` — this read cannot hold
       against a concurrent checkout. */
    const available = variant ? variant.stockQuantity : product.stockQuantity;
    if (product.stockStatus === "discontinued") {
      throw new ConflictError(`"${product.name}" has been discontinued.`, ErrorCode.CONFLICT);
    }
    if (available < item.quantity) {
      throw new ConflictError(
        available === 0
          ? `"${product.name}" is out of stock.`
          : `Only ${available} of "${product.name}" ${available === 1 ? "is" : "are"} left.`,
        ErrorCode.CONFLICT,
      );
    }

    return {
      product,
      variant,
      quantity: item.quantity,
      unitPrice: variant?.price ?? product.price,
      /* Mirrors how price resolves: the variant's own cost wins, the product's
         applies otherwise. A 256 GB costs more to buy than a 128 GB, but a
         colour usually does not. */
      unitCost: variant?.costPrice ?? product.costPrice ?? null,
      variantLabel: variant ? variantLabelOf(variant) : null,
      imageKey: imageByProduct.get(product.id) ?? null,
    };
  });
}

function toStockLines(lines: ResolvedLine[]): StockLine[] {
  return lines.map((line) => ({
    productId: line.product.id,
    variantId: line.variant?.id ?? null,
    quantity: line.quantity,
    label: line.variant
      ? `${line.product.name} (${line.variantLabel ?? line.variant.sku})`
      : line.product.name,
  }));
}

/**
 * Determines the delivery zone.
 *
 * An explicit zone from the caller always wins; inference is only a
 * convenience. When neither is available the request fails rather than
 * defaulting — silently guessing "inside Dhaka" for an unrecognised area
 * undercharges every rural order.
 */
function resolveZone(
  explicit: DeliveryZone | undefined,
  areaText: string | undefined,
): { zone: DeliveryZone; inferred: boolean; matched: string | null } {
  if (explicit) return { zone: explicit, inferred: false, matched: null };

  const suggestion = areaText ? suggestDeliveryZone(areaText) : null;
  if (suggestion) {
    return { zone: suggestion.zone, inferred: true, matched: suggestion.matched };
  }

  throw new ValidationError([
    {
      field: "body.deliveryZone",
      message:
        "We could not determine your delivery area. Choose Inside Dhaka or Outside Dhaka.",
    },
  ]);
}

/* -------------------------------------------------------------------------- */
/* Quote                                                                      */
/* -------------------------------------------------------------------------- */

export interface QuoteResult {
  items: {
    productId: string;
    variantId: string | null;
    productName: string;
    variantLabel: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  deliveryZone: DeliveryZone | null;
  /** True when the zone was inferred from `areaText` rather than supplied. */
  zoneInferred: boolean;
  /** The area token matched, so a UI can show what was recognised. */
  zoneMatchedOn: string | null;
  freeDeliveryThreshold: number;
  /** How much more to spend to qualify for free delivery. 0 when it applies. */
  amountToFreeDelivery: number;
}

/**
 * Prices a cart without committing anything.
 *
 * Read-only, so it deliberately does not reserve stock — a quote is not a
 * claim on inventory. Availability is re-checked at placement.
 */
export async function quote(input: QuoteInput): Promise<QuoteResult> {
  const db = getDb();
  const settings = await getSettings(db);

  const lines = await resolveLines(input.items, db, {
    maxQuantityPerItem: settings.maxQuantityPerItem,
  });

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  /* A quote may legitimately have no zone yet — the customer is still typing. */
  let zone: DeliveryZone | null = null;
  let inferred = false;
  let matched: string | null = null;

  if (input.deliveryZone) {
    zone = input.deliveryZone;
  } else if (input.areaText) {
    const suggestion = suggestDeliveryZone(input.areaText);
    if (suggestion) {
      zone = suggestion.zone;
      inferred = true;
      matched = suggestion.matched;
    }
  }

  const totals = zone
    ? calculateTotals(settings, zone, subtotal)
    : { subtotal, deliveryCharge: 0, grandTotal: subtotal };

  return {
    items: lines.map((line) => ({
      productId: line.product.id,
      variantId: line.variant?.id ?? null,
      productName: line.product.name,
      variantLabel: line.variantLabel,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.unitPrice * line.quantity,
    })),
    subtotal: totals.subtotal,
    deliveryCharge: totals.deliveryCharge,
    grandTotal: totals.grandTotal,
    deliveryZone: zone,
    zoneInferred: inferred,
    zoneMatchedOn: matched,
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    amountToFreeDelivery:
      settings.freeDeliveryThreshold > 0 && subtotal < settings.freeDeliveryThreshold
        ? settings.freeDeliveryThreshold - subtotal
        : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Place order                                                                */
/* -------------------------------------------------------------------------- */

export interface PlaceOrderContext {
  idempotencyKey?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  /**
   * How the order reached the shop, when an operator typed it in.
   *
   * Undefined for storefront checkouts, which is what leaves the column NULL —
   * see `orders.source`. Setting it is the only thing that marks an order as
   * taken by hand.
   */
  source?: string | undefined;
  /**
   * The admin who typed it in. Undefined for storefront checkouts.
   *
   * Carries the name as well as the id because the order timeline records an
   * actor by name — an id alone would leave the one record that settles a
   * dispute saying "admin" instead of who.
   */
  createdBy?: { adminId: string; name: string } | undefined;
  /**
   * Where the order starts its life. Defaults to `pending`.
   *
   * The storefront must never pass this: a customer who checked out has not
   * been spoken to, and `pending` is precisely the state of "somebody needs to
   * ring them". An order typed in from a WhatsApp conversation is the opposite
   * case — the conversation already happened, and forcing the desk to confirm
   * an order they just agreed on the phone would make the timeline lie about
   * when it was confirmed.
   */
  initialStatus?: "pending" | "confirmed" | undefined;
}

export interface PlaceOrderResult {
  order: OrderConfirmationDto;
  /** True when an existing order was returned instead of creating a new one. */
  replayed: boolean;
}

/**
 * Creates an order.
 *
 * Everything — order header, line snapshots, stock decrements and the opening
 * timeline entry — happens in one transaction.
 */
export async function placeOrder(
  input: PlaceOrderInput,
  context: PlaceOrderContext = {},
): Promise<PlaceOrderResult> {
  /* Idempotent replay. A flaky mobile connection retrying the POST must not
     produce a second order; return the first one unchanged. */
  if (context.idempotencyKey) {
    const existing = await findOrderByIdempotencyKey(context.idempotencyKey);
    if (existing) {
      const items = await listOrderItems(existing.id);
      log.info(
        { orderNumber: existing.orderNumber },
        "Idempotent replay — returning the existing order",
      );
      return { order: toOrderConfirmationDto(existing, items), replayed: true };
    }
  }

  const { zone } = resolveZone(input.deliveryZone, input.areaText);

  const created = await getDb().transaction(async (tx) => {
    const settings = await getSettings(tx);

    const lines = await resolveLines(input.items, tx, {
      maxQuantityPerItem: settings.maxQuantityPerItem,
    });

    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

    if (settings.minimumOrderValue > 0 && subtotal < settings.minimumOrderValue) {
      throw new BadRequestError(
        `The minimum order value is ${settings.minimumOrderValue} taka.`,
      );
    }

    const totals = calculateTotals(settings, zone, subtotal);

    /* Decrement first. If anything is short, the whole transaction unwinds
       before an order number is consumed on a doomed order. */
    const stockLines = toStockLines(lines);
    await reserveStock(stockLines, tx);
    await syncSimpleProductStatus(
      lines.filter((line) => !line.variant).map((line) => line.product.id),
      tx,
    );

    const order = await insertOrder(
      {
        orderNumber: await nextOrderNumber(settings.orderNumberPrefix, tx),
        customerName: input.customerName,
        phone: input.phone,
        address: input.address,
        areaText: input.areaText,
        deliveryZone: zone,
        subtotal: totals.subtotal,
        deliveryCharge: totals.deliveryCharge,
        grandTotal: totals.grandTotal,
        itemCount: lines.length,
        totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
        paymentMethod: "cod",
        status: context.initialStatus ?? "pending",
        /* NULL for a storefront checkout, which is how "the customer placed
           this themselves" is recorded — see `orders.source`. */
        source: context.source ?? null,
        createdByAdminId: context.createdBy?.adminId ?? null,
        /* The customer's own note is kept in the internal notes field,
           clearly attributed. There is no separate customer-notes column
           because staff read one place during the confirmation call. */
        internalNotes: input.customerNote
          ? `Customer note: ${input.customerNote}`
          : null,
        idempotencyKey: context.idempotencyKey ?? null,
        customerIp: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 512) ?? null,
        /* From the request body rather than a header: these are cookies only
           the browser can read, and the storefront forwards them explicitly. */
        fbc: input.fbc ?? null,
        fbp: input.fbp ?? null,
      },
      tx,
    );

    const items = await insertOrderItems(
      lines.map((line) => ({
        orderId: order.id,
        productId: line.product.id,
        variantId: line.variant?.id ?? null,
        /* The snapshot. Renaming or repricing the product later must never
           change what this order says it was. */
        productName: line.product.name,
        productSlug: line.product.slug,
        sku: line.variant?.sku ?? line.product.sku,
        variantLabel: line.variantLabel,
        imageKey: line.imageKey,
        unitPrice: line.unitPrice,
        /* Frozen for the same reason as the price. Profit read from the
           product's CURRENT buying price would rewrite every past order the
           day a supplier raises his rate. */
        unitCost: line.unitCost,
        quantity: line.quantity,
        lineTotal: line.unitPrice * line.quantity,
      })),
      tx,
    );

    await recordEvent(
      {
        orderId: order.id,
        type: "order_created",
        newValue: {
          orderNumber: order.orderNumber,
          grandTotal: order.grandTotal,
          itemCount: order.itemCount,
          deliveryZone: order.deliveryZone,
          /* Present only on a hand-typed order, so the timeline of a storefront
             order reads exactly as it did before this existed. */
          ...(context.source ? { source: context.source, status: order.status } : {}),
        },
        /* Who the timeline credits. A customer did not place an order that an
           operator typed in from a message, and saying they did would misread
           the one record that settles a dispute later. */
        actor: context.createdBy
          ? { adminId: context.createdBy.adminId, name: context.createdBy.name }
          : CUSTOMER_ACTOR,
        note: input.customerNote ?? undefined,
      },
      tx,
    );

    return { order, items };
  });

  log.info(
    {
      orderNumber: created.order.orderNumber,
      grandTotal: created.order.grandTotal,
      zone,
    },
    "Order placed",
  );

  /* Emitted after commit: a notification must never go out for an order that
     is about to roll back. */
  orderEventBus.emit("order.created", {
    orderId: created.order.id,
    orderNumber: created.order.orderNumber,
    customerName: created.order.customerName,
    phone: created.order.phone,
    grandTotal: created.order.grandTotal,
    itemCount: created.order.itemCount,
    contents: created.items.map((item) => ({
      sku: item.sku,
      name: item.productName,
      variantLabel: item.variantLabel,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    address: created.order.address,
    areaText: created.order.areaText,
    deliveryZone: created.order.deliveryZone,
    subtotal: created.order.subtotal,
    deliveryCharge: created.order.deliveryCharge,
    /* The note is never stored on the order row — it lives in the timeline —
       so it comes from the request that is still in scope here. */
    customerNote: input.customerNote ?? null,
    /* Read off the committed row rather than the request: what was actually
       stored is what a conversion should be reported against. */
    customerIp: created.order.customerIp,
    userAgent: created.order.userAgent,
    fbc: created.order.fbc,
    fbp: created.order.fbp,
    placedAt: created.order.createdAt,
  });

  /**
   * Close any incomplete-checkout lead for this number.
   *
   * After the commit and outside it: this is bookkeeping for the shop's call
   * list, and it must never be able to fail an order that has already been
   * paid for in stock. Matching on the phone rather than a session covers the
   * customer who gave up on their phone and finished on a laptop.
   */
  try {
    await markRecovered(created.order.phone, created.order.id);
  } catch (error) {
    log.error({ err: error, orderId: created.order.id }, "Could not close the abandoned lead");
  }

  return {
    order: toOrderConfirmationDto(created.order, created.items),
    replayed: false,
  };
}

/**
 * Detects a likely double submission.
 *
 * The idempotency key is the real defence; this is the fallback for clients
 * that did not send one. It compares the phone number and the exact totals of
 * recent orders — a customer legitimately ordering twice in two minutes will
 * almost never match on both.
 *
 * NOT CURRENTLY WIRED INTO `placeOrder`, and that is a product decision rather
 * than an oversight to be quietly corrected. Calling it there collapses two
 * identical back-to-back orders into one, which the integration tests pin as
 * two distinct orders in more than twenty places — so switching it on changes
 * what "an order" means, not merely how a retry is handled.
 *
 * The retry hole it was written for is closed on the client instead: the
 * checkout's idempotency key now survives a reload (`ATTEMPT_KEY` in
 * `CheckoutForm`), which was the actual gap — the key used to live in a ref and
 * die with the mount, so a shopper who reloaded after a timeout submitted with
 * a fresh key and got a second real order.
 *
 * Turn this on only alongside a decision about the false positive: a genuine
 * second identical order inside the window is answered with the first order's
 * confirmation, and the customer has no way to tell.
 */
export async function findLikelyDuplicate(
  phone: string,
  grandTotal: number,
): Promise<{ orderNumber: string } | null> {
  const recent = await findRecentOrdersByPhone(phone, DUPLICATE_WINDOW_SECONDS);
  const match = recent.find((order) => order.grandTotal === grandTotal);
  return match ? { orderNumber: match.orderNumber } : null;
}

/** Shared with the admin edit path, which re-prices a swapped variant the
 *  same way checkout priced the original. */
export { variantLabelOf };
