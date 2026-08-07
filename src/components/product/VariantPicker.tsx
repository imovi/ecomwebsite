"use client";

import { cn } from "@/lib/utils";
import { isOptionValueAvailable } from "@/lib/catalog-utils";
import { copy } from "@/lib/copy";
import type { Product, VariantOptionName } from "@/types";

type Selection = Partial<Record<VariantOptionName, string>>;

interface VariantPickerProps {
  product: Product;
  selection: Selection;
  onChange: (selection: Selection) => void;
  /** Highlights unchosen axes in red after a failed Buy Now attempt. */
  errorAxes?: VariantOptionName[];
}

export function VariantPicker({
  product,
  selection,
  onChange,
  errorAxes = [],
}: VariantPickerProps) {
  if (!product.options.length) return null;

  return (
    <div className="flex flex-col gap-5">
      {product.options.map((option) => {
        const chosen = selection[option.name];
        const hasError = errorAxes.includes(option.name);

        return (
          <fieldset key={option.name}>
            <legend className="mb-2.5 flex w-full items-baseline gap-2 text-caption">
              <span className={cn("font-medium", hasError ? "text-sale" : "text-muted")}>
                {option.name}
              </span>
              {chosen && <span className="font-semibold text-ink">{chosen}</span>}
            </legend>

            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const selected = chosen === value;
                const available = isOptionValueAvailable(
                  product,
                  option.name,
                  value,
                  // Availability is judged against the OTHER axes only,
                  // otherwise every value on this axis looks unavailable as
                  // soon as one is picked.
                  { ...selection, [option.name]: undefined },
                );

                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={
                      available ? value : `${value} — currently unavailable`
                    }
                    onClick={() => onChange({ ...selection, [option.name]: value })}
                    className={cn(
                      "min-h-11 rounded-sm border px-3.5 py-2 text-caption font-medium",
                      "transition-[border-color,background-color,color] duration-150 ease-out",
                      "active:scale-[0.98]",
                      selected
                        ? "border-ink bg-ink text-white"
                        : available
                          ? "border-line bg-white text-ink hover:border-muted"
                          : // Sold-out combinations stay selectable so the
                            // customer can see the price, but read as struck.
                            "border-line bg-white text-muted line-through decoration-muted",
                      hasError && !chosen && "border-sale",
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>

            {/* Under the axis, not only in the toast: a toast is gone in three
                seconds and the customer is looking at the buttons by then. */}
            {hasError && !chosen && (
              <p role="alert" className="mt-2 flex items-center gap-1.5 text-caption text-sale">
                <span aria-hidden="true">↑</span>
                {copy.product.selectAxis(option.name)}
              </p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
