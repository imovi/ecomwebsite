"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { formatTaka, formatDateTime } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type { ApiOrderListItem, ApiOrderStatus } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, TableWrap } from "./ui";
import { Badge } from "@/components/ui/Badge";

/** Matches the storefront's status vocabulary so staff and customer agree. */
const STATUS_TONE: Record<ApiOrderStatus, "neutral" | "positive" | "warn" | "saleSoft" | "ink"> = {
  pending: "warn",
  confirmed: "ink",
  processing: "ink",
  packed: "ink",
  shipped: "ink",
  delivered: "positive",
  cancelled: "saleSoft",
  returned: "saleSoft",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "New" },
  { value: "confirmed", label: "Confirmed" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Order queue.
 *
 * Defaults to newest first with no status filter, so the first thing on screen
 * is whatever came in most recently — which on a COD store is the thing that
 * needs a confirmation call.
 */
export function OrderList() {
  const [orders, setOrders] = useState<ApiOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, pagination } = await adminApi.list<ApiOrderListItem>(
        `admin/orders${qs({ status, q: search, perPage: 50 })}`,
      );
      setOrders(items);
      setTotal(pagination?.total ?? items.length);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <AdminShell title="Orders">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={
                status === filter.value
                  ? "shrink-0 rounded-sm bg-ink px-3 py-1.5 text-caption font-medium text-white"
                  : "shrink-0 rounded-sm bg-white px-3 py-1.5 text-caption text-ink-soft ring-1 ring-line hover:bg-surface"
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Order number, name or phone"
          aria-label="Search orders"
          className="h-10 min-w-[200px] flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none placeholder:text-muted focus:border-ink"
        />

        <span className="tnum text-caption text-muted">{total} total</span>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={orders.length === 0}
        emptyMessage={search || status ? "No orders match this filter." : "No orders yet."}
        onRetry={() => void load()}
      >
        <TableWrap>
          <div className="overflow-hidden rounded-md border border-line bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface text-micro uppercase tracking-wide text-muted">
                  <th className="px-3 py-2.5 font-medium">Order</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Total</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/admin/orders/${order.orderNumber}`}
                        className="block text-caption font-semibold text-ink hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                      <span className="block text-micro text-muted">
                        {formatDateTime(order.createdAt)}
                      </span>
                    </td>

                    <td className="px-3 py-2.5">
                      <span className="block truncate text-caption text-ink">
                        {order.customerName}
                      </span>
                      {/* Tappable: confirmation calls are the whole workflow. */}
                      <a
                        href={`tel:${order.phone}`}
                        className="tnum block text-micro text-muted hover:text-ink"
                      >
                        {order.phone}
                      </a>
                    </td>

                    <td className="px-3 py-2.5">
                      <span className="tnum block whitespace-nowrap text-caption font-medium text-ink">
                        {formatTaka(order.grandTotal)}
                      </span>
                      <span className="block text-micro text-muted">
                        {order.totalQuantity} item{order.totalQuantity === 1 ? "" : "s"} ·{" "}
                        {order.deliveryZone === "inside_dhaka" ? "Dhaka" : "Outside"}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge tone={STATUS_TONE[order.status]}>
                        {copy.orderStatus[order.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableWrap>
      </AsyncState>
    </AdminShell>
  );
}
