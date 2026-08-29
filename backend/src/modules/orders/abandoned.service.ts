import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  abandonedCheckouts,
  type AbandonedCheckoutRow,
  type AbandonedLine,
  type AbandonedReason,
  type AbandonedStatus,
} from "../../db/schema/abandoned-checkouts.js";
import { products } from "../../db/schema/products.js";
import { productVariants } from "../../db/schema/product-variants.js";
import { NotFoundError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import type { DeliveryZone } from "../../db/schema/order-enums.js";
import * as coupons from "./recovery-coupon.service.js";
import {
  listLeadEventsFor,
  recordLeadEvent,
  CUSTOMER_LEAD_ACTOR,
  type LeadActor,
  type LeadEventDto,
} from "./abandoned-event.repository.js";

/**
 * Incomplete checkouts.
 *
 * A customer who typed their number and then vanished is a warm lead with a
 * known phone — the cheapest sale a cash-on-delivery shop can make. This module
 * records those attempts, hides the ones that turned into orders, and gives the
 * shop a list worth working through.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE
 * No marketing list, no export, and nothing sends itself. The shop can now
 * message a lead and offer it free delivery, but every one of those is a button
 * an operator presses about one customer they were already going to ring — the
 * WhatsApp link opens a chat with the text written, and a human sends it.
 *
 * That distinction is the consent boundary, not a limitation to be tidied away
 * later. A customer who typed their number into a checkout agreed to be
 * contacted about that checkout. They did not agree to a broadcast list, and an
 * automated send is how one turns into the other without anybody deciding to.
 */

const log = createLogger("abandoned");

/** Digits only, so `01712-345678` and `01712345678` are one lead, not two. */
export function normalizePhone(input: string): string {
  return input.replace(/\D/g, "");
}

export interface RecordAbandonedInput {
  phone: string;
  customerName?: string | undefined;
  address?: string | undefined;
  areaText?: string | undefined;
  deliveryZone?: DeliveryZone | undefined;
  items: { productId: string; variantId?: string | null | undefined; quantity: number }[];
}

/**
 * Prices the cart from the catalogue rather than trusting the browser.
 *
 * The caller needs to know what the customer was actually looking at. A value
 * posted from the page could be anything, and a call list ordered by a number a
 * stranger controls would put whoever typed the biggest figure at the top.
 */
async function describeCart(
  items: RecordAbandonedInput["items"],
  executor: DatabaseExecutor,
): Promise<{ contents: AbandonedLine[]; itemCount: number; estimatedValue: number }> {
  if (items.length === 0) return { contents: [], itemCount: 0, estimatedValue: 0 };

  const contents: AbandonedLine[] = [];

  for (const item of items) {
    const rows = await executor
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
      })
      .from(products)
      .where(eq(products.id, item.productId))
      .limit(1);

    const product = rows[0];
    /* A cart line for a product that has since been deleted tells the caller
       nothing useful, so it is skipped rather than recorded as "unknown". */
    if (!product) continue;

    let unitPrice = product.price;
    let variantLabel: string | null = null;

    if (item.variantId) {
      const variantRows = await executor
        .select({ price: productVariants.price, options: productVariants.options })
        .from(productVariants)
        .where(eq(productVariants.id, item.variantId))
        .limit(1);

      const variant = variantRows[0];
      if (variant) {
        unitPrice = variant.price;
        const values = Object.values(variant.options).filter(Boolean);
        variantLabel = values.length > 0 ? values.join(" · ") : null;
      }
    }

    contents.push({
      productId: product.id,
      variantId: item.variantId ?? null,
      name: product.name,
      variantLabel,
      quantity: item.quantity,
      unitPrice,
    });
  }

  return {
    contents,
    itemCount: contents.reduce((sum, line) => sum + line.quantity, 0),
    estimatedValue: contents.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
  };
}

/**
 * Records — or updates — the attempt for this number.
 *
 * Upsert rather than insert: the storefront saves as the customer types, and a
 * row per keystroke batch would have the shop ringing the same person five
 * times. `last_seen_at` moves forward so the freshest lead sorts first.
 *
 * A row that has already been recovered is left alone and a new one is started,
 * which is why the unique index is partial: a repeat customer abandoning a
 * second basket is a second opportunity, not a duplicate.
 */
