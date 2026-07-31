"use client";

import Image from "next/image";
import type { ResolvedLine } from "@/lib/catalog-utils";
import { cn, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

/**
 * Live order summary.
 *
 * Every figure shown here comes from the API's own quote endpoint, and the
 * delivery charge updates the instant the zone changes — no "calculate
 * shipping" step, no page reload. A customer who cannot see the final number
 * before committing is a customer who abandons.
 *
 * Nothing is computed locally. The subtotal, delivery charge and total are all
 * server-derived, and the same calculation runs again at order placement, so
 * what the customer agrees to is what the order is written with.
 *
 * NO COUPON FIELD, DELIBERATELY
 * -----------------------------
 * The API has no coupon support — discounts were explicitly out of scope. A
 * coupon input that rejects every code is worse than no input at all: it
 * advertises a discount that does not exist and makes shoppers hunt for a code
 * before they buy. When coupons are built server-side, this is where the field
 * belongs.
 */
export function OrderSummary({
  lines,
  subtotal,
  deliveryCharge,
  total,
  zoneChosen,
  freeDeliveryRemaining,
  isPricing,
}: {
  lines: ResolvedLine[];
  subtotal: number;
  deliveryCharge: number;
  total: number;
  zoneChosen: boolean;
  freeDeliveryRemaining: number;
  /** True while a fresh quote is in flight, so figures can read as pending. */
  isPricing?: boolean;
}) {
  return (
    <section
      className="rounded-md border border-line p-4"
      aria-label={copy.checkout.summaryHeading}
      aria-busy={isPricing}
    >
      <h2 className="text-title text-ink">{copy.checkout.summaryHeading}</h2>

      <ul className="mt-4 flex flex-col gap-3">
        {lines.map((line) => (
          <li
            key={`${line.productId}-${line.variantId ?? ""}`}
            className="flex items-center gap-3"
          >
            <div className="relative size-12 shrink-0 overflow-hidden rounded-xs bg-surface">
              <Image
                src={line.image}
                alt=""
                fill
                sizes="48px"
                loading="lazy"
                className="object-cover"
              />
              <span className="tnum absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-ink text-micro font-bold text-white">
                {line.qty}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="clamp-2 text-caption leading-snug text-ink">{line.title}</p>
              {line.variantLabel && (
                <p className="text-micro text-muted">{line.variantLabel}</p>
              )}
            </div>
            <span className="tnum shrink-0 text-caption font-semibold text-ink">
              {formatTaka(line.lineTotal)}
            </span>
          </li>
        ))}
      </ul>

      <dl
        className={cn(
          "mt-4 flex flex-col gap-2 border-t border-line pt-4 text-caption transition-opacity",
          isPricing && "opacity-60",
        )}
      >
        <Row label={copy.checkout.productSubtotal} value={formatTaka(subtotal)} />

        <Row
          label={copy.checkout.deliveryCharge}
          value={
            !zoneChosen
              ? "—"
              : deliveryCharge === 0
                ? copy.checkout.freeDelivery
                : formatTaka(deliveryCharge)
          }
          tone={zoneChosen && deliveryCharge === 0 ? "positive" : undefined}
        />

        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
          <dt className="text-body font-semibold text-ink">{copy.checkout.total}</dt>
          <dd className="tnum text-title font-semibold text-ink">{formatTaka(total)}</dd>
        </div>
      </dl>

      {freeDeliveryRemaining > 0 && (
        <p className="mt-3 rounded-sm bg-surface px-3 py-2 text-caption text-ink-soft">
          Add {formatTaka(freeDeliveryRemaining)} more for free delivery.
        </p>
      )}

      <p className="mt-3 flex items-center gap-2 text-caption text-muted">
        <Icon name="cash" size={15} />
        {copy.checkout.codHint}
      </p>
    </section>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd
        className={cn(
          "tnum font-medium",
          tone === "positive" ? "text-positive" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
