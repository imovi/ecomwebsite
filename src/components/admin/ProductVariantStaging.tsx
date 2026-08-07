"use client";

import { useState } from "react";
import { slugify } from "@/lib/utils";
import { Card, CardHeader } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * Variant editor for a product that does not exist yet.
 *
 * The saved-product editor in `ProductVariants` talks to the API on every
 * keystroke's worth of intent — it can, because there is a row to attach to.
 * During creation there is not, so everything is held here and sent inline with
 * the product: `POST /admin/products` already accepts `variantOptions` and
 * `variants`, and writes all of it in one transaction.
 *
 * Entirely optional. A power bank has no variants and its stock lives on the
 * product itself; the section stays collapsed until the admin asks for it.
 */

export interface StagedVariant {
  /** Stable key so a row does not remount when a sibling above it is removed. */
  id: string;
  /** Axis name → chosen value. Read through the axes, never trusted alone. */
  options: Record<string, string>;
  sku: string;
  price: string;
  stock: string;
}

export interface VariantDraft {
  /* Axis values stay raw text — "Black, Blue, Titanium" — because that is how
     someone types a list, and it is the same shape the saved-product editor
     uses. Parsing happens once, at submit.

     `id` is presentation-only: it keys the row so a removal cannot shift focus
     or in-progress IME composition onto the next input. `parseAxes` builds the
     payload from scratch, so it never reaches the API. */
  axes: { id: string; name: string; values: string }[];
  variants: StagedVariant[];
}

export const EMPTY_VARIANT_DRAFT: VariantDraft = { axes: [], variants: [] };

let axisRowSeq = 0;
export const nextAxisRowId = () => `axis-${(axisRowSeq += 1)}`;

const MAX_AXES = 4;
const MAX_VARIANTS = 100;

export interface ParsedAxis {
  name: string;
  values: string[];
}

/**
 * Axes as the API wants them.
 *
 * Blank rows are dropped rather than rejected — an admin who clicked "Add
 * option type" and changed their mind should not have to delete the row before
 * saving. Values are deduplicated case-insensitively because the API refuses a
 * repeated value, and "Black, black" is a typo rather than a decision.
 */
export function parseAxes(axes: VariantDraft["axes"]): ParsedAxis[] {
  return axes
    .map((axis) => {
      const seen = new Set<string>();
      const values: string[] = [];
      for (const raw of axis.values.split(",")) {
        const value = raw.trim();
        if (value === "" || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        values.push(value);
      }
      return { name: axis.name.trim(), values };
    })
    .filter((axis) => axis.name !== "" && axis.values.length > 0);
}

/**
 * A row's options, resolved against the current axes.
 *
 * The stored map is advisory: an axis can be renamed or have a value removed
 * after the row was created, so every read goes through the axes and falls back
 * to the first allowed value. That makes an axis edit incapable of leaving a
 * row pointing at a value the API would reject.
 */
export function resolveOptions(
  variant: StagedVariant,
  axes: ParsedAxis[],
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const axis of axes) {
    const chosen = variant.options[axis.name];
    options[axis.name] =
      chosen !== undefined && axis.values.includes(chosen) ? chosen : (axis.values[0] ?? "");
  }
  return options;
}

function signature(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([name, value]) => `${name.toLowerCase()}=${value.toLowerCase()}`)
    .sort()
    .join("|");
}

export interface VariantPayload {
  variantOptions: ParsedAxis[];
  variants: {
    sku: string;
    options: Record<string, string>;
    price: number;
    stockQuantity: number;
  }[];
}

/**
 * The draft as request body, or a message explaining why it is not ready.
 *
 * Checked here rather than left to the API purely so the admin hears about a
 * blank SKU next to the blank SKU, instead of as `body.variants[3].sku` in a
 * banner at the top of a long form.
 */
