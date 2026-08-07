"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatTaka, formatDateTime } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type { ApiOrderListItem, ApiOrderStatus, ApiProductListItem } from "@/lib/api/types";
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
 * Answers the three questions worth asking on opening the panel: what needs a
 * call, what is running out, and is anything unpublished. Deliberately not a
 * revenue dashboard — analytics were explicitly out of scope, and a chart here
 * would be a chart nobody acts on.
 */
export function Overview() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<ApiOrderListItem[]>([]);
  const [lowStock, setLowStock] = useState<ApiProductListItem[]>([]);
  const [drafts, setDrafts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const [statusCounts, orders, products, draftProducts] = await Promise.all([
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
      setLowStock(
        products.items.filter((product) => product.isLowStock || product.stockQuantity === 0),
      );
      setDrafts(draftProducts.pagination?.total ?? draftProducts.items.length);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the overview.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useLoad(load);

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

          {(lowStock.length > 0 || drafts > 0) && (
            <div className="flex flex-col gap-2">
              {lowStock.length > 0 && (
                <div className="rounded-md border border-warn/25 bg-warn-soft px-4 py-3">
                  <p className="text-caption font-medium text-warn">
                    {lowStock.length} live product{lowStock.length === 1 ? "" : "s"} low or out of
                    stock
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
