import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import { getOrderById, getSettings } from "@/lib/data/orders";
import { formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";

/** Never cached — this page is unique to one just-placed order. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.success.heading,
  robots: { index: false, follow: false },
};

export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [order, settings] = await Promise.all([getOrderById(id), getSettings()]);
  if (!order) notFound();

  return (
    <Container className="flex flex-col items-center py-10 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-positive-soft text-positive">
        <Icon name="checkCircle" size={34} strokeWidth={1.6} />
      </div>

      <h1 className="mt-5 text-display text-ink">{copy.success.heading}</h1>

      {/* The order ID is read aloud over the phone during the confirmation
          call, so it's short, uppercase and set in tabular figures. */}
      <div className="mt-5 w-full max-w-sm rounded-md border border-line px-4 py-3.5">
        <p className="text-caption text-muted">{copy.success.orderIdLabel}</p>
        <p className="tnum mt-0.5 text-title font-semibold tracking-wide text-ink">
          {order.orderNumber}
        </p>
      </div>

      <p className="mt-4 max-w-sm text-body text-ink-soft">{copy.success.message}</p>
      <p className="mt-1 text-caption text-muted">{copy.success.saveIdHint}</p>

      <section
        aria-label={copy.checkout.summaryHeading}
        className="mt-8 w-full max-w-sm rounded-md border border-line p-4 text-left"
      >
        <ul className="flex flex-col gap-3">
          {order.items.map((item) => (
            <li key={`${item.productId}-${item.variantId ?? ""}`} className="flex items-center gap-3">
              <div className="relative size-12 shrink-0 overflow-hidden rounded-xs bg-surface">
                <Image
                  src={item.imageSnapshot}
                  alt=""
                  fill
                  sizes="48px"
                  className="object-cover"
                />
                <span className="tnum absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-ink text-micro font-bold text-white">
                  {item.qty}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="clamp-2 text-caption leading-snug text-ink">
                  {item.titleSnapshot}
                </p>
                {item.variantLabel && (
                  <p className="text-micro text-muted">{item.variantLabel}</p>
                )}
              </div>
              <span className="tnum text-caption font-semibold text-ink">
                {formatTaka(item.priceSnapshot * item.qty)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-caption">
          <div className="flex justify-between">
            <dt className="text-muted">{copy.checkout.productSubtotal}</dt>
            <dd className="tnum text-ink">{formatTaka(order.subtotal)}</dd>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">{copy.checkout.discount}</dt>
              <dd className="tnum text-positive">− {formatTaka(order.discount)}</dd>
            </div>
          )}
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
              {formatTaka(order.total)}
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

      <div className="mt-6 flex w-full max-w-sm flex-col gap-2.5">
        <Button href="/track" variant="secondary" size="lg" fullWidth>
          {copy.success.track}
        </Button>
        <Button href="/" variant="primary" size="lg" fullWidth>
          {copy.success.continue}
        </Button>
        <a
          href={`tel:${settings.hotline}`}
          className="mt-1 inline-flex items-center justify-center gap-2 text-caption font-medium text-muted transition-colors hover:text-ink"
        >
          <Icon name="phone" size={15} />
          {copy.contact.call} · {settings.hotline}
        </a>
      </div>
    </Container>
  );
}
