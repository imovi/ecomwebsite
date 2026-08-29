import { sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { getSettings } from "../settings/settings.service.js";
import { shopDay, type DateRange, type RangePreset } from "./profit.service.js";

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
    where ${shopDay(sql`a.created_at`)} between ${range.from}::date and ${range.to}::date
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
 * The coupons, and what they cost.
 *
 * Expiry is computed from the timestamp rather than read from the status
 * column, so this agrees with itself whether or not the sweep has run — see
 * the note on `recovery_coupons.status`.
 *
 * The cost is what those orders WOULD have been charged, taken from the current
 * settings: the order itself says zero, which is the entire point of the offer,
 * so the price of it appears nowhere on the order.
 */
async function couponTotals(range: DateRange): Promise<Record<string, number>> {
  const settings = await getSettings();

  const rows = await getDb().execute(sql`
    select
      count(*)::int                                                     as generated,
      count(*) filter (
        where c.status = 'active' and c.expires_at > now()
      )::int                                                            as active,
      count(*) filter (where c.status = 'used')::int                    as used,
      count(*) filter (
        where c.status = 'expired'
           or (c.status = 'active' and c.expires_at <= now())
      )::int                                                            as expired,
      count(*) filter (where c.status = 'cancelled')::int               as cancelled,

      -- Counted by zone and priced in TypeScript rather than summed here.
      -- Binding the two charges as query parameters made them text, and
      -- summing text is not a thing Postgres will do -- but the readable
      -- reason to split it is that the charges belong to the settings row
      -- rather than to this query.
      count(*) filter (
        where o.id is not null and o.delivery_zone = 'inside_dhaka'
      )::int                                                            as used_inside,
      count(*) filter (
        where o.id is not null and o.delivery_zone <> 'inside_dhaka'
      )::int                                                            as used_outside
    from recovery_coupons c
    left join orders o
      on o.id = c.used_order_id and o.deleted_at is null
    where ${shopDay(sql`c.created_at`)} between ${range.from}::date and ${range.to}::date
  `);

  const row = rows.rows[0] ?? {};
  return {
    generated: num(row, "generated"),
    active: num(row, "active"),
    used: num(row, "used"),
    expired: num(row, "expired"),
    cancelled: num(row, "cancelled"),
    deliveryCost:
      num(row, "used_inside") * settings.deliveryChargeInsideDhaka +
      num(row, "used_outside") * settings.deliveryChargeOutsideDhaka,
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
      where ${shopDay(sql`a.created_at`)} between ${range.from}::date and ${range.to}::date
    ),
    coupon_lines as (
      select distinct i.product_name as name, c.id as coupon_id
      from recovery_coupons c
      join orders o      on o.id = c.used_order_id and o.deleted_at is null
      join order_items i on i.order_id = o.id
      where ${shopDay(sql`c.created_at`)} between ${range.from}::date and ${range.to}::date
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
      and ${shopDay(sql`a.created_at`)} between ${range.from}::date and ${range.to}::date
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
      and ${shopDay(sql`e.created_at`)} between ${range.from}::date and ${range.to}::date
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
    couponTotals(range),
    byProduct(range),
    byReason(range),
    byStaff(range),
  ]);

  const summary: RecoverySummary = {
    incomplete: leads.incomplete ?? 0,
    helpMessagesSent: leads.helpSent ?? 0,
    couponOffersSent: leads.offersSent ?? 0,
    contacted: leads.contacted ?? 0,
    couponsGenerated: couponRow.generated ?? 0,
    couponsActive: couponRow.active ?? 0,
    couponsUsed: couponRow.used ?? 0,
    couponsExpired: couponRow.expired ?? 0,
    couponsCancelled: couponRow.cancelled ?? 0,
    recoveredOrders: leads.recovered ?? 0,
    recoveredRevenue: leads.recoveredRevenue ?? 0,
    freeDeliveryCost: couponRow.deliveryCost ?? 0,
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
