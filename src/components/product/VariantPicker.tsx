"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import { isOptionValueAvailable, type VariantedProduct } from "@/lib/catalog-utils";
import { copy } from "@/lib/copy";
import type { VariantOptionName } from "@/types";

type Selection = Partial<Record<VariantOptionName, string>>;

interface VariantPickerProps {
  /* Widened from `Product` so the listing card's quick-add sheet can reuse this
     picker against its trimmed projection. */
  product: VariantedProduct;
  selection: Selection;
  onChange: (selection: Selection) => void;
  /** Highlights unchosen axes in red after a failed Buy Now attempt. */
  errorAxes?: VariantOptionName[];
  /**
   * Fully rounded value buttons.
   *
   * The quick-add sheet is a compact card floating over a grid, and pills read
   * as lighter there than the page's squarer controls do. The product page,
   * where the picker sits in a column of squared-off blocks, keeps the default.
   */
  shape?: "square" | "pill";
}

/**
 * The picture that stands for one value on one axis.
 *
 * A variant carries the image, not an option value — and with two axes, "Green"
 * belongs to Green/128GB and Green/256GB alike. So this takes the first variant
 * matching the value that actually has a picture, which is what a shopkeeper
 * means by "the green one": any photograph of the product in green will do, and
 * the storage tier does not change how it looks.
 *
 * Returns null when nothing on that axis has been given a picture, and the
 * caller falls back to text. Half-configured must degrade to readable rather
 * than render an empty square.
 */
function swatchFor(
  product: VariantedProduct,
  optionName: VariantOptionName,
  value: string,
): string | null {
  const variant = product.variants.find(
    (candidate) => candidate.options[optionName] === value && candidate.imageIndex !== undefined,
  );

  if (!variant || variant.imageIndex === undefined) return null;
  return product.images[variant.imageIndex] ?? null;
}

export function VariantPicker({
  product,
  selection,
  onChange,
  errorAxes = [],
  shape = "square",
}: VariantPickerProps) {
  if (!product.options.length) return null;

  /* Pills get extra horizontal padding and a floor on their width so a
     single-character value like "S" reads as an oval rather than a circle —
     a circle in a row of ovals looks like a different kind of control. */
  const valueShape =
    shape === "pill" ? "rounded-full px-5 min-w-[3.5rem]" : "rounded-sm px-3.5";

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

                /* Only when the axis asks for pictures AND this value has one.
                   A half-configured axis falls back to its text button rather
                   than rendering an empty square — readable beats decorative
                   when a shop owner has assigned three swatches out of four. */
                const swatch =
                  option.display === "image" ? swatchFor(product, option.name, value) : null;

                if (swatch) {
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      /* The picture carries no meaning to a screen reader, so
                         the label does — and it is the same sentence the text
                         button would have given. */
                      aria-label={available ? value : `${value} — currently unavailable`}
                      title={value}
                      onClick={() => onChange({ ...selection, [option.name]: value })}
                      className={cn(
                        "relative size-16 overflow-hidden border-2 bg-white",
                        shape === "pill" ? "rounded-full" : "rounded-sm",
                        "transition-[border-color] duration-150 ease-out",
                        "active:scale-[0.98]",
                        selected ? "border-ink" : "border-line hover:border-muted",
                        hasError && !chosen && "border-sale",
                      )}
                    >
                      {/* The fade goes on the PHOTOGRAPH, not on the button.
                          CSS opacity applies to an element and everything
                          inside it as one group, so dimming the button dimmed
                          the "out of stock" caption with it — 85% white over a
                          product photo became about 34%, and the words it exists
                          to say stopped being readable. */}
                      <Image
                        src={swatch}
                        alt=""
                        fill
                        sizes="64px"
                        className={cn(
                          "object-cover transition-opacity duration-150 ease-out",
                          /* Faded rather than struck through: a line across a
                             photograph reads as a rendering fault. */
                          !available && "opacity-40",
                        )}
                      />
                      {!available && (
                        <span className="absolute inset-x-0 bottom-0 bg-white/90 py-0.5 text-center text-micro font-medium text-ink">
                          {copy.product.outOfStock}
                        </span>
                      )}
                    </button>
                  );
                }

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
                      "min-h-11 border py-2 text-caption font-medium",
                      valueShape,
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
