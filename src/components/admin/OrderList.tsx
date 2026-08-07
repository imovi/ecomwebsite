"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { downloadCsv, toCsv } from "@/lib/admin/csv";
import { formatTaka, formatDateTime } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type { ApiOrderListItem, ApiOrderStatus } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import {
  AsyncState,
  DateRangeFilter,
  OrderTabs,
  resolveDateRange,
  shopDayEnd,
  shopDayStart,
  TableWrap,
  type DateRange,
  type DateRangePreset,
} from "./ui";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

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

/**
 * Densities the print sheet tiles evenly onto A4.
 *
 * Mirrors `SHEET_LAYOUTS` in the API's invoice service. Only counts that fill
 * a page in whole rows are offered — anything else leaves cells of differing
 * height and the stack cannot be cut apart in straight lines.
 */
const SHEET_SIZES = [1, 2, 4, 6, 9] as const;

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
  /* Ids, not indexes: the list reloads under the selection whenever the range,
     status or search changes, and an index would then point at a different
     order with nothing looking wrong. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /* Four to a page is the useful default: a 2×2 cell is large enough to read
     an address off at arm's length, and it quarters the paper. */
  const [perSheet, setPerSheet] = useState<number>(4);

  /* Today by default: this screen is worked through day by day, and a queue
     that opens on every order ever placed buries the ones that arrived this
     morning. The other presets are one tap away when something older is
     being chased. */
  const [preset, setPreset] = useState<DateRangePreset>("today");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);

  const range: DateRange = custom
    ? { dateFrom: shopDayStart(custom.from), dateTo: shopDayEnd(custom.to) }
    : resolveDateRange(preset);

  const { dateFrom, dateTo } = range;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, pagination } = await adminApi.list<ApiOrderListItem>(
        `admin/orders${qs({ status, q: search, dateFrom, dateTo, perPage: 50 })}`,
      );
      setOrders(items);
      setTotal(pagination?.total ?? items.length);
      /* Dropped on every reload — a tick against an order the current filter no
         longer shows would export a row nobody can see. */
      setSelected(new Set());
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, [status, search, dateFrom, dateTo]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const allShownSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allShownSelected ? new Set() : new Set(orders.map((o) => o.id)));
  }

  /**
   * Exports what is ticked, or the whole filtered list when nothing is.
   *
   * Columns match the Google Sheets export deliberately, so a shop using both
   * is not reconciling two different shapes of the same order.
   */
  function exportCsv() {
    const rows = selected.size > 0 ? orders.filter((o) => selected.has(o.id)) : orders;
    if (rows.length === 0) return;

    downloadCsv(
      "gng-orders",
      toCsv(
        [
          "Order",
          "Placed at",
          "Customer",
          "Phone",
          "Area",
          "Zone",
          "Items",
          "Quantity",
          "Subtotal",
          "Delivery",
          "Total",
          "Status",
        ],
        rows.map((order) => [
          order.orderNumber,
          formatDateTime(order.createdAt),
          order.customerName,
          /* Leading apostrophe: Excel reads 01712345678 as a number and eats the
             leading zero, which turns every Bangladeshi mobile into a wrong one. */
          `'${order.phone}`,
          order.areaText,
          order.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka",
          order.itemCount,
          order.totalQuantity,
          order.subtotal,
          order.deliveryCharge,
          order.grandTotal,
          copy.orderStatus[order.status as ApiOrderStatus],
        ]),
      ),
    );
  }

  return (
    <AdminShell title="Orders">
      <OrderTabs active="orders" />

      <DateRangeFilter
        className="mb-3"
        preset={preset}
        custom={custom}
        onPreset={(value) => {
          setCustom(null);
          setPreset(value);
        }}
        onCustom={setCustom}
      />

      <div className="mb-4 flex flex-col gap-2">
        {/* Wraps rather than scrolls: a sideways strip put Cancelled off the
            edge of a phone with nothing to say it was there. */}
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={
                status === filter.value
                  ? "shrink-0 rounded-sm bg-ink px-3 py-2 text-caption font-medium text-white"
                  : "shrink-0 rounded-sm bg-white px-3 py-2 text-caption text-ink-soft ring-1 ring-line hover:bg-surface"
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Order number, name or phone"
            aria-label="Search orders"
            className="h-11 min-w-[180px] flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none placeholder:text-muted focus:border-ink"
          />

          <span className="tnum text-caption text-muted">{total} total</span>

          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={orders.length === 0}>
            <Icon name="package" size={15} />
            {selected.size > 0 ? `Export ${selected.size}` : "Export all"}
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm bg-surface px-3 py-2.5">
          <span className="text-caption font-medium text-ink">{selected.size} selected</span>

          {/* Order numbers rather than uuids: the endpoint takes either, and
              fifty of these fit in a query string where fifty uuids would be
              four times the length for a URL nobody can read. Sent in the
              order they appear on screen so the printed stack matches. */}
          <Button
            href={`/api/admin/admin/orders/invoices?ids=${encodeURIComponent(
              orders
                .filter((order) => selected.has(order.id))
                .map((order) => order.orderNumber)
                .join(","),
            )}&per=${perSheet}`}
            target="_blank"
            rel="noopener"
            variant="secondary"
            size="sm"
          >
            <Icon name="package" size={15} />
            Print {selected.size} invoice{selected.size === 1 ? "" : "s"}
          </Button>

          <label className="flex items-center gap-1.5 text-caption text-muted">
            per A4 sheet
            <select
              value={perSheet}
              onChange={(event) => setPerSheet(Number(event.target.value))}
              aria-label="Invoices per A4 sheet"
              className="h-9 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
            >
              {SHEET_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-caption text-muted underline hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}

      <AsyncState
        loading={loading}
        error={error}
        empty={orders.length === 0}
        /* A range is always applied now, so "No orders yet" would be wrong far
           more often than right — a quiet morning is not an empty shop. The
           message names the range so the fix is obvious. */
        emptyMessage={
          search || status
            ? "No orders match this filter."
            : preset === "all" && !custom
              ? "No orders yet."
              : "No orders in this period. Try a wider range above."
        }
        onRetry={() => void load()}
      >
        {/* Cards on a phone, table from md up.
            A five-column table across 375px scrolls sideways, and Total and
            Status — the two columns you scan for — are the ones off the right
            edge. Same data, stacked, plus the call button: this screen exists
            so somebody can ring the customer, and on a phone that should be a
            tap rather than a copied number. */}
        <ul className="flex flex-col gap-2 md:hidden">
          {orders.map((order) => (
            <li key={order.id} className="overflow-hidden rounded-md border border-line bg-white">
              <div className="flex items-start gap-3 p-3">
                <input
                  type="checkbox"
                  checked={selected.has(order.id)}
                  onChange={() => toggleOne(order.id)}
                  aria-label={`Select ${order.orderNumber}`}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-ink)]"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="text-caption font-semibold text-ink"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="tnum ml-auto shrink-0 text-caption font-semibold text-ink">
                      {formatTaka(order.grandTotal)}
                    </span>
                  </div>

                  <p className="mt-0.5 text-micro text-muted">
                    {formatDateTime(order.createdAt)}
                  </p>

                  <p className="mt-2 truncate text-caption text-ink">{order.customerName}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[order.status]}>
                      {copy.orderStatus[order.status]}
                    </Badge>
                    <span className="text-micro text-muted">
                      {order.totalQuantity} item{order.totalQuantity === 1 ? "" : "s"} ·{" "}
                      {order.deliveryZone === "inside_dhaka" ? "Dhaka" : "Outside"}
                    </span>
                  </div>
                </div>
              </div>

              <a
                href={`tel:${order.phone}`}
                className="flex min-h-12 items-center justify-center gap-2 border-t border-line text-caption font-medium text-ink active:bg-surface"
              >
                <Icon name="phone" size={16} />
                <span className="tnum">{order.phone}</span>
              </a>
            </li>
          ))}
        </ul>

        <TableWrap className="hidden md:block">
          <div className="overflow-hidden rounded-md border border-line bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface text-micro uppercase tracking-wide text-muted">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      onChange={toggleAll}
                      aria-label="Select all shown"
                      className="size-4 accent-[var(--color-ink)]"
                    />
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Order</th>
                  {/* Customer absorbs the slack — see the note in ProductList. */}
                  <th className="w-full px-3 py-2.5 font-medium">Customer</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Total</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        onChange={() => toggleOne(order.id)}
                        aria-label={`Select ${order.orderNumber}`}
                        className="size-4 accent-[var(--color-ink)]"
                      />
                    </td>
                    {/* Nowrap on the cell, not only the header: Customer takes
                        the slack, so anything without it collapses to its
                        narrowest wrap — "SB-" over "10167" over four lines of
                        date. */}
                    <td className="whitespace-nowrap px-3 py-2.5">
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

                    {/* See the note on the product cell in ProductList: a cell
                        sizes to its content unless something caps it, so a long
                        customer name would push Total and Status off-screen. */}
                    <td className="w-full max-w-0 px-3 py-2.5">
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

                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="tnum block text-caption font-medium text-ink">
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
