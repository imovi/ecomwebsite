import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import * as coupons from "../orders/recovery-coupon.service.js";
import { withinShopDays, type DateRange, type RangePreset } from "./profit.service.js";

/**
 * Did chasing incomplete checkouts actually work?
 *
 * The shop can now message a lead and offer it free delivery. Both cost
 * something — an operator's time, and a courier fee the shop absorbs — so both
 * need a number against them, or the feature becomes a habit nobody has ever
 * checked.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM
 * That a recovered order was CAUSED by the message. A lead is credited when an
 * order arrives from that phone number, which is how the call list has always
 * worked, and some of those customers were coming back regardless. Splitting
 * the figures by what was actually done — messaged, offered a coupon, or left
 * alone — is as close to an answer as this can honestly get, and the "left
 * alone" column is the one that keeps the other two honest. A shop reading a
 * 40% recovery rate on leads nobody contacted should trust the whole screen
 * less, and it should be able to see that.
 *
 * Everything is windowed on when the LEAD was created, not when the order
 * arrived. A lead abandoned on the last day of the month and recovered on the
 * first of the next belongs to the month whose traffic produced it — otherwise
 * every month borrows the tail of the one before and no two are comparable.
 */

export interface RecoverySummary {
  /** Leads created in the window, whatever became of them. */
  incomplete: number;
  helpMessagesSent: number;
  couponOffersSent: number;
  /** Leads that had at least one of the two done to them. */
  contacted: number;
  couponsGenerated: number;
  couponsActive: number;
  couponsUsed: number;
  couponsExpired: number;
  couponsCancelled: number;
  /** Individual uses. A ten-use code spent nine times is nine, not one. */
  couponRedemptions: number;
  recoveredOrders: number;
  recoveredRevenue: number;
  /** Delivery charges the shop absorbed on coupon orders. */
  freeDeliveryCost: number;
}

export interface RecoveryRates {
  /** Used / generated. Whether the offer was worth making at all. */
  couponUsePercent: number;
  /** Recovered / contacted. Whether the chasing works. */
  recoveryPercent: number;
  /** Recovered / incomplete, contacted or not — the honest denominator. */
  overallPercent: number;
}

export interface RecoveryOutcome {
  /** Leads recovered after a help message and no coupon. */
  fromHelpMessage: number;
  /** Leads recovered after an offer was sent. */
  fromCouponOffer: number;
  /** Leads that came back with nobody having touched them. */
  unprompted: number;
}

export interface RecoveryProduct {
  name: string;
  abandoned: number;
  recovered: number;
  couponsUsed: number;
}

export interface RecoveryReport {
  range: DateRange;
  preset?: RangePreset | undefined;
  summary: RecoverySummary;
  rates: RecoveryRates;
  outcomes: RecoveryOutcome;
  byProduct: RecoveryProduct[];
  byReason: { reason: string; count: number }[];
  byStaff: { name: string; handled: number }[];
}

/** Percentage, rounded to one place, and 0 rather than NaN on an empty base. */
function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

const num = (row: Record<string, unknown>, key: string): number => Number(row[key] ?? 0);

/* Raw SQL comes back as `unknown` per column, and stringifying that blindly
   turns a null into "[object Object]" in the middle of a report. */
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

/* -------------------------------------------------------------------------- */

/**
 * Everything about the leads themselves, in one pass.
 *
 * One query rather than nine, because every figure here is a differently
 * filtered count over the same rows — and nine round trips to draw one card is
 * the shape that makes a report page feel broken.
 */
async function leadTotals(range: DateRange): Promise<Record<string, number>> {
  const rows = await getDb().execute(sql`
    select
      count(*)::int                                                     as incomplete,
      count(*) filter (where a.help_message_sent_at is not null)::int    as help_sent,
      count(*) filter (where a.coupon_offer_sent_at is not null)::int    as offers_sent,
      count(*) filter (
        where a.help_message_sent_at is not null
           or a.coupon_offer_sent_at is not null
      )::int                                                            as contacted,
      count(*) filter (where a.recovered_order_id is not null)::int      as recovered,
      coalesce(sum(o.grand_total) filter (
        where o.id is not null
      ), 0)::int                                                        as recovered_revenue,

      -- Which of the three routes brought each recovered lead back. An offer
      -- outranks a message because it was the later and stronger thing done.
      count(*) filter (
        where a.recovered_order_id is not null
          and a.coupon_offer_sent_at is not null
      )::int                                                            as from_offer,
      count(*) filter (
        where a.recovered_order_id is not null
          and a.coupon_offer_sent_at is null
          and a.help_message_sent_at is not null
      )::int                                                            as from_message,
      count(*) filter (
        where a.recovered_order_id is not null
          and a.coupon_offer_sent_at is null
          and a.help_message_sent_at is null
      )::int                                                            as unprompted
    from abandoned_checkouts a
    left join orders o
      on o.id = a.recovered_order_id and o.deleted_at is null
    where ${withinShopDays(sql`a.created_at`, range)}
  `);

  const row = rows.rows[0] ?? {};
  return {
    incomplete: num(row, "incomplete"),
    helpSent: num(row, "help_sent"),
    offersSent: num(row, "offers_sent"),
    contacted: num(row, "contacted"),
    recovered: num(row, "recovered"),
    recoveredRevenue: num(row, "recovered_revenue"),
    fromOffer: num(row, "from_offer"),
    fromMessage: num(row, "from_message"),
    unprompted: num(row, "unprompted"),
  };
}

