"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { downloadCsv, toCsv } from "@/lib/admin/csv";
import { useOpenCheckoutCount } from "@/lib/admin/use-open-checkouts";
import { useCachedFraud } from "@/lib/admin/use-cached-fraud";
import { FraudBadge } from "./FraudBadge";
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
import { toast } from "@/lib/stores/toast-store";
import { OrderQuickDrawer } from "./OrderQuickDrawer";
import { whatsappHref, whatsappNumber } from "@/lib/admin/whatsapp";

/** The presets a link may name. Anything else falls back to today. */
const PRESETS: DateRangePreset[] = ["today", "yesterday", "last7", "last30", "all"];

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
  /* Cancelled and returned together, because they are one thing to a shop:
     an order that earned nothing. Returned had no chip of its own before, so
     those orders were unreachable from this screen — and the dashboard tile
     that counts them both now lands here. `csvEnum` on the API takes the
     comma. */
  { value: "cancelled,returned", label: "Cancelled / back" },
];

/**
 * Order queue.
 *
 * Defaults to newest first with no status filter, so the first thing on screen
 * is whatever came in most recently — which on a COD store is the thing that
 * needs a confirmation call.
 */
export function OrderList() {
  /* Shown on the Incomplete tab, so the desk sees the waiting calls from here. */
  const openCheckouts = useOpenCheckoutCount();

  /**
   * Where the dashboard's pipeline tiles land.
   *
   * Read once, as the initial state rather than as a controlled value: this
   * screen is worked in for minutes at a time and its own chips must keep
   * working afterwards. A URL that kept overriding them would make the filter
   * bar look broken.
   *
   * The range comes across too. A tile counting orders placed in the last
   * thirty days that opened a queue showing only today would show a different
   * number from the one that was clicked, which reads as a bug in both screens.
   */
  const params = useSearchParams();

  const [orders, setOrders] = useState<ApiOrderListItem[]>([]);
  /* Delivery rates for the rows on screen. Cache only — never a live sign-in;
     see the hook. */
  const fraud = useCachedFraud(orders.map((order) => order.phone));
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(() => params.get("status") ?? "");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Ids, not indexes: the list reloads under the selection whenever the range,
     status or search changes, and an index would then point at a different
     order with nothing looking wrong. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);
  /* Four to a page is the useful default: a 2×2 cell is large enough to read
     an address off at arm's length, and it quarters the paper. */
  const [perSheet, setPerSheet] = useState<number>(4);

  /* Today by default: this screen is worked through day by day, and a queue
     that opens on every order ever placed buries the ones that arrived this
     morning. The other presets are one tap away when something older is
     being chased. */
  const [preset, setPreset] = useState<DateRangePreset>(() => {
    const asked = params.get("range");
    return PRESETS.includes(asked as DateRangePreset) ? (asked as DateRangePreset) : "today";
  });
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(() => {
    const from = params.get("from");
    const to = params.get("to");
    /* Both halves or neither: half a custom range would silently become a
       different window from the one that was clicked. */
    return from && to ? { from, to } : null;
  });

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

  async function handleBulkStatus(newStatus: ApiOrderStatus) {
    if (selected.size === 0) return;
    setBulkUpdating(true);
    try {
      const res = await adminApi.post<{
        succeeded: string[];
        failed: { id: string; error: string }[];
      }>("admin/orders/bulk-status", {
        orderIds: Array.from(selected),
        status: newStatus,
      });

      if (res.succeeded.length > 0) {
        toast(`Updated ${res.succeeded.length} order(s) to ${copy.orderStatus[newStatus] || newStatus}!`, {
          tone: "positive",
        });
      }
      if (res.failed.length > 0) {
        toast(`${res.failed.length} order(s) could not be transitioned.`, { tone: "warn" });
      }

      await load();
      setSelected(new Set());
    } catch (caught) {
      toast(caught instanceof AdminApiError ? caught.message : "Bulk status update failed", {
        tone: "error",
      });
    } finally {
      setBulkUpdating(false);
    }
  }

  function copyOrderInfo(order: ApiOrderListItem) {
    const text = [
      `Order: #${order.orderNumber}`,
      `Customer: ${order.customerName}`,
      `Phone: ${order.phone}`,
      `Area: ${order.areaText}`,
      `Total: Tk ${order.grandTotal} (COD)`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast(`Copied details for #${order.orderNumber}!`, { tone: "positive" });
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
      <OrderTabs active="orders" incompleteCount={openCheckouts} />

      {/* Most of this shop's sales are agreed in a message rather than through
          the checkout, so taking one down by hand is a first-class action here
          and not something buried in a menu. */}
      <div className="mb-3 flex justify-end">
        <Button href="/admin/orders/new" variant="primary" size="md">
          <Icon name="plus" size={16} />
          New order
        </Button>
      </div>

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
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface border border-line p-3 shadow-xs">
          <span className="text-caption font-semibold text-ink">{selected.size} selected</span>

          {/* Bulk Status Changer */}
          <div className="flex items-center gap-1.5">
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  handleBulkStatus(e.target.value as ApiOrderStatus);
                  e.target.value = "";
                }
              }}
              disabled={bulkUpdating}
              className="h-9 rounded-sm border border-ink bg-ink text-white px-2.5 text-caption font-medium outline-none cursor-pointer hover:bg-ink-soft transition-colors"
            >
              <option value="" disabled>
                {bulkUpdating ? "Updating..." : "Change Status..."}
              </option>
              <option value="confirmed">✓ Mark Confirmed</option>
              <option value="processing">⚙ Mark Processing</option>
              <option value="packed">📦 Mark Packed</option>
              <option value="shipped">🚚 Mark Shipped</option>
              <option value="delivered">★ Mark Delivered</option>
              <option value="cancelled">✕ Mark Cancelled</option>
            </select>
          </div>

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
            className="text-caption text-muted underline hover:text-ink ml-auto"
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

                  <div className="mt-2 flex items-center gap-1.5">
                    <p className="truncate text-caption text-ink">{order.customerName}</p>
                    <FraudBadge report={fraud[order.phone]} />
                  </div>

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

              <div className="grid grid-cols-4 border-t border-line divide-x divide-line text-caption">
                <a
                  href={`tel:${order.phone}`}
                  className="flex min-h-10 items-center justify-center gap-1 font-medium text-ink hover:bg-surface active:bg-line transition-colors"
                >
                  <Icon name="phone" size={14} />
                  Call
                </a>
                <button
                  type="button"
                  onClick={() => copyOrderInfo(order)}
                  className="flex min-h-10 items-center justify-center gap-1 font-medium text-ink hover:bg-surface active:bg-line transition-colors"
                >
                  <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                  </svg>
                  Copy
                </button>
                {whatsappNumber(order.phone) ? (
                  <a
                    href={whatsappHref(
                      order.phone,
                      `আসসালামু আলাইকুম ${order.customerName},\nআপনার অর্ডার #${order.orderNumber} এর বিষয়ে যোগাযোগ করা হচ্ছে। মোট: ৳${order.grandTotal} (ক্যাশ অন ডেলিভারি)।`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-10 items-center justify-center gap-1 font-medium text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 transition-colors"
                  >
                    <svg className="size-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z" />
                    </svg>
                    WA
                  </a>
                ) : (
                  <span className="flex min-h-10 items-center justify-center text-muted">—</span>
                )}
                <button
                  type="button"
                  onClick={() => setDrawerOrderId(order.id)}
                  className="flex min-h-10 items-center justify-center gap-1 font-medium text-ink hover:bg-surface active:bg-line transition-colors"
                >
                  <svg className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View
                </button>
              </div>
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
                  <th className="whitespace-nowrap px-3 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-line last:border-0 hover:bg-surface/30 transition-colors">
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
                      <button
                        type="button"
                        onClick={() => setDrawerOrderId(order.id)}
                        className="block text-left text-caption font-semibold text-ink hover:underline cursor-pointer"
                      >
                        {order.orderNumber}
                      </button>
                      <span className="block text-micro text-muted">
                        {formatDateTime(order.createdAt)}
                      </span>
                    </td>

                    {/* See the note on the product cell in ProductList: a cell
                        sizes to its content unless something caps it, so a long
                        customer name would push Total and Status off-screen. */}
                    <td className="w-full max-w-0 px-3 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDrawerOrderId(order.id)}
                          className="truncate text-caption text-ink font-medium text-left hover:underline cursor-pointer"
                        >
                          {order.customerName}
                        </button>
                        {/* The delivery rate, read only from what is already
                            stored — see useCachedFraud. */}
                        <FraudBadge report={fraud[order.phone]} />
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

                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => copyOrderInfo(order)}
                          title="Copy details"
                          className="p-1.5 rounded-sm text-muted hover:bg-surface hover:text-ink transition-colors"
                        >
                          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                          </svg>
                        </button>

                        {whatsappNumber(order.phone) && (
                          <a
                            href={whatsappHref(
                              order.phone,
                              `আসসালামু আলাইকুম ${order.customerName},\nআপনার অর্ডার #${order.orderNumber} এর বিষয়ে যোগাযোগ করা হচ্ছে। মোট: ৳${order.grandTotal} (ক্যাশ অন ডেলিভারি)।`,
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open WhatsApp chat"
                            className="p-1.5 rounded-sm text-emerald-600 hover:bg-emerald-50 transition-colors"
                          >
                            <svg className="size-4 fill-current" viewBox="0 0 24 24">
                              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z" />
                            </svg>
                          </a>
                        )}

                        <button
                          type="button"
                          onClick={() => setDrawerOrderId(order.id)}
                          title="Quick preview drawer"
                          className="p-1.5 rounded-sm text-ink-soft hover:bg-surface hover:text-ink transition-colors"
                        >
                          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableWrap>
      </AsyncState>

      <OrderQuickDrawer
        orderId={drawerOrderId}
        onClose={() => setDrawerOrderId(null)}
        onStatusUpdated={load}
      />
    </AdminShell>
  );
}