export async function record(input: RecordAbandonedInput): Promise<void> {
  const db = getDb();
  const phone = normalizePhone(input.phone);

  const cart = await describeCart(input.items, db);

  const existing = await db
    .select({ id: abandonedCheckouts.id, status: abandonedCheckouts.status })
    .from(abandonedCheckouts)
    .where(and(eq(abandonedCheckouts.phone, phone), isNull(abandonedCheckouts.recoveredOrderId)))
    .limit(1);

  const current = existing[0];

  if (current) {
    await db
      .update(abandonedCheckouts)
      .set({
        /* Only overwrite with something. A customer who clears a field mid-edit
           should not wipe the name the shop already has to call them by. */
        ...(input.customerName ? { customerName: input.customerName } : {}),
        ...(input.address ? { address: input.address } : {}),
        ...(input.areaText ? { areaText: input.areaText } : {}),
        ...(input.deliveryZone ? { deliveryZone: input.deliveryZone } : {}),
        ...(cart.contents.length > 0 ? cart : {}),
        /* A dismissed lead that comes back is a live lead again — they
           returned to the checkout of their own accord. */
        ...(current.status === "dismissed" ? { status: "open" as const } : {}),
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(abandonedCheckouts.id, current.id));

    return;
  }

  await db.insert(abandonedCheckouts).values({
    phone,
    customerName: input.customerName ?? null,
    address: input.address ?? null,
    areaText: input.areaText ?? null,
    deliveryZone: input.deliveryZone ?? null,
    ...cart,
  });

  log.info({ phone: phone.slice(-4), value: cart.estimatedValue }, "Incomplete checkout recorded");
}

/**
 * Closes the lead when the order finally arrives.
 *
 * Called after an order commits. Matching on the phone rather than a session
 * covers the common case: the customer gave up on their phone, then finished on
 * a laptop, or simply reloaded and started again.
 */
export async function markRecovered(
  phone: string,
  orderId: string,
  options: { orderNumber?: string | undefined; executor?: DatabaseExecutor | undefined } = {},
): Promise<void> {
  const executor = options.executor ?? getDb();
  const normalized = normalizePhone(phone);

  const updated = await executor
    .update(abandonedCheckouts)
    .set({
      recoveredOrderId: orderId,
      recoveredAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(abandonedCheckouts.phone, normalized),
        isNull(abandonedCheckouts.recoveredOrderId),
      ),
    )
    .returning({ id: abandonedCheckouts.id });

  if (updated.length === 0) return;

  log.info({ orderId, count: updated.length }, "Incomplete checkout recovered by an order");

  /* One line per lead so the card can say what closed it. Matching is still on
     the phone, NOT on the resume link — most customers who are messaged go to
     the site themselves rather than tapping the link, and crediting only the
     link would report a recovery rate well below the real one. */
  for (const lead of updated) {
    await recordLeadEvent(
      {
        checkoutId: lead.id,
        type: "recovered",
        detail: options.orderNumber ? { orderNumber: options.orderNumber } : {},
        actor: CUSTOMER_LEAD_ACTOR,
      },
      executor,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export interface AbandonedDto {
  id: string;
  phone: string;
  customerName: string | null;
  address: string | null;
  areaText: string | null;
  deliveryZone: DeliveryZone | null;
  contents: AbandonedLine[];
  itemCount: number;
  estimatedValue: number;
  status: AbandonedStatus;
  note: string;
  reason: AbandonedReason | "";
  contactedAt: string | null;
  helpMessageSentAt: string | null;
  couponOfferSentAt: string | null;
  recovered: boolean;
  /** The most recent offer made to this lead, whatever became of it. */
  coupon: coupons.CouponDto | null;
  /** What has been done about this one, oldest first. */
  events: LeadEventDto[];
  /** Where the lead stands, so the card needs one badge instead of five. */
  stage: LeadStage;
  lastSeenAt: string;
  createdAt: string;
}

/**
 * One word for where a lead has got to.
 *
 * Derived, never stored. The three stored statuses — open, contacted,
 * dismissed — still mean exactly what they meant before this feature existed,
 * and `openCount` still counts the same rows, so the badge on the nav did not
 * quietly change meaning underneath the shop. Everything richer is computed
 * from facts already recorded elsewhere: a timestamp, a coupon, an order.
 *
 * The alternative was widening the status column and its CHECK constraint, and
 * then owning the question of what a lead with an expired coupon AND a sent
 * help message is. Two sources of truth that can disagree is how a list stops
 * being believed.
 */
export type LeadStage =
  | "open"
  | "called"
  | "help_message_sent"
  | "coupon_active"
  | "coupon_offer_sent"
  | "coupon_expired"
  | "recovered"
  | "dismissed";

function stageOf(row: AbandonedCheckoutRow, coupon: coupons.CouponDto | null): LeadStage {
  /* Most final first. A recovered lead is recovered whatever else happened on
     the way to it. */
  if (row.recoveredOrderId) return "recovered";
  if (row.status === "dismissed") return "dismissed";

  if (coupon?.state === "active") {
    return row.couponOfferSentAt ? "coupon_offer_sent" : "coupon_active";
  }
  /* An offer was made and ran out. Worth telling apart from never having made
     one: it says this customer has already passed on it once. */
  if (coupon?.state === "expired") return "coupon_expired";

  if (row.helpMessageSentAt) return "help_message_sent";
  if (row.status === "contacted") return "called";
  return "open";
}

function toDto(
  row: AbandonedCheckoutRow,
  coupon: coupons.CouponDto | null,
  events: LeadEventDto[],
): AbandonedDto {
  return {
    id: row.id,
    phone: row.phone,
    customerName: row.customerName,
    address: row.address,
    areaText: row.areaText,
    deliveryZone: row.deliveryZone,
    contents: row.contents,
    itemCount: row.itemCount,
    estimatedValue: row.estimatedValue,
    status: row.status,
    note: row.note,
    reason: (row.reason || "") as AbandonedReason | "",
    contactedAt: row.contactedAt?.toISOString() ?? null,
    helpMessageSentAt: row.helpMessageSentAt?.toISOString() ?? null,
    couponOfferSentAt: row.couponOfferSentAt?.toISOString() ?? null,
    recovered: row.recoveredOrderId !== null,
    coupon,
    events,
    stage: stageOf(row, coupon),
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Loads the coupons and histories for a page of leads.
 *
 * Two queries for the whole page rather than two per card. The list renders
 * every lead with its history, and the per-card version was fifty round trips
 * to draw one screen.
 */
async function decorate(rows: AbandonedCheckoutRow[]): Promise<AbandonedDto[]> {
  const ids = rows.map((row) => row.id);
  const [couponsByLead, eventsByLead] = await Promise.all([
    coupons.latestFor(ids),
    listLeadEventsFor(ids),
  ]);

  return rows.map((row) =>
    toDto(row, couponsByLead.get(row.id) ?? null, eventsByLead.get(row.id) ?? []),
  );
}

export async function list(
  options: { includeRecovered?: boolean | undefined; status?: AbandonedStatus | undefined } = {},
): Promise<AbandonedDto[]> {
  const filters = [
    /* Recovered leads are hidden by default: this list is a to-do, and a
       customer who already ordered is not on it. */
    ...(options.includeRecovered ? [] : [isNull(abandonedCheckouts.recoveredOrderId)]),
    ...(options.status ? [eq(abandonedCheckouts.status, options.status)] : []),
  ];

  const rows = await getDb()
    .select()
    .from(abandonedCheckouts)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(abandonedCheckouts.lastSeenAt))
    .limit(200);

  return decorate(rows);
}

/** How many are waiting for a call — for the badge on the nav. */
export async function openCount(): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(abandonedCheckouts)
    .where(
      and(eq(abandonedCheckouts.status, "open"), isNull(abandonedCheckouts.recoveredOrderId)),
    );

  return rows[0]?.count ?? 0;
}

async function loadOne(id: string): Promise<AbandonedDto> {
  const rows = await getDb()
    .select()
    .from(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError("That incomplete checkout no longer exists.");

  const dto = (await decorate([row]))[0];
  if (!dto) throw new NotFoundError("That incomplete checkout no longer exists.");
  return dto;
}

export async function update(
  id: string,
  input: {
    status?: AbandonedStatus | undefined;
    note?: string | undefined;
    reason?: AbandonedReason | "" | undefined;
  },
  actor: LeadActor,
): Promise<AbandonedDto> {
  const patch: Partial<AbandonedCheckoutRow> = {};
  if (input.note !== undefined) patch.note = input.note;
  if (input.reason !== undefined) patch.reason = input.reason;

  if (input.status !== undefined) {
    patch.status = input.status;
    /* Stamp who rang and when, so "did anyone call this person?" is a fact
       rather than a guess — the same reason order status changes are logged. */
    if (input.status === "contacted") {
      patch.contactedBy = actor.adminId;
      patch.contactedAt = new Date();
    }
  }

  const rows = await getDb()
    .update(abandonedCheckouts)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(abandonedCheckouts.id, id))
    .returning();

  const row = rows[0];
  if (!row) throw new NotFoundError("That incomplete checkout no longer exists.");

  /* History for the parts that change what happens next. The note is included
     because what the customer actually said is the most useful thing on this
     card three days later, and the reason tag with it — so the report can count
     the same thing being said forty times. */
  if (input.status === "contacted") {
    await recordLeadEvent({ checkoutId: row.id, type: "called", actor });
  }
  if (input.status === "dismissed") {
    await recordLeadEvent({ checkoutId: row.id, type: "dismissed", actor });
  }
  if (input.note !== undefined && input.note.trim() !== "") {
    await recordLeadEvent({
      checkoutId: row.id,
      type: "note_added",
      detail: { note: input.note, ...(row.reason ? { reason: row.reason } : {}) },
      actor,
    });
  }

  return loadOne(row.id);
}

/**
 * Records that the desk sent a message, after it sent one.
 *
 * Separate from opening the WhatsApp link, and the separation is the point.
 * The link writes text into a chat; whether it is then sent is a decision the
 * operator makes while reading it, and often they will adjust it or ring
 * instead. A flag set on the click would mark half the list as messaged when it
 * was not, and a status nobody believes is a status nobody reads.
 */
export async function markMessageSent(
  id: string,
  kind: "help" | "coupon_offer",
  actor: LeadActor,
): Promise<AbandonedDto> {
  const patch =
    kind === "help" ? { helpMessageSentAt: new Date() } : { couponOfferSentAt: new Date() };

  const rows = await getDb()
    .update(abandonedCheckouts)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(abandonedCheckouts.id, id))
    .returning({ id: abandonedCheckouts.id });

  const row = rows[0];
  if (!row) throw new NotFoundError("That incomplete checkout no longer exists.");

  await recordLeadEvent({
    checkoutId: row.id,
    type: kind === "help" ? "help_message_sent" : "coupon_offer_sent",
    actor,
  });

  return loadOne(row.id);
}

export async function remove(id: string): Promise<void> {
  const rows = await getDb()
    .delete(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, id))
    .returning({ id: abandonedCheckouts.id });

  if (rows.length === 0) throw new NotFoundError("That incomplete checkout no longer exists.");
}

/* -------------------------------------------------------------------------- */
/* Resuming a checkout                                                        */
/* -------------------------------------------------------------------------- */

export interface ResumeCart {
  items: { productId: string; variantId: string | null; quantity: number }[];
}

/**
 * The cart behind a resume link — and nothing else.
 *
 * Public and unauthenticated, because the link goes out over WhatsApp and the
 * customer who taps it is not signed into anything.
 *
 * DELIBERATELY NOT THE CUSTOMER'S DETAILS
 * The obvious version of this pre-fills the name, phone and address so there is
 * nothing to retype. It also means anybody the link is forwarded to — and
 * WhatsApp messages are forwarded constantly — can read a stranger's home
 * address. The cart is not sensitive; the contact details are. So this returns
 * ids and quantities, the form opens empty, and the customer types their own
 * number as they would have done anyway.
 *
 * The lead id is the token. A v4 UUID is not guessable, and guessing one buys
 * you somebody's shopping list.
 */
export async function resumeCart(id: string): Promise<ResumeCart> {
  const rows = await getDb()
    .select({ contents: abandonedCheckouts.contents })
    .from(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError("That link is no longer valid.");

  /* No prices either. The storefront re-prices from the catalogue, so a cart
     saved last week cannot resurrect last week's price. */
  return {
    items: row.contents.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    })),
  };
}
