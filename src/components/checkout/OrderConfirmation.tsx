"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { recallOrder } from "@/lib/stores/last-order";
import { trackPurchaseView } from "@/lib/analytics/events";
import { formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ApiOrderConfirmation } from "@/lib/api/types";

/**
 * Order confirmation.
 *
 * The order number always renders — it comes from the URL and is the one thing
 * the customer must be able to read back over the phone. The itemised summary
 * comes from the stash checkout left behind, so a refresh or a shared link
 * still shows a correct, useful page rather than an error.
 */
export function OrderConfirmation({
  orderNumber,
  hotline,
}: {
  orderNumber: string;
  hotline: string;
}) {
  const [order, setOrder] = useState<ApiOrderConfirmation | null>(null);

  useEffect(() => {
    /* sessionStorage exists only in the browser, so this cannot run during the
       server render — and a lazy useState initialiser would render different
       markup on the server than on the client, which is a hydration mismatch.
       Reading it in an effect is the correct trade: one extra paint, and the
       order number (the part that matters) renders immediately either way. */
    const stashed = recallOrder(orderNumber);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(stashed);

    /* Google's purchase event.
     *
     * Only Google's — Meta's Purchase is sent by the API, and sending it from
     * here too would double-count the sale. GTM has no server-side path, so its
     * conversion has to come from this page; `trackPurchaseView` guards against a
     * refresh reporting the same order twice.
     *
     * Skipped entirely when the stash is missing (a shared link, a new session):
     * an order number alone cannot produce a correct value or item list, and a
     * purchase event with the wrong revenue is worse than none. */
    if (stashed) {
      trackPurchaseView({
        orderNumber: stashed.orderNumber,
        value: stashed.grandTotal,
        shipping: stashed.deliveryCharge,
        items: stashed.items.map((item) => ({
          sku: item.sku,
          title: item.productName,
          price: item.unitPrice,
          quantity: item.quantity,
        })),
      });
    }
  }, [orderNumber]);

  return (
    <>
      <div className="flex size-16 items-center justify-center rounded-full bg-positive-soft text-positive">
        <Icon name="checkCircle" size={34} strokeWidth={1.6} />
      </div>

      <h1 className="mt-5 text-display text-ink">{copy.success.heading}</h1>

      {/* Read aloud during the confirmation call — short, uppercase, tabular. */}
      <div className="mt-5 w-full max-w-sm rounded-md border border-line px-4 py-3.5">
        <p className="text-caption text-muted">{copy.success.orderIdLabel}</p>
        <p className="tnum mt-0.5 text-title font-semibold tracking-wide text-ink">
          {orderNumber}
        </p>
      </div>

      <p className="mt-4 max-w-sm text-body text-ink-soft">{copy.success.message}</p>
      <p className="mt-1 text-caption text-muted">{copy.success.saveIdHint}</p>

      {order && (
        <section
          aria-label={copy.checkout.summaryHeading}
          className="mt-8 w-full max-w-sm rounded-md border border-line p-4 text-left"
        >
          <ul className="flex flex-col gap-3">
            {order.items.map((item, index) => (
              <li key={`${item.sku}-${index}`} className="flex items-center gap-3">
                <div className="relative size-12 shrink-0 overflow-hidden rounded-xs bg-surface">
                  {item.imageUrl && (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  )}
                  <span className="tnum absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-ink text-micro font-bold text-white">
                    {item.quantity}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="clamp-2 text-caption leading-snug text-ink">
                    {item.productName}
                  </p>
                  {item.variantLabel && (
                    <p className="text-micro text-muted">{item.variantLabel}</p>
                  )}
                </div>
                <span className="tnum text-caption font-semibold text-ink">
                  {formatTaka(item.lineTotal)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-caption">
            <div className="flex justify-between">
              <dt className="text-muted">{copy.checkout.productSubtotal}</dt>
              <dd className="tnum text-ink">{formatTaka(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">{copy.checkout.deliveryCharge}</dt>
              <dd className="tnum text-ink">
                {order.deliveryCharge === 0
                  ? copy.checkout.freeDelivery
                  : formatTaka(order.deliveryCharge)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3">
              <dt className="text-body font-semibold text-ink">{copy.checkout.total}</dt>
              <dd className="tnum text-body font-semibold text-ink">
                {formatTaka(order.grandTotal)}
              </dd>
            </div>
          </dl>

          <p className="mt-3 flex items-center gap-2 rounded-sm bg-surface px-3 py-2 text-caption text-ink-soft">
            <Icon name="cash" size={16} className="text-muted" />
            {copy.success.codNote}
          </p>

          <div className="mt-4 border-t border-line pt-4 text-caption">
            <p className="font-medium text-ink">{order.customerName}</p>
            <p className="mt-0.5 text-muted">{order.phone}</p>
            <p className="mt-0.5 text-muted">
              {order.address}, {order.areaText}
            </p>
          </div>
        </section>
      )}

      <div className="mt-6 flex w-full max-w-sm flex-col gap-2.5">
        <Button href="/track" variant="secondary" size="lg" fullWidth>
          {copy.success.track}
        </Button>
        <Button href="/" variant="primary" size="lg" fullWidth>
          {copy.success.continue}
        </Button>
        {hotline && (
          <a
            href={`tel:${hotline}`}
            className="mt-1 inline-flex items-center justify-center gap-2 text-caption font-medium text-muted transition-colors hover:text-ink"
          >
            <Icon name="phone" size={15} />
            {copy.contact.call} · {hotline}
          </a>
        )}
      </div>
    </>
  );
}