export function buildVariantPayload(
  draft: VariantDraft,
): { payload: VariantPayload } | { error: string } {
  const variantOptions = parseAxes(draft.axes);

  if (draft.variants.length === 0) {
    /* Axes with no variants are legal — the product simply declares what it
       will be split by later — so this is not an error. */
    return { payload: { variantOptions, variants: [] } };
  }

  if (variantOptions.length === 0) {
    return { error: "Add at least one option type, with values, before adding variants." };
  }

  const variants: VariantPayload["variants"] = [];
  const seenSkus = new Set<string>();
  const seenCombinations = new Set<string>();

  for (const [index, variant] of draft.variants.entries()) {
    const position = `Variant ${index + 1}`;
    const sku = variant.sku.trim();
    if (sku === "") return { error: `${position} needs a SKU.` };
    if (seenSkus.has(sku.toLowerCase())) {
      return { error: `Two variants share the SKU "${sku}". Each one must be unique.` };
    }
    seenSkus.add(sku.toLowerCase());

    if (variant.price.trim() === "") return { error: `${position} needs a price.` };
    const price = Number(variant.price);
    if (!Number.isInteger(price) || price < 0) {
      return { error: `${position} needs a whole number price in taka.` };
    }

    const stock = variant.stock.trim() === "" ? 0 : Number(variant.stock);
    if (!Number.isInteger(stock) || stock < 0) {
      return { error: `${position} needs a whole number of pieces in stock.` };
    }

    const options = resolveOptions(variant, variantOptions);
    const key = signature(options);
    if (seenCombinations.has(key)) {
      return {
        error: `Two variants are the same combination (${Object.values(options).join(" / ")}).`,
      };
    }
    seenCombinations.add(key);

    variants.push({ sku, options, price, stockQuantity: stock });
  }

  return { payload: { variantOptions, variants } };
}

/** Every combination of the axes, in the order the axes are declared. */
function combinations(axes: ParsedAxis[]): Record<string, string>[] {
  return axes.reduce<Record<string, string>[]>(
    (rows, axis) =>
      rows.flatMap((row) => axis.values.map((value) => ({ ...row, [axis.name]: value }))),
    [{}],
  );
}

function newRow(options: Record<string, string>, sku: string, price: string): StagedVariant {
  return { id: crypto.randomUUID(), options, sku, price, stock: "0" };
}

