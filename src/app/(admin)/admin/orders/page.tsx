import Link from "next/link";
import { listOrders } from "@/lib/data/orders";
import { formatDateTime, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type { OrderStatus } from "@/types";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "@/components/shop/OrderStatus";
import { AdminHeader, TableWrap, Td, Th } from "@/components/admin/AdminUI";
import { Icon } from "@/components/ui/Icon";

const FILTERS: { value: OrderStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: copy.orderStatus.pending },
  { value: "confirmed", label: copy.orderStatus.confirmed },
  { value: "packed", label: copy.orderStatus.packed },
  { value: "shipped", label: copy.orderStatus.shipped },
  { value: "delivered", label: copy.orderStatus.delivered },
  { value: "returned", label: copy.orderStatus.returned },
  { value: "cancelled", label: copy.orderStatus.cancelled },
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status = "all", q = "" } = await searchParams;
  const orders = await listOrders({
    status: status as OrderStatus | "all",
    query: q,
  });

  return (
    <>
      <AdminHeader
        title="Orders"
        subtitle={`${orders.length} ${orders.length === 1 ? "order" : "orders"}`}
      />

      {/* Plain links and a GET form — the orders list stays fully functional
          with JavaScript disabled or still loading, which matters when someone
          is working through the confirmation queue on a slow phone. */}
      <div className="snap-rail -mx-4 mb-3 gap-2 px-4">
        {FILTERS.map((filter) => {
          const active = status === filter.value;
          const params = new URLSearchParams();
          if (filter.value !== "all") params.set("status", filter.value);
          if (q) params.set("q", q);
          const href = `/admin/orders${params.size ? `?${params}` : ""}`;

          return (
            <Link
              key={filter.value}
              href={href}
              className={cn(
                "snap-item whitespace-nowrap rounded-full px-3.5 py-2 text-caption font-medium transition-colors",
                active
                  ? "bg-ink text-white"
                  : "bg-white text-ink-soft hover:bg-line",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex gap-2">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <div className="flex flex-1 items-center gap-2 rounded-sm border border-line bg-white px-3 sm:max-w-sm">
          <Icon name="search" size={17} className="text-muted" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Order ID, phone or name"
            aria-label="Search orders"
            className="h-10 min-w-0 flex-1 bg-transparent text-caption outline-none"
          />
        </div>
        <button
          type="submit"
          className="h-10 rounded-sm bg-ink px-4 text-caption font-medium text-white"
        >
          Search
        </button>
      </form>

      <TableWrap>
        <thead>
          <tr>
            <Th>Order</Th>
            <Th>Customer</Th>
            <Th>Area</Th>
            <Th>Items</Th>
            <Th>Total</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {orders.slice(0, 60).map((order) => (
            <tr key={order.id} className="hover:bg-surface/60">
              <Td>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="tnum font-medium text-ink hover:underline"
                >
                  {order.orderNumber}
                </Link>
                <span className="block text-micro text-muted">
                  {formatDateTime(order.createdAt)}
                </span>
              </Td>
              <Td>
                {order.customerName}
                <a
                  href={`tel:${order.phone}`}
                  className="tnum block text-micro text-muted hover:text-ink"
                >
                  {order.phone}
                </a>
              </Td>
              <Td>
                <span className="clamp-2">{order.areaText}</span>
                <span className="block text-micro text-muted">
                  {order.zone === "inside_dhaka"
                    ? copy.checkout.zoneInside
                    : copy.checkout.zoneOutside}
                </span>
              </Td>
              <Td className="tnum">
                {order.items.reduce((sum, i) => sum + i.qty, 0)}
              </Td>
              <Td className="tnum font-medium text-ink">{formatTaka(order.total)}</Td>
              <Td>
                <OrderStatusBadge status={order.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {orders.length === 0 && (
        <p className="py-10 text-center text-caption text-muted">
          No orders match this filter.
        </p>
      )}
    </>
  );
}
