"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatTaka, formatDateTime } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type {
  ApiOrderListItem,
  ApiOrderStatus,
  ApiOverview,
  ApiProductListItem,
} from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import {
  AsyncState,
  Card,
  CardHeader,
  DateRangeFilter,
  resolveDateRange,
  shopDayEnd,
  shopDayStart,
  Stat,
  type DateRange,
  type DateRangePreset,
} from "./ui";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

/**
 * Overview.
 *
 * Answers what needs doing on opening the panel: who needs a call, what has
 * stopped moving, what is running out, and — for `admin` and above — what the
 * day has actually taken.
 *
 * TWO CLOCKS ON ONE SCREEN
 * ------------------------
 * The status tiles and the latest orders follow the range picker. The summary
 * below it does not: money is today against yesterday, the source split is a
 * month, returns are a week. Those windows are fixed because they are only
 * meaningful at a fixed length — a return rate over "today" is noise, and a
 * chosen range of last March would make the money tiles answer a question
 * nobody asked. So every fixed-window card says its own window in its header.
 * A number whose window is not stated is a number that will be misread.
 */
export function Overview() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<ApiOrderListItem[]>([]);
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [drafts, setDrafts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* The fixed-window summary. Kept in its own state, and loaded by its own
     effect, so changing the range picker does not re-run aggregates that the
     range cannot affect. */
  const [summary, setSummary] = useState<ApiOverview | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  /**
   * Today by default.
   *
   * The panel is opened to see how the day is going, and an all-time count of
   * delivered orders answers nothing about that. The cost is real and worth
   * knowing: a pending order placed three days ago is outside today's window,
   * so it is not in "Needs a call" until the range is widened. Orders itself
   * is unfiltered and remains the queue of record.
   */
  const [preset, setPreset] = useState<DateRangePreset>("today");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);

  const range: DateRange = custom
    ? { dateFrom: shopDayStart(custom.from), dateTo: shopDayEnd(custom.to) }
    : resolveDateRange(preset);

  const { dateFrom, dateTo } = range;

  const load = useCallback(async () => {
    try {
      /* Four independent reads — in parallel, since the slowest one sets the
         time to first paint. */
      const [statusCounts, orders, activeProducts, draftProducts] = await Promise.all([
        adminApi.get<{ counts: Record<string, number> }>(
          `admin/orders/status-counts${qs({ dateFrom, dateTo })}`,
        ),
        /* The same window as the tiles: a list headed by counts it does not
           match reads as a bug in both. */
        adminApi.list<ApiOrderListItem>(`admin/orders${qs({ dateFrom, dateTo, perPage: 8 })}`),
        adminApi.list<ApiProductListItem>(`admin/products${qs({ perPage: 100, status: "active" })}`),
        adminApi.list<ApiProductListItem>(`admin/products${qs({ perPage: 1, status: "draft" })}`),
      ]);

      setCounts(statusCounts.counts);
      setRecent(orders.items);
      setProducts(activeProducts.items);
      setDrafts(draftProducts.pagination?.total ?? draftProducts.items.length);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the overview.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  /**
   * The summary loads separately, and says so when it fails.
   *
   * It is extra context, not the screen's job: if this one endpoint is down the
   * order desk should still get its queue and its call list, so a failure here
   * does not replace the whole overview with an error. But it does not vanish
   * either — cards that quietly stop appearing look like a feature that was
   * removed, and nobody reports a number they have stopped expecting. So the
   * failure gets its own line, with its own retry.
   */
  const loadSummary = useCallback(async () => {
    try {
      const response = await adminApi.get<{ overview: ApiOverview }>("admin/overview");
      setSummary(response.overview);
      setSummaryError(null);
    } catch (caught) {
      setSummary(null);
      setSummaryError(
        caught instanceof AdminApiError ? caught.message : "Could not load today's summary.",
      );
    }
  }, []);

  useLoad(load);
  useLoad(loadSummary);

  /* Out of stock is a different job from nearly out: one is a product taking
     orders it cannot fill, the other is a reorder reminder. They were one list
     and the urgent half hid inside the routine half. */
  const outOfStock = products.filter((product) => product.stockQuantity === 0);
  const lowStock = products.filter(
    (product) => product.isLowStock && product.stockQuantity > 0,
  );

  const parcels = summary?.parcels;
  const stuckParcels = parcels?.needsAttention ?? 0;
  const abandonedOpen = summary?.callList.abandonedOpen ?? 0;

  return (
    <AdminShell title="Overview">
      <div className="flex flex-col gap-4">
        <DateRangeFilter
          preset={preset}
          custom={custom}
          onPreset={(value) => {
            setCustom(null);
            setPreset(value);
          }}
          onCustom={setCustom}
        />

        <AsyncState loading={loading} error={error} onRetry={() => {
            setLoading(true);
            void load();
            void loadSummary();
          }}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Needs a call"
              value={counts.pending ?? 0}
              tone={(counts.pending ?? 0) > 0 ? "warn" : "neutral"}
            />
            <Stat label="Confirmed" value={counts.confirmed ?? 0} />
            <Stat label="Out for delivery" value={counts.shipped ?? 0} />
            <Stat
              label="Delivered"
              value={counts.delivered ?? 0}
              tone={(counts.delivered ?? 0) > 0 ? "positive" : "neutral"}
            />
          </div>

          {/* Everything that wants doing, in one strip, worst first. */}
          {(stuckParcels > 0 ||
            outOfStock.length > 0 ||
            abandonedOpen > 0 ||
            lowStock.length > 0 ||
            drafts > 0) && (
            <div className="flex flex-col gap-2">
              {stuckParcels > 0 && parcels && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-sale/25 bg-sale-soft px-4 py-3">
                  <p className="flex-1 text-caption font-medium text-sale">
                    {stuckParcels} of {parcels.inTransit} parcel
                    {parcels.inTransit === 1 ? "" : "s"} with the courier{" "}
                    {stuckParcels === 1 ? "has" : "have"} stopped moving
                    {parcels.failing > 0 && ` — ${parcels.failing} failing to sync`}.
                  </p>
                  <Button href="/admin/courier" variant="soft" size="sm">
                    Check parcels
                  </Button>
                </div>
              )}

              {outOfStock.length > 0 && (
                <div className="rounded-md border border-sale/25 bg-sale-soft px-4 py-3">
                  <p className="text-caption font-medium text-sale">
                    {outOfStock.length} live product{outOfStock.length === 1 ? " is" : "s are"} out
                    of stock and still taking orders
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {outOfStock.slice(0, 5).map((product) => (
                      <li key={product.id} className="text-micro text-sale">
                        <Link href={`/admin/products/${product.id}`} className="hover:underline">
                          {product.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {abandonedOpen > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/25 bg-warn-soft px-4 py-3">
                  <p className="flex-1 text-caption font-medium text-warn">
                    {abandonedOpen} customer{abandonedOpen === 1 ? "" : "s"} started a checkout and
                    left without ordering.
                  </p>
                  <Button href="/admin/abandoned" variant="soft" size="sm">
                    Call list
                  </Button>
                </div>
              )}

              {lowStock.length > 0 && (
                <div className="rounded-md border border-warn/25 bg-warn-soft px-4 py-3">
                  <p className="text-caption font-medium text-warn">
                    {lowStock.length} live product{lowStock.length === 1 ? "" : "s"} running low
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {lowStock.slice(0, 5).map((product) => (
                      <li key={product.id} className="text-micro text-warn">
                        <Link href={`/admin/products/${product.id}`} className="hover:underline">
                          {product.name} — {product.stockQuantity} left
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {drafts > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-white px-4 py-3">
                  <p className="flex-1 text-caption text-ink-soft">
                    {drafts} product{drafts === 1 ? "" : "s"} still in draft — not visible to
                    customers.
                  </p>
                  <Button href="/admin/products" variant="soft" size="sm">
                    Review drafts
                  </Button>
                </div>
              )}
            </div>
          )}

          {summaryError && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-white px-4 py-3">
              <p className="flex-1 text-caption text-ink-soft">
                {summaryError} Today&rsquo;s figures and the source split are missing — the queue
                above is unaffected.
              </p>
              <Button variant="soft" size="sm" onClick={() => void loadSummary()}>
                Try again
              </Button>
            </div>
          )}

          {summary?.money && <MoneyCard money={summary.money} />}

          {summary && <SourcesCard sources={summary.sources} returns={summary.returns} />}

          <Card>
            <CardHeader title="Latest orders" />
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-caption text-muted">
                No orders yet. Once your products are live and the ads are running, they land here.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((order) => (
                  <li key={order.id}>
                    {/* Two lines rather than four columns. Across a phone the
                        single row squeezed the customer and the time into a
                        truncated stub — the two facts that tell you whether
                        this order still needs a call. */}
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-surface"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-caption font-semibold text-ink">
                            {order.orderNumber}
                          </p>
                          <Badge tone={order.status === "pending" ? "warn" : "neutral"}>
                            {copy.orderStatus[order.status as ApiOrderStatus]}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-micro text-muted">
                          {order.customerName} · {formatDateTime(order.createdAt)}
                        </p>
                      </div>
                      <span className="tnum shrink-0 text-caption font-medium text-ink">
                        {formatTaka(order.grandTotal)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </AsyncState>
      </div>
    </AdminShell>
  );
}

/**
 * Today's money.
 *
 * Taken and ordered are shown side by side and never added together. On cash on
 * delivery they are different things: ordered is a promise, taken is cash that
 * arrived. Yesterday sits underneath as a whole day rather than as a percentage,
 * because at ten in the morning a percentage against a finished day says only
 * that the day is young.
 */
function MoneyCard({ money }: { money: NonNullable<ApiOverview["money"]> }) {
  const { today, yesterday } = money;

  return (
    <Card>
      <CardHeader title="Today" hint="Not affected by the filter above." />
      <div className="grid grid-cols-2 gap-3 p-4">
        <Stat
          label="Taken (delivered)"
          value={formatTaka(today.delivered)}
          tone={today.delivered > 0 ? "positive" : "neutral"}
        />
        <Stat label="Ordered" value={formatTaka(today.placedValue)} />
      </div>
      <p className="border-t border-line px-4 py-3 text-micro text-muted">
        {today.deliveredOrders} delivered · {today.placedOrders} placed. All of yesterday:{" "}
        {formatTaka(yesterday.delivered)} taken from {yesterday.deliveredOrders}, and{" "}
        {formatTaka(yesterday.placedValue)} ordered.
      </p>
    </Card>
  );
}

/**
 * Where the orders come from, and how many come back.
 *
 * The source is written down when an order is typed in by hand; a blank one is
 * the storefront doing its job unaided. Worth a place on the first screen
 * because it is the only answer to "is answering messages worth the time".
 */
function SourcesCard({
  sources,
  returns,
}: {
  sources: ApiOverview["sources"];
  returns: ApiOverview["returns"];
}) {
  const total = sources.breakdown.reduce((sum, row) => sum + row.orders, 0);

  /* A rate needs a denominator. Nothing settled means no rate exists — not
     zero percent, which would read as "nothing came back" on a week where
     nothing finished either. */
  const returnRate =
    returns.settled > 0 ? Math.round((returns.returned / returns.settled) * 100) : null;

  return (
    <Card>
      <CardHeader
        title="Where orders come from"
        hint={`Last ${sources.windowDays} days. Not affected by the filter above.`}
      />
      {total === 0 ? (
        <p className="px-4 py-6 text-center text-caption text-muted">
          No orders in the last {sources.windowDays} days.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5 p-4">
          {sources.breakdown.map((row) => {
            const share = Math.round((row.orders / total) * 100);
            return (
              <li key={row.source ?? "storefront"}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-caption text-ink">{row.source ?? "Website checkout"}</span>
                  <span className="tnum shrink-0 text-micro text-muted">
                    {row.orders} · {share}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className={row.source ? "h-full bg-warn" : "h-full bg-ink-soft"}
                    style={{ width: `${share}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line px-4 py-3 text-micro text-muted">
        {returnRate === null
          ? `Nothing has finished delivering in the last ${returns.windowDays} days, so there is no return rate yet.`
          : `${returnRate}% came back in the last ${returns.windowDays} days — ${returns.returned} returned of ${returns.settled} finished.`}
      </p>
    </Card>
  );
}
