"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { cn, formatTaka } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { AdsCampaigns } from "./AdsCampaigns";
import { RangePicker, rangeQuery, type RangePreset } from "./RangePicker";
import { AsyncState, Card, CardHeader, PageBody, TableWrap } from "./ui";
import { Icon } from "@/components/ui/Icon";

/**
 * Marketing performance.
 *
 * The profit page answers "did the shop make money". This one answers "is the
 * advertising working", and the difference is the whole point: an owner can be
 * profitable overall while every taka of ad spend loses money, and the profit
 * page cannot show that.
 *
 * WHY TWO ROAS FIGURES SIT SIDE BY SIDE
 * Ads Manager counts a Purchase the moment an order is placed. On cash on
 * delivery a large share of those are refused at the door, so the return it
 * reports is real about clicks and fictional about money. Showing only the true
 * figure would leave an owner unable to reconcile this screen with the one
 * Facebook shows them, and quietly distrust both. Showing both, with the gap
 * named, is what makes the true one believable.
 *
 * WHAT THIS PAGE REFUSES TO DO
 * It does not invent attribution. An order counts as ad-driven only if it
 * carries a Facebook identifier, and the share that do is printed next to every
 * figure derived from them. A page that quietly credited ads with every sale
 * would produce a ROAS an owner would spend real money against.
 */

interface FunnelStep {
  key: "checkoutsStarted" | "ordersPlaced" | "confirmed" | "delivered";
  count: number;
  ofPreviousPercent: number | null;
}

interface PerformanceReport {
  range: { from: string; to: string; preset?: RangePreset };
  funnel: FunnelStep[];
  delivery: {
    placed: number;
    delivered: number;
    cancelled: number;
    returned: number;
    stillMoving: number;
    settled: number;
    ratePercent: number | null;
  };
  ads: {
    spend: number;
    attributedPlaced: number;
    attributedDelivered: number;
    placedValue: number;
    deliveredValue: number;
    placedRoas: number | null;
    trueRoas: number | null;
    costPerDeliveredOrder: number | null;
    attributionCoveragePercent: number;
  };
  byProduct: {
    productId: string;
    productName: string;
    spend: number;
    placed: number;
    delivered: number;
    deliveredValue: number;
    deliveryRatePercent: number | null;
    trueRoas: number | null;
  }[];
  daily: { date: string; spend: number; placed: number; delivered: number }[];
  cohortStillYoung: boolean;
}

const FUNNEL_LABELS: Record<FunnelStep["key"], { label: string; hint: string }> = {
  checkoutsStarted: {
    label: "Checkouts started",
    hint: "Reached the checkout form",
  },
  ordersPlaced: { label: "Orders placed", hint: "Pressed Place Order" },
  confirmed: { label: "Confirmed on the phone", hint: "Someone rang and they said yes" },
  delivered: { label: "Delivered", hint: "The only step that is money" },
};

/** Below this a boosted product is losing money on every parcel. */
const BREAK_EVEN_ROAS = 1;

