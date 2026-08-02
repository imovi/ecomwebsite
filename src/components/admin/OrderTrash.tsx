"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatTaka, formatDateTime } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { toast } from "@/lib/stores/toast-store";
import type { ApiOrderListItem, ApiOrderStatus } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, ErrorBanner, OrderTabs, TableWrap } from "./ui";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

/**
 * Deleted orders, waiting to be purged.
 *
 * A deleted order is hidden everywhere else — lists, counts, the profit report —
 * but it is still here for thirty days. That window exists because an order is
 * the record of money owed or collected: deleting the wrong one silently
 * restates every figure it appeared in, and the mistake is usually noticed days
 * later when a total looks wrong rather than at the moment of the click.
 */

/** Kept in step with `TRASH_RETENTION_DAYS` in the order service. */
const RETENTION_DAYS = 30;

function daysLeft(deletedAt: string | null | undefined): number | null {
  if (!deletedAt) return null;
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, RETENTION_DAYS - Math.floor(elapsed / 86_400_000));
}

export function OrderTrash() {
  const [orders, setOrders] = useState<ApiOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, pagination } = await adminApi.list<ApiOrderListItem>(
        `admin/orders/trash${qs({ perPage: 50 })}`,
      );
      setOrders(items);
      setTotal(pagination?.total ?? items.length);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the trash.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      toast(message);
      await load();
    } catch (caught) {
      setActionError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner account can delete an order for good."
            : caught.message
          : "Could not do that.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Orders">
      <OrderTabs active="trash" />

      <ErrorBanner message={actionError} className="mb-3" />

      <p className="mb-3 text-caption text-muted">
        Deleted orders stay here for {RETENTION_DAYS} days, then go for good. While an order is
        here it is left out of every list, count and profit figure.
      </p>

      <AsyncState
        loading={loading}
        error={error}
        empty={orders.length === 0}
        emptyMessage="Nothing in the trash."
        onRetry={() => void load()}
      >
        <>
          <p className="mb-2 text-caption text-muted">{total} in the trash</p>

          <TableWrap>
            <table className="w-full border-collapse text-caption">
              <thead>
                <tr className="border-b border-line text-left text-micro uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-medium">Order</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Goes for good</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const left = daysLeft(order.deletedAt);

                  return (
                    <tr key={order.id} className="border-b border-line last:border-0">
                      <td className="py-3 pr-3">
                        <span className="font-semibold text-ink">{order.orderNumber}</span>
                        <span className="mt-0.5 block text-micro text-muted">
                          {formatDateTime(order.createdAt)}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="text-ink">{order.customerName}</span>
                        <span className="tnum mt-0.5 block text-micro text-muted">
                          {order.phone}
                        </span>
                      </td>
                      <td className="tnum py-3 pr-3 text-ink">{formatTaka(order.grandTotal)}</td>
                      <td className="py-3 pr-3">
                        <Badge tone="saleSoft">
                          {copy.orderStatus[order.status as ApiOrderStatus]}
                        </Badge>
                      </td>
                      <td className="py-3 pr-3 text-muted">
                        {left === null
                          ? "—"
                          : left === 0
                            ? "Today"
                            : `in ${left} day${left === 1 ? "" : "s"}`}
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => adminApi.post(`admin/orders/${order.id}/restore`, {}),
                                `${order.orderNumber} restored`,
                              )
                            }
                          >
                            Restore
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              /* The only irreversible action in the panel, so it
                                 asks with the order number in the sentence — a
                                 generic "are you sure" is read past. */
                              if (
                                !window.confirm(
                                  `Delete ${order.orderNumber} for good? This cannot be undone.`,
                                )
                              ) {
                                return;
                              }
                              void run(
                                () => adminApi.delete(`admin/orders/${order.id}/purge`),
                                `${order.orderNumber} deleted for good`,
                              );
                            }}
                          >
                            Delete for good
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </>
      </AsyncState>
    </AdminShell>
  );
}
