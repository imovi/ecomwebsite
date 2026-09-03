"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatTaka, formatDateTime, cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type {
  ApiOrderListItem,
  ApiOrderStatus,
  ApiOverview,
  ApiProductListItem,
} from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { CallListDrawer } from "./CallListDrawer";
import { ManualOrderFields } from "./ManualOrderForm";
import { OverviewInsights, CourierCash, SourcesCard } from "./OverviewInsights";
import { SalesChart } from "./SalesChart";
import { LiveTrafficOverview } from "./LiveTrafficOverview";
import {
  AsyncState,
  Card,
  CardHeader,
  DateRangeFilter,
  resolveDateRange,
  shopDayEnd,
  shopDayStart,
  type DateRange,
  type DateRangePreset,
} from "./ui";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";

/**
 * Overview.
 *
 * Answers what needs doing on opening the panel: who needs a call, what has
 * stopped moving, what is running out, and — for `admin` and above — what the
 * range has actually taken.
 *
 * ONE CLOCK
 * ---------
 * The range picker now drives everything the API can date: the money, the
 * chart, the pipeline, the sources, the return rate, the courier record and the
 * call list. It used to drive only the status tiles, with the takings pinned to
 * today-against-yesterday under a label reading "not affected by the filter
 * above". The label was true and the screen was still misread, because nobody
 * selects Last 30 days and then expects the revenue beside the tiles to be
 * answering a different question.
 *
 * Two things stay outside it, and say so on their own faces: the stock forecast
 * and the parcels that stopped moving. Both are states rather than histories —
 * an out-of-stock warning that vanished because the picker said "yesterday"
 * would be a warning that failed at its one job.
 *
 * WHAT IS NOT ON THIS SCREEN, AND WHY
 * -----------------------------------
 * A visitors-to-orders conversion rate. Nothing in this system counts visitors:
 * there are no sessions, no page-view rows and no bot filtering, so the figure
 * could only be invented. What is counted — and shown instead — is the
 * checkout: of the people who typed a name and a working number, how many
 * finished. Everything above that line is a question for the Meta pixel and
 * Google Analytics, which do count visitors and are already installed.
 */