/**
 * Which products people put down and walk away from.
 *
 * Read out of the cart snapshot on the lead rather than by joining the
 * catalogue, so a product that has since been renamed or deleted still shows
 * under the name the customer saw. The same reason order lines are snapshotted.
 */
async function byProduct(range: DateRange): Promise<RecoveryProduct[]> {
  const rows = await getDb().execute(sql`
    with abandoned_lines as (
      select
        a.id,
        a.recovered_order_id,
        line->>'name' as name
      from abandoned_checkouts a,
           jsonb_array_elements(a.contents) as line
      where ${withinShopDays(sql`a.created_at`, range)}
    ),
    coupon_lines as (
      select distinct i.product_name as name, c.id as coupon_id
      from recovery_coupons c
      join orders o      on o.id = c.used_order_id and o.deleted_at is null
      join order_items i on i.order_id = o.id
      where ${withinShopDays(sql`c.created_at`, range)}
    )
    select
      l.name,
      count(distinct l.id)::int                                            as abandoned,
      count(distinct l.id) filter (
        where l.recovered_order_id is not null
      )::int                                                               as recovered,
      (select count(*)::int from coupon_lines cl where cl.name = l.name)   as coupons_used
    from abandoned_lines l
    where l.name is not null
    group by l.name
    order by abandoned desc, l.name asc
    limit 20
  `);

  return rows.rows.map((row) => ({
    name: text(row, "name"),
    abandoned: num(row, "abandoned"),
    recovered: num(row, "recovered"),
    couponsUsed: num(row, "coupons_used"),
  }));
}

/**
 * Why customers said they stopped.
 *
 * The single most actionable table on this page: one person saying the delivery
 * charge is too much is a conversation, forty saying it is a pricing decision
 * the owner has been paying for without seeing.
 */
async function byReason(range: DateRange): Promise<{ reason: string; count: number }[]> {
  const rows = await getDb().execute(sql`
    select a.reason, count(*)::int as n
    from abandoned_checkouts a
    where a.reason <> ''
      and ${withinShopDays(sql`a.created_at`, range)}
    group by a.reason
    order by n desc
  `);

  return rows.rows.map((row) => ({ reason: text(row, "reason"), count: num(row, "n") }));
}

/**
 * Who worked the list.
 *
 * Counted in distinct leads touched, not in events: somebody who rang one
 * customer, noted the answer and sent them a coupon has handled one lead, and
 * counting the three actions would rank whoever clicks most rather than whoever
 * recovers most.
 */
async function byStaff(range: DateRange): Promise<{ name: string; handled: number }[]> {
  const rows = await getDb().execute(sql`
    select e.actor_name as name, count(distinct e.checkout_id)::int as handled
    from abandoned_checkout_events e
    where e.actor_admin_id is not null
      and ${withinShopDays(sql`e.created_at`, range)}
    group by e.actor_name
    order by handled desc
    limit 20
  `);

  return rows.rows.map((row) => ({ name: text(row, "name"), handled: num(row, "handled") }));
}

/* -------------------------------------------------------------------------- */

export async function recoveryReport(
  range: DateRange,
  options: { preset?: RangePreset | undefined } = {},
): Promise<RecoveryReport> {
  const [leads, couponRow, products, reasons, staff] = await Promise.all([
    leadTotals(range),
    /* The coupon figures come from the coupon service, not from a second query
       here. The Coupons page reads the same function, so the two screens cannot
       drift into disagreeing about how many were used. */
    coupons.totals(range),
    byProduct(range),
    byReason(range),
    byStaff(range),
  ]);

  const summary: RecoverySummary = {
    incomplete: leads.incomplete ?? 0,
    helpMessagesSent: leads.helpSent ?? 0,
    couponOffersSent: leads.offersSent ?? 0,
    contacted: leads.contacted ?? 0,
    couponsGenerated: couponRow.created,
    couponsActive: couponRow.active,
    couponsUsed: couponRow.used,
    couponsExpired: couponRow.expired,
    couponsCancelled: couponRow.cancelled,
    couponRedemptions: couponRow.redemptions,
    recoveredOrders: leads.recovered ?? 0,
    recoveredRevenue: leads.recoveredRevenue ?? 0,
    freeDeliveryCost: couponRow.deliveryCost,
  };

  return {
    range,
    preset: options.preset,
    summary,
    rates: {
      couponUsePercent: share(summary.couponsUsed, summary.couponsGenerated),
      recoveryPercent: share(summary.recoveredOrders, summary.contacted),
      overallPercent: share(summary.recoveredOrders, summary.incomplete),
    },
    outcomes: {
      fromHelpMessage: leads.fromMessage ?? 0,
      fromCouponOffer: leads.fromOffer ?? 0,
      unprompted: leads.unprompted ?? 0,
    },
    byProduct: products,
    byReason: reasons,
    byStaff: staff,
  };
}
