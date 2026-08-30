"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError, qs, type Pagination } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatTaka } from "@/lib/utils";
import type { ApiCustomer } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input, Select } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";

/**
 * Customers.
 *
 * Not a table in the database — the phone number is the identity on a shop
 * nobody registers for, so each row here is that phone's orders folded together.
 * See `backend/src/modules/customers`.
 *
 * THE COLUMN THAT MATTERS MOST IS "RETURNED"
 * ------------------------------------------
 * On cash on delivery a placed order is an intention, not money. A customer who
 * orders four times and sends three back has cost the shop three round trips of
 * courier fees, and that is invisible on the orders screen where each order is
 * one row among hundreds. Here it is one number beside their name, which is why
 * `spent` counts DELIVERED orders only — the same line the profit report draws.
 */

const SORTS: { value: string; label: string }[] = [
  { value: "recent", label: "Newest order first" },
  { value: "oldest", label: "Oldest order first" },
  { value: "spent", label: "Highest spend" },
  { value: "orders", label: "Most orders" },
  { value: "returns", label: "Most returns" },
  { value: "name", label: "Name (A–Z)" },
];

export function CustomerList() {
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [withReturnsOnly, setWithReturnsOnly] = useState(false);
  const [page, setPage] = useState(1);

  /* Every filter is in the query string, so a reload or a shared link lands on
     the same view — and the export below can be handed the identical filter. */
  const query = qs({ search, sort, repeatOnly, withReturnsOnly, page, perPage: 20 });

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await adminApi.list<ApiCustomer>(`admin/customers${query}`);
      setCustomers(result.items);
      setPagination(result.pagination ?? null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useLoad(load);

  /**
   * The export is a plain link, not a fetch.
   *
   * The API answers with `content-disposition: attachment`, so the browser saves
   * the file itself — no blob, no object URL, and nothing held in memory. It also
   * means the export runs the SAME filter the table is showing, server-side,
   * across every match rather than the twenty rows on screen.
   */
  function exportHref(format: "csv" | "json"): string {
    return `/api/admin/admin/customers/export${qs({
      search,
      sort,
      repeatOnly,
      withReturnsOnly,
      format,
    })}`;
  }

  return (
    <AdminShell title="Customers">
      {/* One wide table with eight columns, not two stacked cards. The default
          grid halves the width at 2xl, which pushed SUCCESS and SPEND off the
          edge while the right half of the screen sat empty. */}
      <PageBody columns={false}>
        <Card>
          <CardHeader
            title={pagination ? `${pagination.total} customers` : "Customers"}
            hint="Grouped by phone number. Spend counts delivered orders only."
          />

          <div className="flex flex-col gap-4 p-4">
            <ErrorBanner message={error} />

            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Search"
                placeholder="Phone or name"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="min-w-[200px] flex-1"
              />

              <Select
                label="Sort"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(1);
                }}
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-caption text-ink">
                <input
                  type="checkbox"
                  checked={repeatOnly}
                  onChange={(event) => {
                    setRepeatOnly(event.target.checked);
                    setPage(1);
                  }}
                  className="size-4 accent-[var(--color-ink)]"
                />
                Repeat customers only
              </label>

              <label className="flex items-center gap-2 text-caption text-ink">
                <input
                  type="checkbox"
                  checked={withReturnsOnly}
                  onChange={(event) => {
                    setWithReturnsOnly(event.target.checked);
                    setPage(1);
                  }}
                  className="size-4 accent-[var(--color-ink)]"
                />
                Has returned an order
              </label>

              <div className="ml-auto flex gap-2">
                <Button href={exportHref("csv")} variant="secondary" size="md">
                  <Icon name="package" size={16} />
                  Export CSV
                </Button>
                <Button href={exportHref("json")} variant="ghost" size="md">
                  JSON
                </Button>
              </div>
            </div>

            {loading ? (
              <p className="rounded-sm bg-surface px-3 py-6 text-center text-caption text-muted">
                Loading…
              </p>
            ) : customers.length === 0 ? (
              <p className="rounded-sm bg-surface px-3 py-6 text-center text-caption text-muted">
                No customers match that.
              </p>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[820px] text-caption">
                  <thead>
                    <tr className="border-b border-line text-left text-micro uppercase text-muted">
                      <th className="py-2 pr-3 font-semibold">Customer</th>
                      <th className="py-2 pr-3 font-semibold">Area</th>
                      <th className="py-2 pr-3 text-right font-semibold">Orders</th>
                      <th className="py-2 pr-3 text-right font-semibold">Returned</th>
                      <th className="py-2 pr-3 text-right font-semibold">Success</th>
                      <th className="py-2 pr-3 text-right font-semibold">Spent</th>
                      <th className="py-2 text-right font-semibold">Last order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => (
                      <CustomerRow key={customer.phone} customer={customer} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="secondary"
                  size="md"
                  disabled={!pagination.hasPrev}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <span className="text-caption text-muted">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={!pagination.hasNext}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </Card>
      </PageBody>
    </AdminShell>
  );
}

function CustomerRow({ customer }: { customer: ApiCustomer }) {
  /* Returns are the thing to notice, so they are the only cell that changes
     colour. Everything else staying plain is what makes that work. */
  const returnTone = customer.returnedCount === 0 ? "text-muted" : "text-sale";

  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2.5 pr-3">
        <p className="font-medium text-ink">{customer.name || "—"}</p>
        {/* A tappable number: on a phone this screen IS the call list. */}
        <a href={`tel:${customer.phone}`} className="text-micro text-muted underline">
          {customer.phone}
        </a>
      </td>
      <td className="py-2.5 pr-3 text-ink-soft">
        <p className="max-w-[220px] truncate">{customer.areaText || "—"}</p>
        <p className="text-micro text-muted">
          {customer.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka"}
        </p>
      </td>
      <td className="py-2.5 pr-3 text-right tnum text-ink">
        {customer.orderCount}
        {customer.orderCount > 1 && (
          <Badge tone="positive" size="sm" className="ml-1.5">
            repeat
          </Badge>
        )}
      </td>
      <td className={`py-2.5 pr-3 text-right tnum ${returnTone}`}>{customer.returnedCount}</td>
      <td className="py-2.5 pr-3 text-right tnum text-ink-soft">
        {customer.successRate === null ? "—" : `${customer.successRate}%`}
      </td>
      <td className="py-2.5 pr-3 text-right tnum font-medium text-ink">
        {formatTaka(customer.spent)}
      </td>
      <td className="py-2.5 text-right tnum text-muted">
        {customer.lastOrderAt.slice(0, 10)}
      </td>
    </tr>
  );
}