export function PerformanceDashboard() {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<RangePreset>("last30");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);

  const query = rangeQuery(preset, custom);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ report: PerformanceReport }>(
        `admin/reports/performance${query}`,
      );
      setReport(data.report);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner or manager account can see how the advertising is doing."
            : caught.message
          : "Could not load the report.",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  /* Rebuilt whenever the range changes, and useLoad re-runs on that identity
     change — so switching a chip refetches with no extra effect. */
  useLoad(load);

  return (
    <AdminShell title="Performance">
      {/* One continuous report, not two independent columns: PageBody's default
          two-column grid at 2xl put the range chips alone on the left and every
          figure on the right, with half the window empty between them. */}
      <PageBody columns={false}>
        <RangePicker
          preset={preset}
          custom={custom}
          onPreset={(value) => {
            setCustom(null);
            setPreset(value);
          }}
          onCustom={(range) => setCustom(range)}
        />

        <AsyncState loading={loading} error={error} onRetry={() => void load()} empty={!report}>
          {report && (
            <div className="flex flex-col gap-5">
              <Headline report={report} />
              {/* Campaigns sit under the headline and above the funnel: the
                  headline is the verdict, campaigns are where it came from, and
                  the funnel explains why. */}
              <AdsCampaigns query={query} />
              <Funnel report={report} />
              <ByProduct report={report} />
              <Trend report={report} />
            </div>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The two numbers worth acting on: what a delivered order costs, and what the
 * spend actually returned.
 */
function Headline({ report }: { report: PerformanceReport }) {
  const { ads, delivery } = report;
  const profitable = ads.trueRoas !== null && ads.trueRoas >= BREAK_EVEN_ROAS;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric
        label="Ad spend"
        value={formatTaka(ads.spend)}
        note={ads.spend === 0 ? "Nothing recorded for this range" : "Recorded per product"}
      />
      <Metric
        label="Real return (ROAS)"
        value={ads.trueRoas === null ? "—" : `${ads.trueRoas.toFixed(2)}×`}
        tone={ads.trueRoas === null ? "plain" : profitable ? "good" : "bad"}
        note={
          ads.placedRoas === null
            ? "Record ad spend to see this"
            : `Ads Manager would say ${ads.placedRoas.toFixed(2)}×`
        }
      />
      <Metric
        label="Cost per delivered order"
        value={ads.costPerDeliveredOrder === null ? "—" : formatTaka(ads.costPerDeliveredOrder)}
        note={
          ads.attributedDelivered > 0
            ? `${ads.attributedDelivered} delivered from ads`
            : "No delivered ad orders yet"
        }
      />
      <Metric
        label="Delivery rate"
        value={delivery.ratePercent === null ? "—" : `${delivery.ratePercent}%`}
        tone={
          delivery.ratePercent === null ? "plain" : delivery.ratePercent >= 70 ? "good" : "warn"
        }
        note={`${delivery.delivered} of ${delivery.settled} settled${
          delivery.stillMoving > 0 ? ` · ${delivery.stillMoving} still moving` : ""
        }`}
      />

      {/* Said once, plainly, rather than as an asterisk on four tiles. */}
      <div className="sm:col-span-2 xl:col-span-4">
        <Card>
          <div className="flex flex-col gap-2 p-4 text-caption text-muted">
            <p>
              <strong className="text-ink">Ads Manager counts an order when it is placed.</strong>{" "}
              This page counts it when it arrives. On cash on delivery those are different numbers,
              and only the second one is money you can bank.
            </p>
            <p>
              {ads.attributionCoveragePercent}% of orders in this range carry a Facebook
              identifier, so the ad figures above are a floor — a shopper who saw the ad and came
              back later by typing the address carries nothing, and is not counted.
            </p>
            {report.cohortStillYoung && (
              <p className="flex items-start gap-1.5 text-ink">
                <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                <span>
                  Most of these orders are still on the road, so the delivery rate will move. Give
                  the range a few days before judging it.
                </span>
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Where shoppers are lost.
 *
 * A bar per step, each drawn against the widest step rather than against 100%,
 * so the shape of the drop-off is visible even when the first step dwarfs the
 * last.
 */
function Funnel({ report }: { report: PerformanceReport }) {
  const widest = Math.max(...report.funnel.map((step) => step.count), 1);

  return (
    <Card>
      <CardHeader title="Where the orders go" />
      <div className="flex flex-col gap-3 p-4 pt-0">
        {report.funnel.map((step) => {
          const meta = FUNNEL_LABELS[step.key];
          const width = Math.max((step.count / widest) * 100, step.count > 0 ? 4 : 0);

          return (
            <div key={step.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-caption font-medium text-ink">{meta.label}</span>
                <span className="flex items-baseline gap-2">
                  {step.ofPreviousPercent !== null && (
                    <span className="text-caption text-muted">{step.ofPreviousPercent}%</span>
                  )}
                  <span className="tnum text-body font-semibold text-ink">{step.count}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className={cn(
                    "h-full rounded-full",
                    step.key === "delivered" ? "bg-ink" : "bg-muted/40",
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>
              <p className="text-micro text-muted">{meta.hint}</p>
            </div>
          );
        })}

        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-caption text-muted">
          <span>
            Cancelled <strong className="tnum text-ink">{report.delivery.cancelled}</strong>
          </span>
          <span>
            Returned <strong className="tnum text-ink">{report.delivery.returned}</strong>
          </span>
          <span>
            Still moving <strong className="tnum text-ink">{report.delivery.stillMoving}</strong>
          </span>
        </div>
      </div>
    </Card>
  );
}

/**
 * Which boosts paid for themselves.
 *
 * Only products with recorded spend appear — a product nobody boosted has no
 * answer to give here, and the profit page already ranks the whole catalogue.
 */
function ByProduct({ report }: { report: PerformanceReport }) {
  return (
    <Card>
      <CardHeader
        title="By product"
        hint="Every delivered order for the product while it was boosted — not only the ones traceable to a click, so these returns read higher than the figure above"
      />
      {report.byProduct.length === 0 ? (
        <p className="px-4 pb-4 text-caption text-muted">
          Nothing to compare yet. Record what a product cost to boost on the Profit page, and its
          return shows up here.
        </p>
      ) : (
        <TableWrap>
          <table className="w-full text-caption">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 text-right font-medium">Spent</th>
                <th className="px-4 py-2 text-right font-medium">Placed</th>
                <th className="px-4 py-2 text-right font-medium">Delivered</th>
                <th className="px-4 py-2 text-right font-medium">Rate</th>
                <th className="px-4 py-2 text-right font-medium">Earned</th>
                <th className="px-4 py-2 text-right font-medium">Return</th>
              </tr>
            </thead>
            <tbody>
              {report.byProduct.map((row) => {
                const losing = row.trueRoas !== null && row.trueRoas < BREAK_EVEN_ROAS;

                return (
                  <tr key={row.productId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{row.productName}</td>
                    <td className="tnum px-4 py-2.5 text-right">{formatTaka(row.spend)}</td>
                    <td className="tnum px-4 py-2.5 text-right">{row.placed}</td>
                    <td className="tnum px-4 py-2.5 text-right">{row.delivered}</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">
                      {row.deliveryRatePercent === null ? "—" : `${row.deliveryRatePercent}%`}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">
                      {formatTaka(row.deliveredValue)}
                    </td>
                    <td
                      className={cn(
                        "tnum px-4 py-2.5 text-right font-semibold",
                        row.trueRoas === null ? "text-muted" : losing ? "text-sale" : "text-ink",
                      )}
                    >
                      {row.trueRoas === null ? "—" : `${row.trueRoas.toFixed(2)}×`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

/**
 * Day by day.
 *
 * Spend and delivered orders on one axis each, drawn as paired bars rather than
 * a line: an owner reads this to spot the day a boost stopped working, and two
 * bars side by side answer that faster than two lines crossing.
 */
function Trend({ report }: { report: PerformanceReport }) {
  const days = report.daily;
  const maxSpend = Math.max(...days.map((day) => day.spend), 1);
  const maxOrders = Math.max(...days.map((day) => day.placed), 1);
  const anything = days.some((day) => day.spend > 0 || day.placed > 0);

  return (
    <Card>
      <CardHeader title="Day by day" hint="Spend against orders placed" />
      {!anything ? (
        <p className="px-4 pb-4 text-caption text-muted">Nothing recorded in this range.</p>
      ) : (
        <div className="overflow-x-auto px-4 pb-4">
          <div className="flex min-w-max items-end gap-1">
            {days.map((day) => (
              <div key={day.date} className="flex w-6 flex-col items-center gap-1" title={day.date}>
                <div className="flex h-24 items-end gap-0.5">
                  <div
                    className="w-2 rounded-t bg-muted/40"
                    style={{ height: `${(day.spend / maxSpend) * 100}%` }}
                    title={`Spent ${formatTaka(day.spend)}`}
                  />
                  <div
                    className="w-2 rounded-t bg-ink"
                    style={{ height: `${(day.placed / maxOrders) * 100}%` }}
                    title={`${day.placed} placed, ${day.delivered} delivered`}
                  />
                </div>
                <span className="text-micro text-muted">{day.date.slice(8)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-micro text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-muted/40" /> Ad spend
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-ink" /> Orders placed
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function Metric({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "good" | "bad" | "warn";
}) {
  return (
    <Card>
      <div className="flex flex-col gap-1 p-4">
        <span className="text-caption text-muted">{label}</span>
        <span
          className={cn(
            "tnum text-title font-semibold",
            tone === "good" && "text-positive",
            tone === "bad" && "text-sale",
            tone === "warn" && "text-warn",
            tone === "plain" && "text-ink",
          )}
        >
          {value}
        </span>
        {note && <span className="text-micro text-muted">{note}</span>}
      </div>
    </Card>
  );
}
