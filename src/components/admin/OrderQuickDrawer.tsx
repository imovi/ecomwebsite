"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka, formatDateTime } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type { ApiOrderDetail, ApiOrderStatus } from "@/lib/api/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { orderMessage, whatsappHref, whatsappNumber } from "@/lib/admin/whatsapp";

interface OrderQuickDrawerProps {
  orderId: string | null;
  onClose: () => void;
  onStatusUpdated?: () => void;
}

const STATUS_OPTIONS: { value: ApiOrderStatus; label: string }[] = [
  { value: "pending", label: "New (Pending)" },
  { value: "confirmed", label: "Confirmed" },
  { value: "processing", label: "Processing" },
  { value: "packed", label: "Packed" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export function OrderQuickDrawer({
  orderId,
  onClose,
  onStatusUpdated,
}: OrderQuickDrawerProps) {
  const [order, setOrder] = useState<ApiOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      return;
    }

    let active = true;
    setLoading(true);

    adminApi
      .get<{ order: ApiOrderDetail }>(`admin/orders/${orderId}`)
      .then((data) => {
        if (active) setOrder(data.order);
      })
      .catch((err) => {
        toast(err instanceof AdminApiError ? err.message : "Failed to load order", {
          tone: "error",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orderId]);

  // Handle escape key
  useEffect(() => {
    if (!orderId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [orderId, onClose]);

  if (!orderId) return null;

  async function handleStatusChange(newStatus: ApiOrderStatus) {
    if (!order || order.status === newStatus) return;
    setSavingStatus(true);
    try {
      const data = await adminApi.patch<{ order: ApiOrderDetail }>(
        `admin/orders/${order.id}/status`,
        { status: newStatus },
      );
      setOrder(data.order);
      toast(`Status changed to ${copy.orderStatus[newStatus] || newStatus}`, { tone: "positive" });
      onStatusUpdated?.();
    } catch (caught) {
      toast(caught instanceof AdminApiError ? caught.message : "Could not update status", {
        tone: "error",
      });
    } finally {
      setSavingStatus(false);
    }
  }

  function copyFormattedInfo() {
    if (!order) return;
    const text = [
      `Order: #${order.orderNumber}`,
      `Customer: ${order.customerName}`,
      `Phone: ${order.phone}`,
      `Address: ${order.address}, ${order.areaText}`,
      `Total: Tk ${order.grandTotal} (COD)`,
    ].join("\n");

    navigator.clipboard.writeText(text);
    toast("Order details copied to clipboard!", { tone: "positive" });
  }

  const waNum = order ? whatsappNumber(order.phone) : null;
  const waUrl = order
    ? whatsappHref(
        order.phone,
        orderMessage(order, { storeName: "Hinar BD" }),
      )
    : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-150">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-title font-semibold text-ink">
              {order ? `Order #${order.orderNumber}` : "Loading..."}
            </h2>
            {order && (
              <Badge tone="ink" size="md">
                {copy.orderStatus[order.status] ?? order.status}
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink transition-colors"
          >
            <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading || !order ? (
            <div className="flex h-40 items-center justify-center text-caption text-muted">
              Loading order details...
            </div>
          ) : (
            <>
              {/* Quick Actions Row */}
              <div className="flex flex-wrap gap-2 border-b border-line pb-4">
                <Button variant="secondary" size="sm" onClick={copyFormattedInfo}>
                  <svg className="size-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                  </svg>
                  Copy Details
                </Button>

                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-sm bg-emerald-600 px-3 py-1.5 text-caption font-medium text-white hover:bg-emerald-700 transition-colors shadow-xs"
                  >
                    <svg className="size-4 fill-current" viewBox="0 0 24 24">
                      <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z" />
                    </svg>
                    WhatsApp
                  </a>
                )}

                <a
                  href={`tel:${order.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-3 py-1.5 text-caption font-medium text-ink hover:bg-line/60 transition-colors"
                >
                  <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Call
                </a>
              </div>

              {/* Status Selector */}
              <div className="rounded-lg border border-line p-3.5 bg-surface/40">
                <label className="block text-micro uppercase tracking-wider text-muted font-semibold mb-1.5">
                  Update Order Status
                </label>
                <div className="flex gap-2">
                  <select
                    value={order.status}
                    onChange={(e) => handleStatusChange(e.target.value as ApiOrderStatus)}
                    disabled={savingStatus}
                    className="h-10 flex-1 rounded-sm border border-line bg-white px-3 text-caption font-medium text-ink outline-none focus:border-ink"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Customer Details */}
              <div className="rounded-lg border border-line p-4 space-y-2.5">
                <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
                  Customer & Shipping
                </h3>
                <div>
                  <p className="text-body font-medium text-ink">{order.customerName}</p>
                  <p className="text-caption text-ink-soft">{order.phone}</p>
                </div>
                <div className="text-caption text-ink-soft">
                  <p>{order.address}</p>
                  <p className="font-medium text-ink">{order.areaText} ({order.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka"})</p>
                </div>
                <div className="text-micro text-muted pt-1 border-t border-line">
                  Placed on: {formatDateTime(order.createdAt)}
                </div>
              </div>

              {/* Items List */}
              <div className="rounded-lg border border-line p-4 space-y-3">
                <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">
                  Order Items ({order.itemCount})
                </h3>
                <div className="divide-y divide-line">
                  {order.items?.map((item) => (
                    <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-caption">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink truncate">{item.productName}</p>
                        {item.variantLabel && (
                          <p className="text-micro text-muted">{item.variantLabel}</p>
                        )}
                        <p className="text-micro text-ink-soft">
                          Tk {item.unitPrice} × {item.quantity}
                        </p>
                      </div>
                      <span className="font-semibold text-ink shrink-0">
                        Tk {item.unitPrice * item.quantity}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Summary Totals */}
                <div className="border-t border-line pt-3 space-y-1 text-caption">
                  <div className="flex justify-between text-ink-soft">
                    <span>Subtotal</span>
                    <span>Tk {order.subtotal}</span>
                  </div>
                  {order.discount > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Discount</span>
                      <span>-Tk {order.discount}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-ink-soft">
                    <span>Delivery Charge</span>
                    <span>Tk {order.deliveryCharge}</span>
                  </div>
                  <div className="flex justify-between text-body font-bold text-ink pt-1.5 border-t border-line">
                    <span>Grand Total</span>
                    <span>Tk {order.grandTotal}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Link */}
        {order && (
          <div className="border-t border-line p-4 bg-surface/60 flex items-center justify-between">
            <Link
              href={`/admin/orders/${order.orderNumber}`}
              className="text-caption font-medium text-primary hover:underline flex items-center gap-1"
            >
              Open Full Order Page →
            </Link>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
