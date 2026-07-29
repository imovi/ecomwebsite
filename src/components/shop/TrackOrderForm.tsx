"use client";

import Image from "next/image";
import { useState } from "react";
import type { Order } from "@/types";
import { trackOrderAction } from "@/app/actions";
import { formatDate, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { OrderTimeline } from "./OrderStatus";

/**
 * Order tracking for guest checkout.
 *
 * Without accounts, this is the only way a customer can see their own order —
 * and without it, every status question becomes a phone call. Requires both
 * the order number and the phone, because order numbers are sequential and the
 * record contains a home address.
 */
export function TrackOrderForm() {
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNotFound(false);

    const result = await trackOrderAction(orderNumber, phone);
    setOrder(result);
    setNotFound(result === null);
    setLoading(false);
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

      {notFound && (
        <p
          role="alert"
          className="mt-5 flex items-center gap-2 rounded-sm bg-sale-soft px-3.5 py-3 text-caption text-sale"
        >
          <Icon name="alert" size={17} />
          {copy.track.notFound}
        </p>
      )}

      {order && (
        <section className="mt-6 rounded-md border border-line p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="tnum text-title font-semibold text-ink">
              {order.orderNumber}
            </p>
            <p className="text-caption text-muted">
              {copy.track.placedOn} {formatDate(order.createdAt)}
            </p>
          </div>

          <div className="mt-5">
            <OrderTimeline status={order.status} />
          </div>

          <ul className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
            {order.items.map((item) => (
              <li
                key={`${item.productId}-${item.variantId ?? ""}`}
                className="flex items-center gap-3"
              >
                <div className="relative size-11 shrink-0 overflow-hidden rounded-xs bg-surface">
                  <Image
                    src={item.imageSnapshot}
                    alt=""
                    fill
                    sizes="44px"
                    className="object-cover"
                  />
                </div>
                <p className="clamp-2 min-w-0 flex-1 text-caption text-ink">
                  {item.titleSnapshot}
                  {item.qty > 1 && (
                    <span className="text-muted"> × {item.qty}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex justify-between border-t border-line pt-4">
            <span className="text-body font-semibold text-ink">
              {copy.checkout.total}
            </span>
            <span className="tnum text-body font-semibold text-ink">
              {formatTaka(order.total)}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
