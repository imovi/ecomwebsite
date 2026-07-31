"use client";

import Image from "next/image";
import { useState } from "react";
import { trackOrderAction } from "@/app/actions";
import { formatDate, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { OrderTimeline } from "./OrderStatus";
import type { ApiOrderTracking } from "@/lib/api/types";

/**
 * Order tracking for guest checkout.
 *
 * Without accounts this is the only way a customer can see their own order, and
 * without it every status question becomes a phone call.
 *
 * Both the order number AND the phone it was placed with are required. Order
 * numbers come from a sequence, so a lookup on the number alone would let
 * anyone walk it. The API returns an identical response for "no such order" and
 * "wrong phone", so this form cannot be used to discover which numbers exist —
 * which is why there is one generic not-found message rather than two.
 */
export function TrackOrderForm() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<ApiOrderTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setOrder(null);

    const result = await trackOrderAction(orderNumber, phone);
    setLoading(false);

    if (result.ok) setOrder(result.order);
    else setError(result.error);
  }

  return (
    <div className="mx-auto max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label={copy.track.orderId}
          placeholder={copy.track.orderIdPlaceholder}
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          required
        />
        <Input
          label={copy.track.phone}
          placeholder={copy.checkout.phonePlaceholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
          disabled={loading}
        >
          {copy.track.submit}
        </Button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-center gap-2 rounded-sm bg-sale-soft px-3.5 py-3 text-caption text-sale"
        >
          <Icon name="alert" size={17} />
          {error}
        </p>
      )}

      {order && (
        <section className="mt-6 rounded-md border border-line p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="tnum text-title font-semibold text-ink">{order.orderNumber}</p>
            <p className="text-caption text-muted">
              {copy.track.placedOn} {formatDate(order.placedAt)}
            </p>
          </div>

          <div className="mt-5">
            <OrderTimeline status={order.status} />
          </div>

          {order.courier && <CourierLine courier={order.courier} />}

          <ul className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
            {order.items.map((item, index) => (
              <li key={`${item.productName}-${index}`} className="flex items-center gap-3">
                <div className="relative size-11 shrink-0 overflow-hidden rounded-xs bg-surface">
                  {item.imageUrl && (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      sizes="44px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="clamp-2 text-caption text-ink">
                    {item.productName}
                    {item.quantity > 1 && (
                      <span className="text-muted"> × {item.quantity}</span>
                    )}
                  </p>
                  {item.variantLabel && (
                    <p className="text-micro text-muted">{item.variantLabel}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex justify-between border-t border-line pt-4">
            <span className="text-body font-semibold text-ink">{copy.checkout.total}</span>
            <span className="tnum text-body font-semibold text-ink">
              {formatTaka(order.grandTotal)}
            </span>
          </div>

          <p className="mt-3 flex items-center gap-2 text-caption text-muted">
            <Icon name="cash" size={15} />
            {copy.success.codNote}
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * Where the parcel is, in the shop's words.
 *
 * The courier's own status is never shown: they report `partial_delivered` and
 * `return_pending` in wording that changes without notice and mixes English
 * with Bangla. The tracking code is offered so a customer who wants the
 * carrier's live detail can look it up themselves.
 */
function CourierLine({
  courier,
}: {
  courier: NonNullable<ApiOrderTracking["courier"]>;
}) {
  const label: Record<string, string> = {
    pending: "Handed to the courier",
    picked_up: "Picked up by the courier",
    in_transit: "On the way to you",
    out_for_delivery: "Out for delivery today",
    delivered: "Delivered",
    returned: "Returned to us",
    cancelled: "Cancelled",
    /* Deliberately not a guess. */
    unknown: "With the courier",
  };

  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-sm bg-surface px-3 py-2.5">
      <Icon name="truck" size={17} className="mt-0.5 shrink-0 text-muted" />
      <div>
        <p className="text-caption font-medium text-ink">
          {label[courier.status] ?? label.unknown}
        </p>
        {courier.trackingCode && (
          <p className="mt-0.5 text-micro text-muted">
            {courier.provider} tracking:{" "}
            <span className="tnum select-all font-mono text-ink-soft">
              {courier.trackingCode}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
