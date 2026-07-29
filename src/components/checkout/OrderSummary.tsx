"use client";

import Image from "next/image";
import { useState } from "react";
import type { ResolvedLine } from "@/lib/catalog-utils";
import { applyCouponAction } from "@/app/actions";
import { cn, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export interface AppliedCoupon {
  code: string;
  discount: number;
}

/**
 * Live order summary.
 *
 * The delivery charge and grand total update the instant the zone changes —
 * no "calculate shipping" step, no page reload. A customer who can't see the
 * final number before committing is a customer who abandons.
 */
export function OrderSummary({
  lines,
  subtotal,
  discount,
  deliveryCharge,
  total,
  zoneChosen,
  coupon,
  onCouponChange,
  freeDeliveryRemaining,
}: {
  lines: ResolvedLine[];
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  zoneChosen: boolean;
  coupon: AppliedCoupon | null;
  onCouponChange: (coupon: AppliedCoupon | null) => void;
  freeDeliveryRemaining: number;
}) {
  const [code, setCode] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  async function apply() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setApplying(true);
    setCouponError(null);

    const result = await applyCouponAction(trimmed, subtotal);
    setApplying(false);

    if (result.ok) {
      onCouponChange({ code: result.code, discount: result.discount });
      setCode("");
    } else {
      setCouponError(result.message);
    }
  }

  return (
    <section className="rounded-md border border-line p-4" aria-label={copy.checkout.summaryHeading}>
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

      {/* Coupon */}
      <div className="mt-4 border-t border-line pt-4">
        {coupon ? (
          <div className="flex items-center gap-2 rounded-sm bg-positive-soft px-3 py-2.5">
            <Icon name="checkCircle" size={17} className="text-positive" />
            <span className="flex-1 text-caption font-medium text-positive">
              {copy.checkout.couponApplied(coupon.code)}
            </span>
            <button
              type="button"
              onClick={() => onCouponChange(null)}
              className="text-caption font-medium text-muted underline underline-offset-2 hover:text-ink"
            >
              {copy.checkout.couponRemove}
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={copy.checkout.couponPlaceholder}
                aria-label={copy.checkout.couponPlaceholder}
                autoCapitalize="characters"
                className={cn(
                  "h-11 min-w-0 flex-1 rounded-sm border bg-white px-3.5 text-caption uppercase outline-none",
                  couponError ? "border-sale" : "border-line focus:border-ink",
                )}
              />
              <Button
                type="button"
                variant="soft"
                size="md"
                onClick={apply}
                loading={applying}
                disabled={!code.trim() || applying}
              >
                {copy.checkout.couponApply}
              </Button>
            </div>
            {couponError && (
              <p role="alert" className="mt-1.5 text-caption text-sale">
                {couponError}
              </p>
            )}
          </>
        )}
      </div>

      {/* Totals */}
      <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-caption">
        <Row label={copy.checkout.productSubtotal} value={formatTaka(subtotal)} />

        {discount > 0 && (
          <Row
            label={copy.checkout.discount}
            value={`− ${formatTaka(discount)}`}
            tone="positive"
          />
        )}

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
          <dd className="tnum text-title font-semibold text-ink">
            {formatTaka(total)}
          </dd>
        </div>
      </dl>

      {freeDeliveryRemaining > 0 && (
        <p className="mt-3 rounded-sm bg-surface px-3 py-2 text-caption text-ink-soft">
          Add {formatTaka(freeDeliveryRemaining)} more for free delivery.
        </p>
      )}
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