export function Overview() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<ApiOrderListItem[]>([]);
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [drafts, setDrafts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ApiOverview | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [callListOpen, setCallListOpen] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);

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
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(
    null,
  );

  const range: DateRange = custom
    ? { dateFrom: shopDayStart(custom.from), dateTo: shopDayEnd(custom.to) }
    : resolveDateRange(preset);

  const { dateFrom, dateTo } = range;

  const load = useCallback(async () => {
    try {
      /* Four independent reads — in parallel, since the slowest one sets the
         time to first paint. */
      const [statusCounts, orders, activeProducts, draftProducts] =
        await Promise.all([
          adminApi.get<{ counts: Record<string, number> }>(
            `admin/orders/status-counts${qs({ dateFrom, dateTo })}`,
          ),
          /* The same window as the tiles: a list headed by counts it does not
           match reads as a bug in both. */
          adminApi.list<ApiOrderListItem>(
            `admin/orders${qs({ dateFrom, dateTo, perPage: 8 })}`,
          ),
          adminApi.list<ApiProductListItem>(
            `admin/products${qs({ perPage: 100, status: "active" })}`,
          ),
          adminApi.list<ApiProductListItem>(
            `admin/products${qs({ perPage: 1, status: "draft" })}`,
          ),
        ]);

      setCounts(statusCounts.counts);
      setRecent(orders.items);
      setProducts(activeProducts.items);
      setDrafts(draftProducts.pagination?.total ?? draftProducts.items.length);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Could not load the overview.",
      );
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
      const response = await adminApi.get<{ overview: ApiOverview }>(
        `admin/overview${qs({ dateFrom, dateTo })}`,
      );
      setSummary(response.overview);
      setSummaryError(null);
    } catch (caught) {
      setSummary(null);
      setSummaryError(
        caught instanceof AdminApiError
          ? caught.message
          : "Could not load the summary.",
      );
    }
  }, [dateFrom, dateTo]);

  useLoad(load);
  useLoad(loadSummary);

  const refresh = useCallback(() => {
    void load();
    void loadSummary();
  }, [load, loadSummary]);

  /* Out of stock is a different job from nearly out: one is a product taking
     orders it cannot fill, the other is a reorder reminder. */
  const outOfStock = products.filter((product) => product.stockQuantity === 0);

  /**
   * The dashboard's window, in the form the order queue reads it back.
   *
   * A tile that counts thirty days and opens a queue showing today would show
   * a different number from the one that was just clicked — which reads as a
   * bug in both screens rather than as two different questions.
   */
  const queueQuery = custom
    ? `&from=${custom.from}&to=${custom.to}`
    : `&range=${preset}`;

  const parcels = summary?.parcels;
  const stuckParcels = parcels?.needsAttention ?? 0;
  const calls = summary?.callList;
  const money = summary?.money;

  return (
    <AdminShell
      title="Overview"
      action={
        <Button size="sm" onClick={() => setNewOrderOpen(true)}>
          <Icon name="plus" size={14} />
          Create order
        </Button>
      }
    >
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

        <AsyncState
          loading={loading}
          error={error}
          onRetry={() => {
            setLoading(true);
            refresh();
          }}
        >
          {/* Everything that wants doing, in one strip, worst first. */}
          <div className="flex flex-col gap-2">
            {outOfStock.length > 0 && (
              <div className="rounded-md border border-sale/25 bg-sale-soft px-4 py-3">
                <p className="text-caption font-medium text-sale">
                  {outOfStock.length} live product
                  {outOfStock.length === 1 ? " is" : "s are"} out of stock and
                  still taking orders
                </p>
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {outOfStock.slice(0, 5).map((product) => (
                    <li key={product.id} className="text-micro text-sale">
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="hover:underline"
                      >
                        {product.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {stuckParcels > 0 && parcels && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-sale/25 bg-sale-soft px-4 py-3">
                <p className="flex-1 text-caption font-medium text-sale">
                  {stuckParcels} of {parcels.inTransit} parcel
                  {parcels.inTransit === 1 ? "" : "s"} with the courier{" "}
                  {stuckParcels === 1 ? "has" : "have"} stopped moving
                  {parcels.failing > 0 &&
                    ` — ${parcels.failing} failing to sync`}
                  .
                </p>
                <Button href="/admin/orders" variant="soft" size="sm">
                  Open orders
                </Button>
              </div>
            )}

            {calls && calls.abandonedOpen > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/25 bg-warn-soft px-4 py-3">
                <p className="flex-1 text-caption font-medium text-warn">
                  {calls.abandonedOpen} customer
                  {calls.abandonedOpen === 1 ? "" : "s"} started a checkout and
                  left without ordering
                  {/* The value is the reason anyone opens this. A count alone
                      does not say whether it is worth the afternoon. */}
                  {calls.abandonedValue > 0 && (
                    <>
                      {" "}
                      — {formatTaka(calls.abandonedValue)} of goods left in
                      baskets
                    </>
                  )}
                  .
                </p>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => setCallListOpen(true)}
                >
                  <Icon name="phone" size={14} />
                  Call list ({calls.abandonedOpen})
                </Button>
              </div>
            )}

            {drafts > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-white px-4 py-3">
                <p className="flex-1 text-caption text-ink-soft">
                  {drafts} product{drafts === 1 ? "" : "s"} still in draft — not
                  visible to customers.
                </p>
                <Button href="/admin/products" variant="soft" size="sm">
                  Review drafts
                </Button>
              </div>
            )}
          </div>

          {summaryError && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-white px-4 py-3">
              <p className="flex-1 text-caption text-ink-soft">
                {summaryError} The figures, the chart and the call list are
                missing — the queue below is unaffected.
              </p>
              <Button
                variant="soft"
                size="sm"
                onClick={() => void loadSummary()}
              >
                Try again
              </Button>
            </div>
          )}

          <LiveTrafficOverview />

          {summary && <Kpis overview={summary} />}

          {summary && (
            <Card>
              <CardHeader
                title={money ? "Sales and orders" : "Orders"}
                hint={
                  summary.range.bucket === "hour"
                    ? "By the hour, in Dhaka time."
                    : "By the day, in Dhaka time."
                }
              />
              <SalesChart
                points={summary.series}
                range={summary.range}
                bucket={summary.range.bucket}
                showMoney={Boolean(money)}
              />
            </Card>
          )}

          <Pipeline counts={counts} query={queueQuery} />

          {money && money.courierCash.length > 0 && (
            <CourierCash rows={money.courierCash} />
          )}

          {summary && <OverviewInsights overview={summary} />}

          {summary && (
            <SourcesCard sources={summary.sources} returns={summary.returns} />
          )}

          <Card>
            <CardHeader title="Latest orders" />
            {recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-caption text-muted">
                No orders in this range. Once your products are live and the ads
                are running, they land here.
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
                          <Badge
                            tone={
                              order.status === "pending" ? "warn" : "neutral"
                            }
                          >
                            {copy.orderStatus[order.status as ApiOrderStatus]}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-micro text-muted">
                          {order.customerName} ·{" "}
                          {formatDateTime(order.createdAt)}
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

      <CallListDrawer
        open={callListOpen}
        onClose={() => setCallListOpen(false)}
        onWorked={refresh}
      />

      {/* The same form as `/admin/orders/new`, not a second copy of it. On save
          it navigates to the order it created, which is where the next thing —
          booking a courier — happens. */}
      <Sheet
        open={newOrderOpen}
        onClose={() => setNewOrderOpen(false)}
        title="New order"
        className="sm:max-w-2xl"
      >
        <ManualOrderFields />
      </Sheet>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The headline figures.
 *
 * Ordered and delivered sit side by side and are never added together. On cash
 * on delivery they are different things: ordered is a promise, delivered is
 * cash that arrived. The comparison underneath is the window before this one of
 * equal length, so it means the same thing whichever range is picked.
 */
function Kpis({ overview }: { overview: ApiOverview }) {
  const { money, funnel } = overview;

  const completion =
    funnel.started > 0
      ? Math.round((funnel.completed / funnel.started) * 100)
      : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
      {money && (
        <>
          <Kpi
            label="Ordered"
            value={formatTaka(money.current.placedValue)}
            delta={delta(money.current.placedValue, money.previous.placedValue)}
            foot={`${money.current.placedOrders} order${money.current.placedOrders === 1 ? "" : "s"} placed`}
          />

          <Kpi
            label="Delivered"
            value={formatTaka(money.current.delivered)}
            tone={money.current.delivered > 0 ? "positive" : "neutral"}
            delta={delta(money.current.delivered, money.previous.delivered)}
            foot={`${money.current.deliveredOrders} of ${money.current.placedOrders} placed`}
          />

          <Kpi
            label="Average order"
            /* Null rather than ৳0. An average of nothing does not exist, and a
               zero here reads as "our orders are worthless". */
            value={
              money.averageOrderValue === null
                ? "—"
                : formatTaka(money.averageOrderValue)
            }
            foot={
              money.averageOrderValue === null
                ? "Nothing delivered yet in this range"
                : "Across delivered orders"
            }
          />

          <Kpi
            label="Net profit"
            value={money.profit === null ? "—" : formatTaka(money.profit.net)}
            tone={money.profit && money.profit.net > 0 ? "positive" : "neutral"}
            foot={profitFoot(money.profit)}
          />
        </>
      )}

      <Kpi
        label="Checkouts finished"
        value={completion === null ? "—" : `${completion}%`}
        foot={
          completion === null
            ? "Nobody reached the checkout in this range"
            : `${funnel.completed} of ${funnel.started} who typed a name and number`
        }
      />
    </div>
  );
}

function profitFoot(
  profit: NonNullable<ApiOverview["money"]>["profit"],
): string {
  if (profit === null) return "The profit report could not be produced";
  if (!profit.costsComplete) {
    /* Uncosted sales sit in the denominator while contributing nothing to the
       numerator, so the margin reads LOWER than reality — which a shop about to
       act on it needs to be told, not left to discover. */
    return `Margin is understated — ${formatTaka(profit.revenueWithUnknownCost)} of sales have no cost recorded`;
  }
  return profit.marginPercent === null
    ? "No revenue in this range"
    : `${profit.marginPercent}% margin, after costs and courier`;
}

/** Null when there is nothing to compare against — not "+100%". */
function delta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function Kpi({
  label,
  value,
  foot,
  delta: change,
  tone = "neutral",
}: {
  label: string;
  value: string;
  foot: string;
  delta?: number | null;
  tone?: "neutral" | "positive";
}) {
  return (
    <div className="flex flex-col rounded-md border border-line bg-white px-4 py-3.5">
      <p className="text-micro uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "tnum mt-1 text-[22px] font-semibold leading-tight",
          tone === "positive" ? "text-positive" : "text-ink",
        )}
      >
        {value}
      </p>

      {change !== null && change !== undefined && (
        <p
          className={cn(
            "tnum mt-0.5 text-micro font-medium",
            change > 0
              ? "text-positive"
              : change < 0
                ? "text-sale"
                : "text-muted",
          )}
        >
          {change > 0 ? "+" : ""}
          {change}% vs the range before
        </p>
      )}

      <p className="mt-1 text-micro text-muted">{foot}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Where every order in the range currently stands.
 *
 * Six stages rather than the four that were here, because the four hid the two
 * that cost money: an order sitting in `processing` nobody packed, and the
 * returns. `cancelled` and `returned` share a tile — both are an order that
 * earned nothing, and splitting them across the row buried each in a corner.
 *
 * These are CURRENT statuses of orders placed in the range, so they do not add
 * up to a journey: an order delivered today is counted once, under Delivered.
 */
const STAGES: {
  key: string;
  label: string;
  hint: string;
  tone: "neutral" | "warn" | "positive" | "sale";
  /** A second status folded into the same tile. */
  extra?: string;
  /** What the queue should filter by. Defaults to `key`. */
  filter?: string;
}[] = [
  {
    key: "pending",
    label: "Needs a call",
    hint: "Not confirmed yet",
    tone: "warn",
  },
  {
    key: "confirmed",
    label: "Confirmed",
    hint: "Ready to pack",
    tone: "neutral",
  },
  {
    key: "processing",
    label: "Being packed",
    hint: "Processing and packed",
    tone: "neutral",
    extra: "packed",
    filter: "processing,packed",
  },
  {
    key: "shipped",
    label: "Out for delivery",
    hint: "With the courier",
    tone: "neutral",
  },
  {
    key: "delivered",
    label: "Delivered",
    hint: "Cash collected",
    tone: "positive",
  },
  {
    key: "cancelled",
    label: "Cancelled or back",
    hint: "Earned nothing",
    tone: "sale",
    extra: "returned",
    /* Both, or the tile counts two statuses and opens a queue showing one. */
    filter: "cancelled,returned",
  },
];

function Pipeline({
  counts,
  query,
}: {
  counts: Record<string, number>;
  /** The dashboard's own window, carried through to the queue. */
  query: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Where the orders are"
        hint="Current status of orders placed in this range."
      />
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((stage) => {
          const value =
            (counts[stage.key] ?? 0) +
            (stage.extra ? (counts[stage.extra] ?? 0) : 0);

          return (
            <Link
              key={stage.key}
              href={`/admin/orders?status=${stage.filter ?? stage.key}${query}`}
              className="rounded-md border border-line bg-white px-3 py-2.5 hover:bg-surface"
            >
              <p className="text-micro uppercase tracking-wide text-muted">
                {stage.label}
              </p>
              <p
                className={cn(
                  "tnum mt-1 text-[20px] font-semibold leading-tight",
                  value === 0
                    ? "text-muted"
                    : stage.tone === "warn"
                      ? "text-warn"
                      : stage.tone === "positive"
                        ? "text-positive"
                        : stage.tone === "sale"
                          ? "text-sale"
                          : "text-ink",
                )}
              >
                {value}
              </p>
              <p className="mt-0.5 text-micro text-muted">{stage.hint}</p>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
