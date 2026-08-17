import {
  countCustomers,
  EXPORT_MAX,
  listCustomers,
  listCustomersForExport,
  type CustomerRow,
  type ListCustomersOptions,
} from "./customer.repository.js";
import type { ExportCustomersQuery, ListCustomersQuery } from "./customer.validation.js";

/**
 * Customer use cases.
 *
 * Read-only by design. Every field shown here was typed into a checkout and
 * belongs to an order; editing it from a customer screen would put the record
 * out of step with the order it was taken from, and the order is the document
 * that a courier and a refund argue over. Corrections happen on the order.
 */

export interface CustomerDto {
  phone: string;
  name: string;
  address: string;
  areaText: string;
  deliveryZone: string;
  orderCount: number;
  deliveredCount: number;
  returnedCount: number;
  cancelledCount: number;
  /** Delivered orders only. What the shop actually took. */
  spent: number;
  /** Every order placed, delivered or not. */
  placedValue: number;
  /**
   * Delivered ÷ (delivered + returned), as a percentage, or null when they have
   * no settled orders yet.
   *
   * Computed here rather than in SQL so "no settled orders" stays distinct from
   * "0% success" — a new customer with one pending order is not a bad one, and a
   * zero in that column would read as exactly that.
   */
  successRate: number | null;
  firstOrderAt: string;
  lastOrderAt: string;
}

function toDto(row: CustomerRow): CustomerDto {
  const settled = row.deliveredCount + row.returnedCount;

  return {
    phone: row.phone,
    name: row.name,
    address: row.address,
    areaText: row.areaText,
    deliveryZone: row.deliveryZone,
    orderCount: row.orderCount,
    deliveredCount: row.deliveredCount,
    returnedCount: row.returnedCount,
    cancelledCount: row.cancelledCount,
    spent: row.spent,
    placedValue: row.placedValue,
    successRate: settled === 0 ? null : Math.round((row.deliveredCount / settled) * 100),
    firstOrderAt: row.firstOrderAt.toISOString(),
    lastOrderAt: row.lastOrderAt.toISOString(),
  };
}

function toOptions(query: ListCustomersQuery | ExportCustomersQuery): Omit<
  ListCustomersOptions,
  "page" | "perPage"
> {
  return {
    ...(query.search ? { search: query.search } : {}),
    repeatOnly: query.repeatOnly,
    withReturnsOnly: query.withReturnsOnly,
    sort: query.sort,
  };
}

export async function list(query: ListCustomersQuery): Promise<{
  customers: CustomerDto[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}> {
  const rows = await listCustomers({
    ...toOptions(query),
    page: query.page,
    perPage: query.perPage,
  });

  /**
   * The window count rides on every returned row — and there are no rows on a
   * page past the end, so it has nowhere to live.
   *
   * That case has to be told apart from "nothing matches": one is an empty
   * state, the other is a page number that overshot, and reporting a total of 0
   * for the second hides the pager and leaves the screen with no way back. So
   * when the page is empty AND it is not the first page, the count is asked for
   * directly. On the ordinary path that query never runs.
   */
  const total =
    rows[0]?.totalCount ??
    (query.page > 1 ? await countCustomers(toOptions(query)) : 0);
  const totalPages = Math.max(1, Math.ceil(total / query.perPage));

  return {
    customers: rows.map(toDto),
    pagination: {
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrev: query.page > 1,
    },
  };
}

export interface CustomerExport {
  customers: CustomerDto[];
  /** True when EXPORT_MAX was reached, so the caller can say so out loud. */
  truncated: boolean;
}

export async function forExport(query: ExportCustomersQuery): Promise<CustomerExport> {
  const rows = await listCustomersForExport(toOptions(query));

  return {
    customers: rows.map(toDto),
    truncated: rows.length >= EXPORT_MAX,
  };
}

/** Column order for the CSV. Kept beside the data so the two cannot drift. */
export const EXPORT_COLUMNS: { header: string; value: (c: CustomerDto) => string | number }[] = [
  { header: "Phone", value: (c) => c.phone },
  { header: "Name", value: (c) => c.name },
  { header: "Address", value: (c) => c.address },
  { header: "Area", value: (c) => c.areaText },
  { header: "Zone", value: (c) => c.deliveryZone },
  { header: "Orders", value: (c) => c.orderCount },
  { header: "Delivered", value: (c) => c.deliveredCount },
  { header: "Returned", value: (c) => c.returnedCount },
  { header: "Cancelled", value: (c) => c.cancelledCount },
  { header: "Success %", value: (c) => (c.successRate === null ? "" : c.successRate) },
  { header: "Spent (delivered)", value: (c) => c.spent },
  { header: "Placed value", value: (c) => c.placedValue },
  { header: "First order", value: (c) => c.firstOrderAt.slice(0, 10) },
  { header: "Last order", value: (c) => c.lastOrderAt.slice(0, 10) },
];
