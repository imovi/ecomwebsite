"use client";

import { useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import type { ApiProduct, ApiProductVariant } from "@/lib/api/types";
import { Card, CardHeader, ErrorBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * Variants.
 *
 * Two steps, in a fixed order the API enforces: declare the option axes
 * ("Colour", "Storage") on the product, then add a variant per combination.
 * That ordering exists so a variant's option keys can be validated against the
 * declared axes instead of accumulating typos like "colour" and "Color" as
 * separate dimensions.
 *
 * Optional throughout. A single-SKU product — a power bank, a cable — needs
 * none of this, and its stock lives on the product itself.
 */
export function ProductVariants({
  product,
  onChange,
}: {
  product: ApiProduct;
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);

  const axes = product.variantOptions;

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(successMessage);
      onChange();
      return true;
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Variants"
        hint="Only needed when the same product sells in several versions — colours, storage sizes."
      />

      <div className="flex flex-col gap-4 p-4">
        <ErrorBanner message={error} />

        <AxisEditor
          axes={axes}
          busy={busy}
          onSave={(variantOptions) =>
            run(
              () => adminApi.patch(`admin/products/${product.id}`, { variantOptions }),
              "Options saved",
            )
          }
        />

        {axes.length > 0 && (
          <>
            {product.variants.length > 0 && (
              <ul className="flex flex-col divide-y divide-line">
                {product.variants.map((variant) => (
                  <VariantRow
                    key={variant.id}
                    productId={product.id}
                    variant={variant}
                    busy={busy}
                    onRun={run}
                  />
                ))}
              </ul>
            )}

            {showAdd ? (
              <VariantCreate
                axes={axes}
                busy={busy}
                onCancel={() => setShowAdd(false)}
                onCreate={async (payload) => {
                  const ok = await run(
                    () => adminApi.post(`admin/products/${product.id}/variants`, payload),
                    "Variant added",
                  );
                  if (ok) setShowAdd(false);
                }}
              />
            ) : (
              <Button
                type="button"
                variant="soft"
                size="sm"
                onClick={() => setShowAdd(true)}
                className="self-start"
              >
                <Icon name="plus" size={15} />
                Add variant
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Option axes                                                                */
/* -------------------------------------------------------------------------- */

function AxisEditor({
  axes,
  busy,
  onSave,
}: {
  axes: { name: string; values: string[] }[];
  busy: boolean;
  onSave: (axes: { name: string; values: string[] }[]) => Promise<boolean>;
}) {
  /* Edited as text — "Black, Blue, Titanium" — because that is how someone
     types a list, and parsing it is trivial compared with a chip editor. */
  const [draft, setDraft] = useState(
    axes.map((axis) => ({ name: axis.name, values: axis.values.join(", ") })),
  );
  const [dirty, setDirty] = useState(false);

  const update = (index: number, patch: Partial<{ name: string; values: string }>) => {
    setDraft((current) => current.map((axis, i) => (i === index ? { ...axis, ...patch } : axis)));
    setDirty(true);
  };

  return (
    <div className="flex flex-col gap-2 rounded-sm bg-surface p-3">
      <p className="text-caption font-medium text-ink-soft">Option types</p>

      {draft.map((axis, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            value={axis.name}
            onChange={(event) => update(index, { name: event.target.value })}
            placeholder="Colour"
            aria-label={`Option ${index + 1} name`}
            className="h-10 w-1/3 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          <input
            value={axis.values}
            onChange={(event) => update(index, { values: event.target.value })}
            placeholder="Black, Blue, Titanium"
            aria-label={`Option ${index + 1} values`}
            className="h-10 flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={() => {
              setDraft((current) => current.filter((_, i) => i !== index));
              setDirty(true);
            }}
            aria-label={`Remove option ${index + 1}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-sale-soft hover:text-sale"
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={draft.length >= 4}
          onClick={() => {
            setDraft((current) => [...current, { name: "", values: "" }]);
            setDirty(true);
          }}
        >
          <Icon name="plus" size={15} />
          Add option type
        </Button>

        {dirty && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={async () => {
              const parsed = draft
                .map((axis) => ({
                  name: axis.name.trim(),
                  values: axis.values
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                }))
                .filter((axis) => axis.name !== "" && axis.values.length > 0);

              if (await onSave(parsed)) setDirty(false);
            }}
          >
            Save options
          </Button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

function VariantRow({
  productId,
  variant,
  busy,
  onRun,
}: {
  productId: string;
  variant: ApiProductVariant;
  busy: boolean;
  onRun: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const [price, setPrice] = useState(String(variant.price));
  const [stock, setStock] = useState(String(variant.stockQuantity));

  const changed = price !== String(variant.price) || stock !== String(variant.stockQuantity);
  const label = Object.values(variant.options).join(" / ");

  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption font-medium text-ink">{label || variant.sku}</p>
        <p className="truncate text-micro text-muted">
          {variant.sku}
          {!variant.isActive && " · inactive"}
          {variant.oldPrice !== null && ` · was ${formatTaka(variant.oldPrice)}`}
        </p>
      </div>

      <label className="flex items-center gap-1 text-micro text-muted">
        ৳
        <input
          type="number"
          min={0}
          step={1}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          aria-label={`Price for ${label || variant.sku}`}
          className="tnum h-9 w-24 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
        />
      </label>

      <label className="flex items-center gap-1 text-micro text-muted">
        Qty
        <input
          type="number"
          min={0}
          step={1}
          value={stock}
          onChange={(event) => setStock(event.target.value)}
          aria-label={`Stock for ${label || variant.sku}`}
          className="tnum h-9 w-20 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
        />
      </label>

      {changed && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() =>
            void onRun(
              () =>
                adminApi.patch(`admin/products/${productId}/variants/${variant.id}`, {
                  price: Number(price),
                  stockQuantity: Number(stock),
                }),
              "Variant updated",
            )
          }
        >
          Save
        </Button>
      )}

      <button
        type="button"
        onClick={() => {
          if (!window.confirm(`Delete variant ${label || variant.sku}?`)) return;
          void onRun(
            () => adminApi.delete(`admin/products/${productId}/variants/${variant.id}`),
            "Variant deleted",
          );
        }}
        aria-label={`Delete variant ${label || variant.sku}`}
        className="flex size-9 items-center justify-center rounded-sm text-muted hover:bg-sale-soft hover:text-sale"
      >
        <Icon name="trash" size={16} />
      </button>
    </li>
  );
}

function VariantCreate({
  axes,
  busy,
  onCancel,
  onCreate,
}: {
  axes: { name: string; values: string[] }[];
  busy: boolean;
  onCancel: () => void;
  onCreate: (payload: {
    sku: string;
    options: Record<string, string>;
    price: number;
    stockQuantity: number;
  }) => Promise<void>;
}) {
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(axes.map((axis) => [axis.name, axis.values[0] ?? ""])),
  );

  const complete = sku.trim() !== "" && price !== "" && axes.every((axis) => options[axis.name]);

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line p-3">
      <p className="text-caption font-medium text-ink-soft">New variant</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {axes.map((axis) => (
          <label key={axis.name} className="flex flex-col gap-1 text-micro text-muted">
            {axis.name}
            <select
              value={options[axis.name] ?? ""}
              onChange={(event) =>
                setOptions((current) => ({ ...current, [axis.name]: event.target.value }))
              }
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

        <label className="flex flex-col gap-1 text-micro text-muted">
          SKU
          <input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder="SAM-S24U-256"
            className="h-10 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-micro text-muted">
          Price (৳)
          <input
            type="number"
            min={0}
            step={1}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            className="tnum h-10 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
          />
        </label>

        <label className="flex flex-col gap-1 text-micro text-muted">
          Stock
          <input
            type="number"
            min={0}
            step={1}
            value={stock}
            onChange={(event) => setStock(event.target.value)}
            className="tnum h-10 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!complete}
          onClick={() =>
            void onCreate({
              sku: sku.trim(),
              options,
              price: Number(price),
              stockQuantity: Number(stock),
            })
          }
        >
          Add variant
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
