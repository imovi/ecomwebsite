import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  recoveryCoupons,
  COUPON_ALPHABET,
  COUPON_LENGTH,
  type RecoveryCouponRow,
  type RecoveryCouponStatus,
} from "../../db/schema/recovery-coupons.js";
import { abandonedCheckouts } from "../../db/schema/abandoned-checkouts.js";
import { couponRedemptions } from "../../db/schema/coupon-redemptions.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import { withinShopDays, type DateRange } from "../reports/profit.service.js";
import { recordLeadEvent, type LeadActor } from "./abandoned-event.repository.js";

/**
 * One-time free-delivery offers for customers who abandoned a checkout.
 *
 * THE ONE RULE THAT MATTERS
 * A coupon may be spent exactly once. That is not enforced by reading the row
 * and then writing it — two checkouts submitting in the same second would both
 * read `active` and both proceed. It is enforced by a single conditional UPDATE
 * whose WHERE clause carries the whole precondition, run inside the order's own
 * transaction. Whoever the database serialises second matches no rows and their
 * order rolls back. Same shape as `reserveStock`, for the same reason.
 *
 * EXPIRY IS A TIMESTAMP, NOT A STATUS
 * `expires_at` decides. The `status` column is a label the shop reads, kept
 * roughly current by a sweep, and nothing about money depends on that sweep
 * having run: the redemption UPDATE tests the timestamp itself. A backup job on
 * this server once failed every night for days without a word, and took the
 * database with it — so no second job gets to be load-bearing.
 */

const log = createLogger("recovery-coupon");

/** Attempts before giving up on finding a free code. */
const CODE_ATTEMPTS = 8;

/* -------------------------------------------------------------------------- */
/* Codes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A code a customer can read off a screen and type without help.
 *
 * `randomInt` rather than `Math.random`: this string is the entire credential
 * for a free delivery, and a predictable sequence would let anybody who worked
 * out the seed mint their own. It costs nothing to do properly.
 */
export function generateCode(): string {
  let code = "";
  for (let index = 0; index < COUPON_LENGTH; index += 1) {
    code += COUPON_ALPHABET[randomInt(COUPON_ALPHABET.length)];
  }
  return code;
}

/** Folded and trimmed, so what the customer typed matches what was stored. */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

/** What a coupon is, as far as anyone reading a screen is concerned. */
export type CouponState = "active" | "used" | "cancelled" | "expired";

export interface CouponDto {
  id: string;
  code: string;
  state: CouponState;
  cartValue: number;
  /** Who it was made for, when it was not made for a lead. */
  note: string;
  /** How many times it may be spent. Null means no limit. */
  maxUses: number | null;
  /** How many times it has been. */
  usedCount: number;
  expiresAt: string;
  usedAt: string | null;
  usedOrderId: string | null;
  createdAt: string;
}

/**
 * The state a human should be shown.
 *
 * Derived from the timestamp rather than read from the column, so a coupon that
 * ran out ten minutes ago reads "Expired" whether or not the sweep has been
 * anywhere near it. The column and this function agree eventually; this one is
 * right immediately.
 */
export function stateOf(
  row: Pick<RecoveryCouponRow, "status" | "expiresAt"> &
    Partial<Pick<RecoveryCouponRow, "maxUses" | "usedCount">>,
): CouponState {
  if (row.status === "used") return "used";
  if (row.status === "cancelled") return "cancelled";
  /* Spent out, whether or not the claim got as far as writing the word. Same
     reasoning as expiry: derive it, so the screen is right immediately. */
  if (
    row.maxUses !== null &&
    row.maxUses !== undefined &&
    (row.usedCount ?? 0) >= row.maxUses
  ) {
    return "used";
  }
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return "active";
}

