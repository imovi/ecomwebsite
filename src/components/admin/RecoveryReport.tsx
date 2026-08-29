"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { cn, formatTaka } from "@/lib/utils";
import { AsyncState, Card, CardHeader, TableWrap } from "./ui";

/**
 * Whether chasing incomplete checkouts is paying for itself.
 *
 * Lives on the Performance page rather than on a screen of its own. Recovery is
 * a step in the funnel already drawn above it — checkout started, order placed,
 * order delivered — and putting it somewhere separate would give the shop two
 * pages that answer the same question with different numbers.
 *
 * THE COLUMN THAT KEEPS THE REST HONEST
 * "Came back on their own" counts leads that were recovered with nobody having
 * touched them. Some customers were always coming back, and a recovery rate
 * quoted without that column reads as though the messaging did all of it. If
 * that number is close to the other two, the chasing is not what is working.
 */

interface RecoveryData {
  summary: {
    incomplete: number;
    helpMessagesSent: number;
    couponOffersSent: number;
    contacted: number;
    couponsGenerated: number;
    couponsActive: number;
    couponsUsed: number;
    couponsExpired: number;
    couponsCancelled: number;
    recoveredOrders: number;
    recoveredRevenue: number;
    freeDeliveryCost: number;
  };
  rates: { couponUsePercent: number; recoveryPercent: number; overallPercent: number };
  outcomes: { fromHelpMessage: number; fromCouponOffer: number; unprompted: number };
  byProduct: { name: string; abandoned: number; recovered: number; couponsUsed: number }[];
  byReason: { reason: string; count: number }[];
  byStaff: { name: string; handled: number }[];
}

const REASON_LABELS: Record<string, string> = {
  price_too_high: "Price too high",
  delivery_charge: "Delivery charge too high",
  product_question: "Question about the product",
  buying_later: "Will buy later",
  delivery_area: "Delivery area problem",
  checkout_problem: "Checkout would not work",
  no_response: "No response",
  do_not_contact: "Do not contact",
};

