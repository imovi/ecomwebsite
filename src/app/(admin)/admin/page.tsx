import Link from "next/link";
import { getDashboardStats, listOrders } from "@/lib/data/orders";
import { formatDate, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { OrderStatusBadge } from "@/components/shop/OrderStatus";
import {
  AdminHeader,
  Card,
  Sparkline,
  StatCard,
  TableWrap,
  Td,
  Th,
} from "@/components/admin/AdminUI";

export default async function AdminDashboard() {
  const [stats, recent] = await Promise.all([getDashboardStats(), listOrders()]);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <>
      <AdminHeader title="Dashboard" subtitle="Last 30 days" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Revenue counts DELIVERED orders only. On a COD store a placed order
            is a promise, not money — treating it as revenue overstates the
            business by roughly the return rate. */}
        <StatCard
          label="Revenue (delivered)"
          value={formatTaka(stats.revenue30d)}
          hint={`Avg order ${formatTaka(stats.averageOrderValue)}`}
        />
        <StatCard label="Orders" value={String(stats.orders30d)} hint="Placed" />
        <StatCard
          label="Awaiting call"
          value={String(stats.pendingCount)}
          tone={stats.pendingCount > 0 ? "warn" : undefined}
          hint="Pending confirmation"
        />
        <StatCard
          label="Return rate"
          value={pct(stats.returnRate)}
          tone={stats.returnRate > 0.12 ? "sale" : "positive"}
          hint={`${pct(stats.deliveredRate)} delivered`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-caption font-medium text-muted">
              Delivered revenue, last 14 days
            </h2>
            <span className="tnum text-caption font-semibold text-ink">
              {formatTaka(stats.revenueSeries.reduce((s, d) => s + d.value, 0))}
            </span>
          </div>
          <Sparkline data={stats.revenueSeries} className="mt-3 text-ink" />
        </Card>

        <Card>
          <h2 className="text-caption font-medium text-muted">Low stock</h2>
          {stats.lowStock.length === 0 ? (
            <p className="mt-2 text-caption text-muted">Nothing running low.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {stats.lowStock.slice(0, 5).map((item) => (
                <li key={`${item.slug}-${item.variant}`} className="flex gap-2 text-caption">
                  <Link
                    href={`/product/${item.slug}`}
                    className="clamp-2 min-w-0 flex-1 text-ink-soft hover:text-ink"
                  >
                    {item.title}
                    <span className="text-muted"> · {item.variant}</span>
                  </Link>
                  <span
                    className={`tnum shrink-0 font-semibold ${
                      item.stock === 0 ? "text-sale" : "text-warn"
                    }`}
                  >
                    {item.stock}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/admin/stock"
            className="mt-3 inline-block text-caption font-medium text-ink underline underline-offset-2"
          >
            Manage stock
          </Link>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-title text-ink">Recent orders</h2>
            <Link
              href="/admin/orders"
              className="text-caption font-medium text-muted hover:text-ink"
            >
              {copy.home.viewAll}
            </Link>
          </div>

          <TableWrap>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recent.slice(0, 8).map((order) => (
                <tr key={order.id}>
                  <Td>
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="tnum font-medium text-ink hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="block text-micro text-muted">
                      {formatDate(order.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    {order.customerName}
                    <span className="tnum block text-micro text-muted">
                      {order.phone}
                    </span>
                  </Td>
                  <Td className="tnum font-medium text-ink">
                    {formatTaka(order.total)}
                  </Td>
                  <Td>
                    <OrderStatusBadge status={order.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>

        <Card>
          <h2 className="text-caption font-medium text-muted">
            Top products by revenue
          </h2>
          <ul className="mt-2 flex flex-col gap-2.5">
            {stats.topProducts.map((product) => (
              <li key={product.title} className="flex items-baseline gap-2">
                <span className="clamp-2 min-w-0 flex-1 text-caption text-ink-soft">
                  {product.title}
                </span>
                <span className="tnum shrink-0 text-caption font-semibold text-ink">
                  {formatTaka(product.revenue)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
