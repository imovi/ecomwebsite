import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  allowedTransitions,
  getCustomers,
  getOrderById,
} from "@/lib/data/orders";
import { formatDateTime, formatTaka, normalizePhone } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { AdminHeader, Card } from "@/components/admin/AdminUI";
import { OrderActions } from "@/components/admin/OrderActions";
import { OrderStatusBadge } from "@/components/shop/OrderStatus";
import { Icon } from "@/components/ui/Icon";

export default async function AdminOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderById(id);
  if (!order) notFound();

  const customers = await getCustomers();
  const customer = customers.find(
    (c) => c.phone === normalizePhone(order.phone),
  );

  return (
    <>
      <Link
        href="/admin/orders"
        className="mb-3 inline-flex items-center gap-1 text-caption text-muted hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} />
        Orders
      </Link>

      <AdminHeader
        title={order.orderNumber}
        subtitle={formatDateTime(order.createdAt)}
        action={<OrderStatusBadge status={order.status} size="md" />}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-caption font-medium text-muted">Items</h2>
            <ul className="flex flex-col gap-3">
              {order.items.map((item) => (
                <li
                  key={`${item.productId}-${item.variantId ?? ""}`}
                  className="flex items-center gap-3"
                >
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xs bg-surface">
                    <Image
                      src={item.imageSnapshot}
                      alt=""
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/product/${item.slug}`}
                      className="clamp-2 text-caption text-ink hover:underline"
                    >
                      {item.titleSnapshot}
                    </Link>
                    {item.variantLabel && (
                      <p className="text-micro text-muted">{item.variantLabel}</p>
                    )}
                  </div>
                  <p className="tnum shrink-0 text-caption text-muted">
                    {item.qty} × {formatTaka(item.priceSnapshot)}
                  </p>
                  <p className="tnum w-20 shrink-0 text-right text-caption font-semibold text-ink">
                    {formatTaka(item.priceSnapshot * item.qty)}
                  </p>
                </li>
              ))}
            </ul>

            <dl className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 text-caption">
              <div className="flex justify-between">
                <dt className="text-muted">{copy.checkout.productSubtotal}</dt>
                <dd className="tnum">{formatTaka(order.subtotal)}</dd>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">
                    {copy.checkout.discount}
                    {order.couponCode && ` (${order.couponCode})`}
                  </dt>
                  <dd className="tnum text-positive">
                    − {formatTaka(order.discount)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted">
                  {copy.checkout.deliveryCharge} ·{" "}
                  {order.zone === "inside_dhaka"
                    ? copy.checkout.zoneInside
                    : copy.checkout.zoneOutside}
                </dt>
                <dd className="tnum">
                  {order.deliveryCharge === 0
                    ? copy.checkout.freeDelivery
                    : formatTaka(order.deliveryCharge)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2">
                <dt className="font-semibold text-ink">{copy.checkout.total}</dt>
                <dd className="tnum font-semibold text-ink">
                  {formatTaka(order.total)}
                </dd>
              </div>
              <p className="mt-1 text-micro text-muted">
                Cash on delivery — collect {formatTaka(order.total)}.
              </p>
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-caption font-medium text-muted">
              Update status
            </h2>
            <OrderActions
              orderId={order.id}
              status={order.status}
              allowed={allowedTransitions(order.status)}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-2 text-caption font-medium text-muted">Deliver to</h2>
            <p className="text-body font-medium text-ink">{order.customerName}</p>
            <a
              href={`tel:${order.phone}`}
              className="tnum mt-1 inline-flex items-center gap-1.5 text-caption font-medium text-ink hover:underline"
            >
              <Icon name="phone" size={14} />
              {order.phone}
            </a>
            <p className="mt-2 text-caption text-ink-soft">{order.address}</p>
            <p className="text-caption text-ink-soft">{order.areaText}</p>
          </Card>

          {customer && (
            <Card>
              <h2 className="mb-2 text-caption font-medium text-muted">
                Customer history
              </h2>
              <dl className="flex flex-col gap-1 text-caption">
                <Stat label="Orders" value={String(customer.ordersCount)} />
                <Stat label="Delivered" value={String(customer.deliveredCount)} />
                <Stat
                  label="Returned"
                  value={String(customer.returnedCount)}
                  danger={customer.returnedCount > 0}
                />
                <Stat label="Spent" value={formatTaka(customer.totalSpent)} />
              </dl>

              {/* The single most useful signal before dispatching another COD
                  parcel: has this number refused a delivery before? */}
              {customer.returnedCount > 0 && (
                <p className="mt-2 flex items-start gap-1.5 rounded-sm bg-sale-soft px-2.5 py-2 text-micro text-sale">
                  <Icon name="alert" size={14} className="mt-px shrink-0" />
                  This number has refused {customer.returnedCount}{" "}
                  {customer.returnedCount === 1 ? "delivery" : "deliveries"}.
                  Confirm carefully before dispatch.
                </p>
              )}
            </Card>
          )}

          <Card>
            <h2 className="mb-2 text-caption font-medium text-muted">Notes</h2>
            {order.notes.length === 0 ? (
              <p className="text-caption text-muted">No notes yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {order.notes.map((note, i) => (
                  <li
                    key={i}
                    className="rounded-sm bg-surface px-2.5 py-2 text-caption text-ink-soft"
                  >
                    {note}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tnum font-medium ${danger ? "text-sale" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}