export function RecoveryReport({ query }: { query: string }) {
  const [data, setData] = useState<RecoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await adminApi.get<{ report: RecoveryData }>(
        `admin/reports/recovery${query}`,
      );
      setData(result.report);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not load the recovery report.",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  useLoad(load);

  return (
    <Card>
      <CardHeader
        title="Recovering incomplete checkouts"
        hint="Customers who left a full basket, what was done about it, and what came back"
      />

      <div className="p-4 pt-0">
        <AsyncState loading={loading} error={error} onRetry={() => void load()} empty={!data}>
          {data && <Body data={data} />}
        </AsyncState>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function Body({ data }: { data: RecoveryData }) {
  const { summary, rates, outcomes } = data;

  if (summary.incomplete === 0) {
    return (
      <p className="text-caption text-muted">
        Nobody abandoned a checkout in this period.
      </p>
    );
  }

  /**
   * Did the offers earn back what they cost?
   *
   * Against the revenue of orders that USED a coupon, not against all recovered
   * revenue — the leads that came back after a plain message cost the shop
   * nothing but somebody's time, and crediting the coupons with those orders
   * would make the offer look better than it is.
   */
  const spentOnDelivery = summary.freeDeliveryCost;

  return (
    <div className="flex flex-col gap-5">
      {/* --- The verdict -------------------------------------------------- */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Baskets abandoned"
          value={String(summary.incomplete)}
          note={`${summary.contacted} contacted`}
        />
        <Stat
          label="Came back"
          value={String(summary.recoveredOrders)}
          note={`${rates.overallPercent}% of all of them`}
          tone={summary.recoveredOrders > 0 ? "good" : "plain"}
        />
        <Stat
          label="Recovered"
          value={formatTaka(summary.recoveredRevenue)}
          note="What those orders were worth"
          tone={summary.recoveredRevenue > 0 ? "good" : "plain"}
        />
        <Stat
          label="Free delivery cost"
          value={formatTaka(spentOnDelivery)}
          note={`${summary.couponsUsed} coupon${summary.couponsUsed === 1 ? "" : "s"} used`}
          tone={spentOnDelivery > 0 ? "warn" : "plain"}
        />
      </div>

      {/* --- What actually brought them back ------------------------------- */}
      <div>
        <h3 className="mb-2 text-caption font-medium text-ink">What brought them back</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat
            label="After a help message"
            value={String(outcomes.fromHelpMessage)}
            note={`${summary.helpMessagesSent} sent`}
          />
          <Stat
            label="After an offer"
            value={String(outcomes.fromCouponOffer)}
            note={`${summary.couponOffersSent} sent`}
          />
          <Stat
            label="Came back on their own"
            value={String(outcomes.unprompted)}
            note="Nobody had touched these"
          />
        </div>
        {outcomes.unprompted >= outcomes.fromHelpMessage + outcomes.fromCouponOffer &&
          outcomes.unprompted > 0 && (
            <p className="mt-2 rounded-sm bg-surface px-3 py-2 text-micro text-muted">
              More customers returned untouched than after being contacted. Read the recovery
              rate below with that in mind — some of these were coming back regardless.
            </p>
          )}
      </div>

      {/* --- The offers --------------------------------------------------- */}
      <div>
        <h3 className="mb-2 text-caption font-medium text-ink">Offers</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Created" value={String(summary.couponsGenerated)} />
          <Stat label="Still running" value={String(summary.couponsActive)} />
          <Stat label="Used" value={String(summary.couponsUsed)} tone="good" />
          <Stat label="Ran out" value={String(summary.couponsExpired)} />
          <Stat label="Cancelled" value={String(summary.couponsCancelled)} />
        </div>
        <p className="mt-2 text-micro text-muted">
          {summary.couponsGenerated === 0
            ? "No offers have been made in this period."
            : `${rates.couponUsePercent}% of offers were used. Recovery rate among customers who were contacted: ${rates.recoveryPercent}%.`}
        </p>
      </div>

      {/* --- Where it is happening ---------------------------------------- */}
      {data.byProduct.length > 0 && (
        <div>
          <h3 className="mb-2 text-caption font-medium text-ink">By product</h3>
          <TableWrap>
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Abandoned</th>
                  <th className="px-4 py-2 text-right font-medium">Came back</th>
                  <th className="px-4 py-2 text-right font-medium">Coupons used</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct.map((row) => (
                  <tr key={row.name} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{row.name}</td>
                    <td className="tnum px-4 py-2.5 text-right">{row.abandoned}</td>
                    <td className="tnum px-4 py-2.5 text-right">{row.recovered}</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">{row.couponsUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {/* --- Why they stopped ---------------------------------------------- */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-caption font-medium text-ink">Why they stopped</h3>
          {data.byReason.length === 0 ? (
            <p className="text-caption text-muted">
              Nobody has recorded a reason yet. Add one with the note on a lead — the same answer
              given forty times is a decision the shop is paying for without seeing it.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.byReason.map((row) => (
                <li key={row.reason} className="flex justify-between gap-3 text-caption">
                  <span className="text-ink-soft">
                    {REASON_LABELS[row.reason] ?? row.reason}
                  </span>
                  <span className="tnum text-muted">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-caption font-medium text-ink">Who worked the list</h3>
          {data.byStaff.length === 0 ? (
            <p className="text-caption text-muted">Nobody has worked a lead in this period.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.byStaff.map((row) => (
                <li key={row.name} className="flex justify-between gap-3 text-caption">
                  <span className="truncate text-ink-soft">{row.name}</span>
                  <span className="tnum text-muted">
                    {row.handled} lead{row.handled === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "good" | "warn";
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-line p-3">
      <span className="text-micro text-muted">{label}</span>
      <span
        className={cn(
          "tnum text-body font-semibold",
          tone === "good" && "text-positive",
          tone === "warn" && "text-warn",
          tone === "plain" && "text-ink",
        )}
      >
        {value}
      </span>
      {note && <span className="text-micro text-muted">{note}</span>}
    </div>
  );
}
