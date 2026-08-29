"use client";

import Image from "next/image";
import { useState } from "react";
import type { ResolvedLine } from "@/lib/catalog-utils";
import type { ApiCouponQuote } from "@/lib/api/types";
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
 * THE COUPON FIELD
 * ----------------
 * There is one now, and it is the shop's recovery offer rather than a general
 * discount system: a customer who abandoned a checkout is sent a code that
 * takes the delivery charge off, once, within 24 hours.
 *
 * The field is checked by the same quote endpoint that prices everything else,
 * so what it says here is what placement will charge — and if the code has been
 * spent in between, placement refuses rather than quietly charging for delivery
 * after this panel said it was free. On cash on delivery the amount at the door
 * is what causes refusals, and being wrong about it costs a whole parcel.
 */
export function OrderSummary({
  lines,
  subtotal,
  deliveryCharge,
  total,
  zoneChosen,
  freeDeliveryRemaining,
  isPricing,
  coupon,
}: {
  lines: ResolvedLine[];
  subtotal: number;
  deliveryCharge: number;
  total: number;
  zoneChosen: boolean;
  freeDeliveryRemaining: number;
  /** True while a fresh quote is in flight, so figures can read as pending. */
  isPricing?: boolean;
  coupon?: CouponFieldProps;
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

      {coupon && <CouponField {...coupon} />}

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

/* -------------------------------------------------------------------------- */
/* Coupon                                                                     */
/* -------------------------------------------------------------------------- */

export interface CouponFieldProps {
  /** The code currently being priced, or "" when none is applied. */
  applied: string;
  /** What the last quote said about it. Null until one has come back. */
  result: ApiCouponQuote | null;
  onApply: (code: string) => void;
  onRemove: () => void;
  busy?: boolean;
}

/**
 * Where a recovery code is entered.
 *
 * COLLAPSED UNTIL ASKED FOR, ON PURPOSE
 * An open input labelled "Coupon code" tells every shopper that a discount
 * exists somewhere and they have not got it. On a store where codes go to a few
 * dozen people who abandoned a checkout, that is a box which sends far more
 * customers off to search for a code than it ever helps — and some of them do
 * not come back. A quiet line they can tap costs the people who were sent a
 * code nothing, and costs everybody else no doubt.
 *
 * The exception is a code that arrived in the link: that shopper was sent one,
 * so the field opens with it already in place.
 */
function CouponField({ applied, result, onApply, onRemove, busy }: CouponFieldProps) {
  const [open, setOpen] = useState(applied !== "");
  const [draft, setDraft] = useState(applied);

  /* Whether the shop is charging for delivery is the only thing that settles
     whether this worked, so it is what the line reports — not merely that the
     code was recognised. */
  const working = result?.applied === true;
  const refused = result?.reason !== undefined;

  const apply = () => {
    const code = draft.trim().toUpperCase();
    if (code) onApply(code);
  };

  if (!open) {
    return (
      /* Green, and the same green the applied state below uses — so tapping
         this and getting a green confirmation is one continuous thing rather
         than two unrelated boxes. Not red: red is the price colour on this
         shop and would read as an error.

         It used to be a line of 13px grey text, which is exactly the treatment
         of the "pay the courier" hint sitting under it — so the one tappable
         thing in this panel looked like the label that is not tappable, and
         customers holding a code could not find it. */
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-sm border border-positive-soft bg-positive-soft px-3 py-2.5 text-body font-medium text-positive transition-opacity hover:opacity-85"
      >
        <Icon name="bolt" size={16} />
        {copy.checkout.couponPrompt}
      </button>
    );
  }

  return (
    <div className="mt-3">
      {working ? (
        <div className="flex items-center justify-between gap-3 rounded-sm bg-positive-soft px-3 py-2">
          <p className="text-body font-medium text-positive">
            {copy.checkout.couponApplied(applied)}
            {result.saved > 0 && (
              <span className="block text-caption font-normal">
                Free delivery — you save {formatTaka(result.saved)}.
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              onRemove();
              setDraft("");
            }}
            className="shrink-0 text-caption text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            {copy.checkout.couponRemove}
          </button>
        </div>
      ) : (
        /* A div, NOT a form.
           This whole panel renders inside the checkout's own <form>, and a
           nested form is invalid HTML: React warns about it, and — far worse —
           the browser resolves the ambiguity by treating Enter in this input as
           a submit of the OUTER form. A shopper pressing Enter after typing
           their code would have placed the order. Enter is handled explicitly
           below instead. */
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              /* Never let it reach the checkout form. */
              event.preventDefault();
              apply();
            }}
            placeholder={copy.checkout.couponPlaceholder}
            aria-label={copy.checkout.couponPlaceholder}
            aria-invalid={refused || undefined}
            /* No `pattern` and no length rule. A mistyped code should come back
               as "we do not recognise that" from the shop, which is what
               happened; a browser refusing to submit it says the customer typed
               it wrong, which may not be true and which they cannot fix. */
            className="tnum min-w-0 flex-1 rounded-sm border border-line bg-white px-3 py-2.5 text-body uppercase tracking-wide text-ink placeholder:normal-case placeholder:tracking-normal placeholder:text-muted focus:border-ink focus:outline-none"
          />
          <button
            /* `button`, not `submit` — inside the checkout form a submit button
               places the order. */
            type="button"
            onClick={apply}
            disabled={busy || draft.trim() === ""}
            className="shrink-0 rounded-sm border border-line px-3 py-2.5 text-body font-medium text-ink hover:bg-surface disabled:opacity-40"
          >
            {copy.checkout.couponApply}
          </button>
        </div>
      )}

      {/* Both branches: a refusal, and the "already free" case where the code
          is good but there was nothing for it to take off. The second is not an
          error and must not read as one — the customer keeps the code. */}
      {result && !working && result.message && (
        <p
          className={cn(
            "mt-2 text-caption",
            refused ? "text-sale" : "text-muted",
          )}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
