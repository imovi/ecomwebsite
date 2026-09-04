"use client";

import type { DeliveryZone } from "@/types";
import type { ZoneSuggestion } from "@/lib/geo";
import { cn, formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

/**
 * The delivery zone the customer confirms — and the value stored on the order.
 *
 * Text matching (see `lib/geo.ts`) only *pre-selects* one of these two
 * options. It is never the source of truth, because the failure modes of pure
 * text detection all cost money at the doorstep: "Dhanmondi" contains no
 * "Dhaka", and "Savar, Dhaka" is billed at the outside-city rate despite
 * containing it.
 *
 * One extra tap, and the charge becomes deterministic and auditable.
 */
export function ZoneSelector({
  value,
  onChange,
  insideCharge,
  outsideCharge,
  suggestion,
  freeDelivery,
  error,
  insideLabel,
  outsideLabel,
  heading,
}: {
  value: DeliveryZone | null;
  onChange: (zone: DeliveryZone) => void;
  insideCharge: number;
  outsideCharge: number;
  suggestion: ZoneSuggestion | null;
  /** True when the order already qualifies for free delivery. */
  freeDelivery: boolean;
  error?: string;
  insideLabel?: string;
  outsideLabel?: string;
  heading?: string;
}) {
  const options: { zone: DeliveryZone; label: string; charge: number }[] = [
    { zone: "inside_dhaka", label: insideLabel || copy.checkout.zoneInside, charge: insideCharge },
    { zone: "outside_dhaka", label: outsideLabel || copy.checkout.zoneOutside, charge: outsideCharge },
  ];

  return (
    /* `data-field` so a failed checkout can scroll here: these are buttons,
       not an input, so there is no `aria-invalid` to find. */
    <fieldset data-field="zone">
      <legend className="mb-2 text-caption font-medium text-ink-soft">
        {heading || copy.checkout.zoneHeading}
        <span className="text-sale"> *</span>
      </legend>

      <div className="grid grid-cols-2 gap-2.5">
        {options.map((option) => {
          const selected = value === option.zone;
          return (
            <button
              key={option.zone}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.zone)}
              className={cn(
                "flex min-h-[62px] flex-col items-start justify-center gap-0.5 rounded-sm border px-3.5 py-2.5 text-left",
                "transition-[border-color,background-color] duration-150 ease-out active:scale-[0.99]",
                selected
                  ? "border-ink bg-surface"
                  : error
                    ? "border-sale bg-white"
                    : "border-line bg-white hover:border-muted",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2 text-caption font-semibold text-ink">
                {option.label}
                {selected && <Icon name="checkCircle" size={16} />}
              </span>
              <span
                className={cn(
                  "tnum text-caption",
                  freeDelivery ? "text-positive" : "text-muted",
                )}
              >
                {freeDelivery ? copy.checkout.freeDelivery : formatTaka(option.charge)}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-1.5 text-caption text-sale">
          {error}
        </p>
      ) : suggestion ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-caption text-muted">
          <Icon name="checkCircle" size={14} className="text-positive" />
          {copy.checkout.zoneSuggested(suggestion.matched)}
        </p>
      ) : (
        <p className="mt-1.5 text-caption text-muted">{copy.checkout.zoneManual}</p>
      )}
    </fieldset>
  );
}