export function ProductVariantStaging({
  draft,
  onChange,
  productSku,
  productPrice,
  disabled,
}: {
  draft: VariantDraft;
  onChange: (draft: VariantDraft) => void;
  /** Seeds generated SKUs, so "GNG-TSHIRT" becomes "GNG-TSHIRT-RED-XL". */
  productSku: string;
  /** Seeds a generated row's price — most variants cost what the product does. */
  productPrice: string;
  disabled?: boolean;
}) {
  /* Collapsed by default: most products have no variants, and an open editor
     full of empty inputs reads as work that has to be done. */
  const [open, setOpen] = useState(false);

  const axes = parseAxes(draft.axes);
  const used = new Set(draft.variants.map((variant) => signature(resolveOptions(variant, axes))));
  const missing = axes.length > 0 ? combinations(axes).filter((o) => !used.has(signature(o))) : [];

  const setAxes = (next: VariantDraft["axes"]) => onChange({ ...draft, axes: next });
  const setVariants = (next: StagedVariant[]) => onChange({ ...draft, variants: next });

  const skuFor = (options: Record<string, string>) => {
    const base = productSku.trim() || "SKU";
    const suffix = Object.values(options)
      .map((value) => slugify(value).toUpperCase())
      .filter(Boolean)
      .join("-");
    return suffix ? `${base}-${suffix}` : base;
  };

  if (!open) {
    return (
      <Card>
        <CardHeader
          title="Variants"
          hint="Only if the same product sells in several versions — colours, sizes, storage. Each one carries its own stock."
        />
        <div className="p-4">
          <Button
            type="button"
            variant="soft"
            size="md"
            disabled={disabled}
            onClick={() => setOpen(true)}
            className="self-start"
          >
            <Icon name="plus" size={16} />
            This product has variants
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Variants"
        hint="Declare the option types first, then a row per combination. Stock entered here replaces the single stock figure above."
      />

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2 rounded-sm bg-surface p-3">
          <p className="text-caption font-medium text-ink-soft">Option types</p>

          {draft.axes.map((axis, index) => (
            <div key={axis.id} className="flex items-center gap-2">
              <input
                value={axis.name}
                onChange={(event) =>
                  setAxes(
                    draft.axes.map((row) =>
                      row.id === axis.id ? { ...row, name: event.target.value } : row,
                    ),
                  )
                }
                placeholder="Colour"
                aria-label={`Option ${index + 1} name`}
                disabled={disabled}
                className="h-10 w-1/3 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
              />
              <input
                value={axis.values}
                onChange={(event) =>
                  setAxes(
                    draft.axes.map((row) =>
                      row.id === axis.id ? { ...row, values: event.target.value } : row,
                    ),
                  )
                }
                placeholder="Black, Blue, Titanium"
                aria-label={`Option ${index + 1} values`}
                disabled={disabled}
                className="h-10 flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
              />
              <button
                type="button"
                onClick={() => setAxes(draft.axes.filter((row) => row.id !== axis.id))}
                aria-label={`Remove option ${index + 1}`}
                disabled={disabled}
                className="flex size-9 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-sale-soft hover:text-sale"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || draft.axes.length >= MAX_AXES}
            onClick={() => setAxes([...draft.axes, { id: nextAxisRowId(), name: "", values: "" }])}
            className="self-start"
          >
            <Icon name="plus" size={15} />
            {draft.axes.length === 0 ? "Add an option type" : "Add another option type"}
          </Button>
        </div>

        {axes.length > 0 && (
          <>
            {draft.variants.length > 0 && (
              <ul className="flex flex-col gap-2">
                {draft.variants.map((variant, index) => {
                  const options = resolveOptions(variant, axes);
                  const label = Object.values(options).join(" / ");

                  return (
                    <li
                      key={variant.id}
                      className="flex flex-wrap items-end gap-2 rounded-sm border border-line p-2.5"
                    >
                      {axes.map((axis) => (
                        <label
                          key={axis.name}
                          className="flex min-w-28 flex-1 flex-col gap-1 text-micro text-muted"
                        >
                          {axis.name}
                          <select
                            value={options[axis.name]}
                            onChange={(event) =>
                              setVariants(
                                draft.variants.map((row, i) =>
                                  i === index
                                    ? {
                                        ...row,
                                        options: { ...row.options, [axis.name]: event.target.value },
                                      }
                                    : row,
                                ),
                              )
                            }
                            disabled={disabled}
                            className="h-10 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
                          >
                            {axis.values.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}

                      <label className="flex min-w-36 flex-1 flex-col gap-1 text-micro text-muted">
                        SKU
                        <input
                          value={variant.sku}
                          onChange={(event) =>
                            setVariants(
                              draft.variants.map((row, i) =>
                                i === index ? { ...row, sku: event.target.value } : row,
                              ),
                            )
                          }
                          placeholder={skuFor(options)}
                          disabled={disabled}
                          className="h-10 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
                        />
                      </label>

                      <label className="flex w-24 flex-col gap-1 text-micro text-muted">
                        Price (৳)
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={variant.price}
                          onChange={(event) =>
                            setVariants(
                              draft.variants.map((row, i) =>
                                i === index ? { ...row, price: event.target.value } : row,
                              ),
                            )
                          }
                          disabled={disabled}
                          className="tnum h-10 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
                        />
                      </label>

                      <label className="flex w-20 flex-col gap-1 text-micro text-muted">
                        Pieces
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={variant.stock}
                          onChange={(event) =>
                            setVariants(
                              draft.variants.map((row, i) =>
                                i === index ? { ...row, stock: event.target.value } : row,
                              ),
                            )
                          }
                          disabled={disabled}
                          className="tnum h-10 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => setVariants(draft.variants.filter((_, i) => i !== index))}
                        aria-label={`Remove variant ${label || index + 1}`}
                        disabled={disabled}
                        className="mb-0.5 flex size-9 items-center justify-center rounded-sm text-muted hover:bg-sale-soft hover:text-sale"
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="soft"
                size="sm"
                disabled={disabled || missing.length === 0 || draft.variants.length >= MAX_VARIANTS}
                onClick={() =>
                  setVariants([
                    ...draft.variants,
                    ...missing
                      .slice(0, MAX_VARIANTS - draft.variants.length)
                      .map((options) => newRow(options, skuFor(options), productPrice)),
                  ])
                }
              >
                <Icon name="plus" size={15} />
                {draft.variants.length === 0
                  ? `Add all ${missing.length} combinations`
                  : `Add the ${missing.length} missing`}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || draft.variants.length >= MAX_VARIANTS}
                onClick={() => {
                  const options = missing[0] ?? combinations(axes)[0] ?? {};
                  setVariants([
                    ...draft.variants,
                    newRow(options, skuFor(options), productPrice),
                  ]);
                }}
              >
                <Icon name="plus" size={15} />
                Add one
              </Button>

              {draft.variants.length > 0 && (
                <p className="ml-auto self-center text-micro text-muted">
                  Total stock:{" "}
                  <span className="tnum font-medium text-ink">
                    {draft.variants.reduce(
                      (sum, variant) => sum + (Number(variant.stock) || 0),
                      0,
                    )}
                  </span>
                </p>
              )}
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            onChange(EMPTY_VARIANT_DRAFT);
            setOpen(false);
          }}
          disabled={disabled}
          className="self-start text-micro font-medium text-muted underline underline-offset-2 hover:text-ink"
        >
          This product has no variants
        </button>
      </div>
    </Card>
  );
}