function toDto(row: RecoveryCouponRow): CouponDto {
  return {
    id: row.id,
    code: row.code,
    state: stateOf(row),
    cartValue: row.cartValue,
    note: row.note,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    usedOrderId: row.usedOrderId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Moves timed-out coupons from `active` to `expired`.
 *
 * Tidiness, and one hard requirement: the partial unique index that allows one
 * active coupon per lead counts a timed-out row as active until this runs, so
 * `generate` calls it first or a lead could never be given a second offer.
 *
 * Safe to call as often as anybody likes — the WHERE clause matches nothing
 * almost every time.
 */
export async function sweepExpired(executor: DatabaseExecutor = getDb()): Promise<number> {
  const swept = await executor
    .update(recoveryCoupons)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(
      and(
        eq(recoveryCoupons.status, "active"),
        sql`${recoveryCoupons.expiresAt} <= now()`,
      ),
    )
    .returning({ id: recoveryCoupons.id });

  if (swept.length > 0) log.info({ count: swept.length }, "Recovery coupons expired");
  return swept.length;
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The lead an offer is being made to, with the reasons it may not be.
 *
 * Only reached when a lead id was supplied. A coupon minted from the Coupons
 * page has no lead, so none of these checks have anything to run against —
 * see the note on the minimum below.
 */
async function loadLeadForOffer(
  checkoutId: string,
  minCartValue: number,
  db: DatabaseExecutor,
): Promise<{ id: string; estimatedValue: number }> {
  const rows = await db
    .select({
      id: abandonedCheckouts.id,
      estimatedValue: abandonedCheckouts.estimatedValue,
      recoveredOrderId: abandonedCheckouts.recoveredOrderId,
      reason: abandonedCheckouts.reason,
    })
    .from(abandonedCheckouts)
    .where(eq(abandonedCheckouts.id, checkoutId))
    .limit(1);

  const lead = rows[0];
  if (!lead) throw new NotFoundError("That incomplete checkout no longer exists.");

  /* Somebody already bought. Handing them a discount now is paying for a sale
     the shop has already made. */
  if (lead.recoveredOrderId) {
    throw new BadRequestError("This customer has already ordered.");
  }

  /* The desk marked this one "do not contact". An offer is contact. */
  if (lead.reason === "do_not_contact") {
    throw new BadRequestError(
      "This lead is marked do-not-contact. Clear the reason first if that was wrong.",
    );
  }

  if (minCartValue > 0 && lead.estimatedValue < minCartValue) {
    throw new BadRequestError(
      `Offers start at ${minCartValue} taka. This cart is ${lead.estimatedValue}.`,
    );
  }

  return { id: lead.id, estimatedValue: lead.estimatedValue };
}

/**
 * Creates an offer, for a lead or for nobody in particular.
 *
 * WITH A LEAD it returns the one already outstanding rather than minting a
 * second. That is the point: an operator who taps Generate twice, or comes back
 * to a lead tomorrow, wants the code to read the customer — not an error about
 * one existing somewhere they cannot see.
 *
 * WITHOUT ONE — the Coupons page, for a customer the desk is on the phone to
 * who was never in the call list — every guard above is skipped, because each
 * needs a lead to test. That includes the minimum-basket setting: there is no
 * basket to measure, so the rule cannot be applied and the person typing it is
 * deciding by hand. The page says so; it must not let an owner believe the
 * floor is protecting them here.
 *
 * Nothing stops several standalone coupons being live at once. The
 * one-active-per-lead index is partial on `abandoned_checkout_id is not null`
 * precisely so it does not catch them.
 */
export async function generate(input: {
  checkoutId?: string | null | undefined;
  /** Who it is for. Only meaningful without a lead; a lead knows already. */
  note?: string | undefined;
  /**
   * A code chosen by hand, rather than generated.
   *
   * The restricted alphabet exists for codes a customer hears read down a phone
   * and has to write down; somebody typing EID2026 themselves has already made
   * that judgement, so a custom code is allowed letters, digits and dashes.
   * Refused only if it is already taken.
   */
  code?: string | undefined;
  /** How long it lives. Defaults to the shop's setting. */
  validHours?: number | undefined;
  /** How many times it may be spent. Null means no limit. Defaults to 1. */
  maxUses?: number | null | undefined;
  actor: LeadActor;
}): Promise<{ coupon: CouponDto; created: boolean }> {
  const db = getDb();
  const settings = await getSettings(db);

  /* Clear out anything that has timed out, so the one-active-per-lead index
     does not mistake last week's dead offer for a live one. */
  await sweepExpired(db);

  const lead = input.checkoutId
    ? await loadLeadForOffer(input.checkoutId, settings.recoveryCouponMinCartValue, db)
    : null;

  if (lead) {
    const existing = await db
      .select()
      .from(recoveryCoupons)
      .where(
        and(
          eq(recoveryCoupons.abandonedCheckoutId, lead.id),
          eq(recoveryCoupons.status, "active"),
        ),
      )
      .limit(1);

    const live = existing[0];
    if (live) return { coupon: toDto(live), created: false };
  }

  /* A lead offer always uses the shop's setting — the Abandoned page has no
     field for this and must keep behaving exactly as it did. Only a coupon
     minted by hand may name its own. */
  const hours = lead ? settings.recoveryCouponHours : (input.validHours ?? settings.recoveryCouponHours);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  /* Same rule for the use limit: a lead offer is one use, as it always was. */
  const maxUses = lead ? 1 : input.maxUses === undefined ? 1 : input.maxUses;

  const chosen = input.code ? normalizeCode(input.code) : null;
  if (chosen) {
    const taken = await findByCode(chosen, db);
    if (taken) {
      throw new ConflictError(
        `The code ${chosen} is already in use. Pick another.`,
        ErrorCode.CONFLICT,
      );
    }
  }

  /* Retry on a code collision rather than pre-checking for one. A SELECT
     followed by an INSERT is a race; letting the unique index answer is not.
     With thirty characters over six places a second attempt is already
     unlikely, and eight is simply generous. */
  /* A chosen code gets one attempt: retrying would silently hand back a
     different code than the one that was asked for. */
  const attempts = chosen ? 1 : CODE_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = chosen ?? generateCode();
    try {
      const inserted = await db
        .insert(recoveryCoupons)
        .values({
          code,
          abandonedCheckoutId: lead?.id ?? null,
          /* Zero MEANS zero for a standalone coupon — there was no basket, not
             a free one. The report reads it as such. */
          cartValue: lead?.estimatedValue ?? 0,
          note: lead ? "" : (input.note ?? "").trim(),
          maxUses,
          expiresAt,
          createdBy: input.actor.adminId,
        })
        .returning();

      const row = inserted[0];
      if (!row) throw new Error("The coupon was not written.");

      /* Only a lead has a history to write to. */
      if (lead) {
        await recordLeadEvent({
          checkoutId: lead.id,
          type: "coupon_generated",
          detail: { code: row.code, expiresAt: expiresAt.toISOString() },
          actor: input.actor,
        });
      }

      log.info(
        { code: row.code, checkoutId: lead?.id ?? null, cartValue: row.cartValue },
        lead ? "Recovery coupon issued" : "Standalone coupon issued",
      );

      return { coupon: toDto(row), created: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      /* The other unique index — one active coupon per lead. Two operators, or
         two taps, arriving together: the loser reads back the winner's coupon
         instead of failing, which is the same answer they would have got a
         moment earlier. Cannot fire without a lead. */
      if (lead && message.includes("recovery_coupons_one_active_per_lead_idx")) {
        const raced = await db
          .select()
          .from(recoveryCoupons)
          .where(
            and(
              eq(recoveryCoupons.abandonedCheckoutId, lead.id),
              eq(recoveryCoupons.status, "active"),
            ),
          )
          .limit(1);

        const row = raced[0];
        if (row) return { coupon: toDto(row), created: false };
      }

      if (message.includes("recovery_coupons_code_key")) {
        /* Only reachable for a generated code — a chosen one was checked above,
           and losing that race means somebody took it in the last millisecond. */
        if (chosen) {
          throw new ConflictError(
            `The code ${chosen} is already in use. Pick another.`,
            ErrorCode.CONFLICT,
          );
        }
        continue;
      }
      throw error;
    }
  }

  throw new ConflictError(
    "Could not find a free coupon code. Try again.",
    ErrorCode.CONFLICT,
  );
}

/** Withdraws an offer that has not been spent. */
export async function cancel(couponId: string, actor: LeadActor): Promise<CouponDto> {
  const cancelled = await getDb()
    .update(recoveryCoupons)
    .set({ status: "cancelled", cancelledAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(recoveryCoupons.id, couponId), eq(recoveryCoupons.status, "active")))
    .returning();

  const row = cancelled[0];
  if (!row) {
    /* Either it never existed or it has already been spent. A coupon the
       customer has used cannot be taken back — the order exists. */
    throw new ConflictError(
      "That offer is no longer active — it may already have been used.",
      ErrorCode.CONFLICT,
    );
  }

  if (row.abandonedCheckoutId) {
    await recordLeadEvent({
      checkoutId: row.abandonedCheckoutId,
      type: "coupon_cancelled",
      detail: { code: row.code },
      actor,
    });
  }

  return toDto(row);
}

/**
 * Withdraws whatever offer this lead currently has outstanding.
 *
 * The lead is what the operator is looking at, so the lead is what the endpoint
 * takes. Making the panel track a coupon id in order to cancel from a card that
 * already knows which customer it is would be an id passed around for no reason
 * — and one more thing that can be passed wrongly.
 */
export async function cancelForLead(checkoutId: string, actor: LeadActor): Promise<CouponDto> {
  const rows = await getDb()
    .select({ id: recoveryCoupons.id })
    .from(recoveryCoupons)
    .where(
      and(
        eq(recoveryCoupons.abandonedCheckoutId, checkoutId),
        eq(recoveryCoupons.status, "active"),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError("There is no active offer on this lead.");

  return cancel(row.id, actor);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The most recent coupon for each of these leads, whatever became of it.
 *
 * The newest rather than the active one, because the card has to show both
 * cases: a live code to send, and a dead one so the operator can see the offer
 * was already made and passed unused before making it again. Fetching only
 * active rows would render those two situations identically.
 *
 * Newest-wins in memory rather than a DISTINCT ON, because a lead accumulates
 * one coupon per offer and the index allows only one live at a time — the set
 * being sorted here is a handful of rows, not a table scan.
 */
export async function latestFor(checkoutIds: string[]): Promise<Map<string, CouponDto>> {
  const byCheckout = new Map<string, CouponDto>();
  if (checkoutIds.length === 0) return byCheckout;

  const rows = await getDb()
    .select()
    .from(recoveryCoupons)
    .where(inArray(recoveryCoupons.abandonedCheckoutId, checkoutIds))
    .orderBy(desc(recoveryCoupons.createdAt));

  for (const row of rows) {
    if (row.abandonedCheckoutId && !byCheckout.has(row.abandonedCheckoutId)) {
      byCheckout.set(row.abandonedCheckoutId, toDto(row));
    }
  }

  return byCheckout;
}

/**
 * Looks a code up on the caller's connection.
 *
 * The executor is not optional in spirit: `placeOrder` calls this from inside
 * the order transaction, and reading through a second connection there is a
 * deadlock rather than a style preference — the embedded Postgres used in
 * development and tests has exactly one connection, so the read waits on a
 * transaction that is waiting on the read.
 */
export async function findByCode(
  code: string,
  executor: DatabaseExecutor = getDb(),
): Promise<RecoveryCouponRow | null> {
  const rows = await executor
    .select()
    .from(recoveryCoupons)
    .where(eq(recoveryCoupons.code, normalizeCode(code)))
    .limit(1);

  return rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Spending                                                                   */
/* -------------------------------------------------------------------------- */

export type CouponRefusal = "unknown" | "used" | "expired" | "cancelled";

export interface CouponCheck {
  /** True when this code would zero the delivery charge right now. */
  valid: boolean;
  code: string;
  reason?: CouponRefusal;
  expiresAt?: string;
}

/** What a refusal should say to the person who typed the code. */
export function refusalMessage(reason: CouponRefusal): string {
  const messages: Record<CouponRefusal, string> = {
    unknown: "We do not recognise that code.",
    used: "That code has already been used.",
    expired: "That offer has expired.",
    cancelled: "That offer is no longer available.",
  };
  return messages[reason];
}

/**
 * Reads a code without spending it — for the quote, as the customer types.
 *
 * Deliberately claims nothing. A quote is not a purchase, and a code that
 * reserved itself on being typed would be burnt by anybody who pasted it into
 * the box and then changed their mind.
 */
export async function check(
  rawCode: string,
  executor: DatabaseExecutor = getDb(),
): Promise<CouponCheck> {
  const code = normalizeCode(rawCode);
  const row = await findByCode(code, executor);

  if (!row) return { valid: false, code, reason: "unknown" };

  const state = stateOf(row);
  if (state === "active") return { valid: true, code, expiresAt: row.expiresAt.toISOString() };

  return { valid: false, code, reason: state };
}

/**
 * Spends the code, or fails.
 *
 * MUST be called inside the transaction that writes the order, and after the
 * order row exists — the coupon points at it. The single UPDATE is the whole
 * guarantee: its WHERE clause holds every precondition, so two orders racing
 * for the last use of one code cannot both win. The loser matches no rows, this
 * throws, and their transaction unwinds with the stock they had reserved.
 *
 * Throws rather than returning false. A caller that forgot to check would
 * otherwise write an order with a delivery charge of zero and no coupon spent,
 * and nobody would find out until the month's numbers did not add up.
 */
export async function redeem(
  rawCode: string,
  order: { id: string; orderNumber: string },
  deliverySaved: number,
  tx: DatabaseExecutor,
): Promise<RecoveryCouponRow> {
  const code = normalizeCode(rawCode);

  /**
   * One conditional UPDATE, still.
   *
   * Counting rather than flag-flipping is the only change: the count goes up,
   * and the coupon becomes `used` on the use that reaches its limit. Every
   * precondition is still in the WHERE clause — including `used_count <
   * max_uses` — so two orders racing for the LAST use of a five-use code cannot
   * both win any more than they could for a one-use code. The loser matches no
   * rows, this throws, and their transaction unwinds with the stock it reserved.
   *
   * `max_uses is null` means no limit, so that arm of the test passes always.
   */
  const claimed = await tx
    .update(recoveryCoupons)
    .set({
      usedCount: sql`${recoveryCoupons.usedCount} + 1`,
      status: sql`case
        when ${recoveryCoupons.maxUses} is not null
         and ${recoveryCoupons.usedCount} + 1 >= ${recoveryCoupons.maxUses}
        then 'used'
        else ${recoveryCoupons.status}
      end`,
      /* The FIRST use only. `coupon_redemptions` holds them all. */
      usedOrderId: sql`coalesce(${recoveryCoupons.usedOrderId}, ${order.id}::uuid)`,
      usedAt: sql`coalesce(${recoveryCoupons.usedAt}, now())`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(recoveryCoupons.code, code),
        eq(recoveryCoupons.status, "active"),
        /* The timestamp, not the label. This is the line that makes the sweep
           optional rather than load-bearing. */
        sql`${recoveryCoupons.expiresAt} > now()`,
        sql`(${recoveryCoupons.maxUses} is null
             or ${recoveryCoupons.usedCount} < ${recoveryCoupons.maxUses})`,
      ),
    )
    .returning();

  const row = claimed[0];

  if (row) {
    /* Inside the same transaction as the claim. If the order rolls back this
       goes with it, and the count can never disagree with the rows. */
    await tx.insert(couponRedemptions).values({
      couponId: row.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      deliverySaved,
    });

    return row;
  }

  /* Nothing was claimed. Read the row so the customer is told which of the
     reasons it was, rather than getting a blanket refusal at the last step of a
     checkout they were about to complete.

     Through `tx`, like every other read here — a second connection would
     deadlock against the transaction this is running inside.

     A row that still reads `active` is the race this whole design exists for:
     another order is claiming the same code and has not committed yet. Reported
     as "used", because that is what it will be a moment from now and it is the
     only one of these the customer can act on. */
  const existing = await findByCode(code, tx);
  const state = existing ? stateOf(existing) : null;
  const reason: CouponRefusal =
    state === null ? "unknown" : state === "active" ? "used" : state;

  throw new ConflictError(refusalMessage(reason), ErrorCode.CONFLICT);
}

/**
 * Records that a coupon was spent, once the order has safely committed.
 *
 * Outside the transaction on purpose: this is bookkeeping for the call list and
 * must never be able to fail an order that has already reserved stock — the
 * same reason `markRecovered` runs where it does.
 */
export async function noteRedemption(
  coupon: RecoveryCouponRow,
  order: { id: string; orderNumber: string },
): Promise<void> {
  if (!coupon.abandonedCheckoutId) return;

  await recordLeadEvent({
    checkoutId: coupon.abandonedCheckoutId,
    type: "coupon_used",
    detail: { code: coupon.code, orderNumber: order.orderNumber },
    actor: { adminId: null, name: "Customer" },
  });
}

/* -------------------------------------------------------------------------- */
/* The whole ledger                                                           */
/* -------------------------------------------------------------------------- */

export interface CouponUse {
  orderNumber: string;
  deliverySaved: number;
  at: string;
}

export interface CouponListRow extends CouponDto {
  /** The lead's number, when the coupon was made for one. */
  phone: string | null;
  /** The first order it was spent on. `uses` has them all. */
  orderNumber: string | null;
  /** Every order this code was spent on, oldest first. */
  uses: CouponUse[];
}

export interface CouponTotals {
  created: number;
  active: number;
  /** Coupons that have been spent out — not the number of times. */
  used: number;
  expired: number;
  cancelled: number;
  /** Every individual use, which is what the cost is actually made of. */
  redemptions: number;
  /** Delivery charges the shop absorbed, as frozen on each use. */
  deliveryCost: number;
}

/**
 * Every coupon, newest first.
 *
 * Filtered by the state a human sees rather than by the stored column: a
 * coupon whose 24 hours ran out ten minutes ago must appear under "Expired"
 * whether or not the nightly sweep has been anywhere near it. Same rule as
 * `stateOf` — the timestamp decides, the column is a label.
 */
export async function listCoupons(
  options: { state?: CouponState | undefined; limit?: number | undefined } = {},
): Promise<CouponListRow[]> {
  const conditions = {
    active: sql`c.status = 'active' and c.expires_at > now()
                and (c.max_uses is null or c.used_count < c.max_uses)`,
    expired: sql`c.status = 'expired'
                 or (c.status = 'active' and c.expires_at <= now()
                     and (c.max_uses is null or c.used_count < c.max_uses))`,
    used: sql`c.status = 'used'
              or (c.max_uses is not null and c.used_count >= c.max_uses)`,
    cancelled: sql`c.status = 'cancelled'`,
  } as const;

  const filter = options.state ? sql`where ${conditions[options.state]}` : sql``;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  const rows = await getDb().execute(sql`
    select
      c.id, c.code, c.status, c.cart_value, c.note,
      c.max_uses, c.used_count,
      c.expires_at, c.used_at, c.used_order_id, c.created_at,
      a.phone as phone,
      o.order_number as order_number
    from recovery_coupons c
    left join abandoned_checkouts a on a.id = c.abandoned_checkout_id
    left join orders o on o.id = c.used_order_id and o.deleted_at is null
    ${filter}
    order by c.created_at desc
    limit ${limit}
  `);

  /* Raw SQL hands back `unknown` per column, and `String(unknown)` on a null or
     a Date turns into "[object Object]" in the middle of a table. */
  const text = (value: unknown): string | null =>
    typeof value === "string" ? value : value instanceof Date ? value.toISOString() : null;

  const mapped = rows.rows.map((row) => {
    const expiresAt = new Date(text(row.expires_at) ?? 0);
    const status = String(row.status) as RecoveryCouponStatus;
    const maxUses =
      row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses);
    const usedCount = Number(row.used_count ?? 0);
    const usedAtText = text(row.used_at);

    return {
      id: String(row.id),
      code: String(row.code),
      state: stateOf({ status, expiresAt, maxUses, usedCount }),
      cartValue: Number(row.cart_value ?? 0),
      note: typeof row.note === "string" ? row.note : "",
      maxUses: row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses),
      usedCount: Number(row.used_count ?? 0),
      expiresAt: expiresAt.toISOString(),
      usedAt: usedAtText ? new Date(usedAtText).toISOString() : null,
      usedOrderId: text(row.used_order_id),
      createdAt: new Date(text(row.created_at) ?? 0).toISOString(),
      phone: typeof row.phone === "string" ? row.phone : null,
      orderNumber: typeof row.order_number === "string" ? row.order_number : null,
      uses: [] as CouponUse[],
    };
  });

  /* One more query for the whole page rather than one per coupon. A code used
     twenty times is twenty rows, and a table of fifty coupons drawn a query at
     a time is what makes a panel feel broken. */
  const ids = mapped.filter((row) => row.usedCount > 0).map((row) => row.id);
  if (ids.length === 0) return mapped;

  const usesByCoupon = new Map<string, CouponUse[]>();
  const useRows = await getDb()
    .select()
    .from(couponRedemptions)
    .where(inArray(couponRedemptions.couponId, ids))
    .orderBy(asc(couponRedemptions.createdAt));

  for (const use of useRows) {
    const list = usesByCoupon.get(use.couponId) ?? [];
    list.push({
      orderNumber: use.orderNumber,
      deliverySaved: use.deliverySaved,
      at: use.createdAt.toISOString(),
    });
    usesByCoupon.set(use.couponId, list);
  }

  return mapped.map((row) => ({ ...row, uses: usesByCoupon.get(row.id) ?? [] }));
}

/**
 * What was issued, what was spent, and what it cost.
 *
 * Lives here rather than in the recovery report because it is a fact about
 * coupons, not about leads — and the Coupons page and that report must never
 * be able to disagree about it.
 *
 * The cost is summed from what each use recorded at the time, not priced from
 * today's settings. The order itself says the delivery charge was zero — that
 * is the entire point of the offer — so the price of it lives nowhere else, and
 * a shop that raised its delivery charge last week must not have last month's
 * offers silently restated.
 */
export async function totals(range?: DateRange): Promise<CouponTotals> {
  /* Raw column against computed instants, so `recovery_coupons`'s own
     created-at index can answer it. See `withinShopDays`. */
  const window = range ? sql`where ${withinShopDays(sql`c.created_at`, range)}` : sql``;

  const rows = await getDb().execute(sql`
    select
      count(*)::int                                            as created,
      count(*) filter (
        where c.status = 'active'
          and c.expires_at > now()
          and (c.max_uses is null or c.used_count < c.max_uses)
      )::int                                                   as active,
      count(*) filter (
        where c.status = 'used'
           or (c.max_uses is not null and c.used_count >= c.max_uses)
      )::int                                                   as used,
      count(*) filter (
        where c.status = 'expired'
           or (c.status = 'active' and c.expires_at <= now())
      )::int                                                   as expired,
      count(*) filter (where c.status = 'cancelled')::int      as cancelled,
      coalesce(sum(u.uses), 0)::int                            as redemptions,
      coalesce(sum(u.saved), 0)::int                           as delivery_cost
    from recovery_coupons c
    left join lateral (
      select count(*) as uses, coalesce(sum(r.delivery_saved), 0) as saved
        from coupon_redemptions r
       where r.coupon_id = c.id
    ) u on true
    ${window}
  `);

  const row = rows.rows[0] ?? {};
  const n = (key: string): number => Number(row[key] ?? 0);

  return {
    created: n("created"),
    active: n("active"),
    used: n("used"),
    expired: n("expired"),
    cancelled: n("cancelled"),
    redemptions: n("redemptions"),
    deliveryCost: n("delivery_cost"),
  };
}
