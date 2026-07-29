"use client";

import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

interface QtyStepperProps {
  value: number;
  onChange: (qty: number) => void;
  /** Hard ceiling — always the live stock for the selected variant. */
  max: number;
  min?: number;
  size?: "md" | "sm";
  className?: string;
}

/**
 * Quantity control, clamped to available stock.
 *
 * Letting a customer type 10 when 3 are in stock only moves the failure to the
 * order confirmation call, which is the most expensive place to discover it.
 */
export function QtyStepper({
  value,
  onChange,
  max,
  min = 1,
  size = "md",
  className,
}: QtyStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(n, Math.max(max, min)));
  const buttonSize = size === "sm" ? "size-9" : "size-11";

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-sm border border-line",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label={copy.product.decrease}
        className={cn(
          buttonSize,
          "flex items-center justify-center rounded-l-sm text-ink transition-colors",
          "hover:bg-surface active:bg-line disabled:text-line disabled:hover:bg-transparent",
        )}
      >
        <Icon name="minus" size={16} />
      </button>

      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        aria-label={copy.product.quantity}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(clamp(next));
        }}
        className={cn(
          "tnum w-10 border-0 bg-transparent text-center text-body font-semibold outline-none",
          size === "sm" && "w-8 text-caption",
        )}
      />

      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label={copy.product.increase}
        className={cn(
          buttonSize,
          "flex items-center justify-center rounded-r-sm text-ink transition-colors",
          "hover:bg-surface active:bg-line disabled:text-line disabled:hover:bg-transparent",
        )}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
