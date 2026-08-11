"use client";

import { useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { cn, formatTaka } from "@/lib/utils";
import Image from "next/image";
import type { ApiProduct, ApiProductImage, ApiProductVariant } from "@/lib/api/types";
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

        {/* Keyed on the saved axes, so the editor reseeds from the server
            whenever they actually change.
            Its draft is seeded from props once and never re-syncs — which is
            right while somebody is typing, and wrong the moment a save lands
            or another admin edits the same product: the box would keep showing
            what was typed here rather than what is stored. The key changes only
            when the stored value does, so an in-progress edit is never
            interrupted by an unrelated refetch. */}
        <AxisEditor
          key={JSON.stringify(axes)}
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
                    images={product.images}
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

/* Rows need an identity that survives reordering. Keying by index would let a
   removal shift every later row onto a different key, carrying focus, cursor
   position and in-progress IME composition into the wrong input. */
/** One declared axis, as the API takes it. */
type AxisDraft = { name: string; values: string[]; display?: "text" | "image" };

let axisRowSeq = 0;
const nextAxisRowId = () => `axis-${(axisRowSeq += 1)}`;

function AxisEditor({
  axes,
  busy,
  onSave,
}: {
  axes: AxisDraft[];
  busy: boolean;
  onSave: (axes: AxisDraft[]) => Promise<boolean>;
}) {
  /* Edited as text — "Black, Blue, Titanium" — because that is how someone
     types a list, and parsing it is trivial compared with a chip editor. */
  const [draft, setDraft] = useState(() =>
    axes.map((axis) => ({
      id: nextAxisRowId(),
      name: axis.name,
      values: axis.values.join(", "),
      /* Absent means text, which is what every product saved before swatches
         existed will have. */
      display: axis.display ?? ("text" as const),
    })),
  );
  const [dirty, setDirty] = useState(false);

  const update = (
    id: string,
    patch: Partial<{ name: string; values: string; display: "text" | "image" }>,
  ) => {
    setDraft((current) => current.map((axis) => (axis.id === id ? { ...axis, ...patch } : axis)));
    setDirty(true);
  };

  return (
    <div className="flex flex-col gap-2 rounded-sm bg-surface p-3">
      <p className="text-caption font-medium text-ink-soft">Option types</p>

      {draft.map((axis, index) => (
        <div key={axis.id} className="flex items-center gap-2">
          <input
            value={axis.name}
            onChange={(event) => update(axis.id, { name: event.target.value })}
            placeholder="Colour"
            aria-label={`Option ${index + 1} name`}
            className="h-10 w-1/3 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          <input
            value={axis.values}
            onChange={(event) => update(axis.id, { values: event.target.value })}
            placeholder="Black, Blue, Titanium"
            aria-label={`Option ${index + 1} values`}
            className="h-10 flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          {/* Text or picture, per axis. Colour wants swatches — "Midnight
              Green" means nothing until you see it — while Storage does not,
              because there is no photograph of 256GB. */}
          <select
            value={axis.display}
            onChange={(event) =>
              update(axis.id, { display: event.target.value as "text" | "image" })
            }
            aria-label={`Option ${index + 1} shown as`}
            className="h-10 w-28 shrink-0 rounded-sm border border-line bg-white px-2 text-caption text-ink outline-none focus:border-ink"
          >
            <option value="text">Text</option>
            <option value="image">Picture</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setDraft((current) => current.filter((row) => row.id !== axis.id));
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
            setDraft((current) => [
              ...current,
              { id: nextAxisRowId(), name: "", values: "", display: "text" as const },
            ]);
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
                  display: axis.display,
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
  images,
  busy,
  onRun,
}: {
  productId: string;
  variant: ApiProductVariant;
  images: ApiProductImage[];
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

      {/* The picture that stands for this variant.
          Two jobs: it swaps the gallery when a shopper picks this variant, and
          — when its axis is set to "Picture" — it IS the swatch they tap. Only
          offered once photographs exist, because there is nothing to choose
          from before that. */}
      {images.length > 0 && (
        <div className="flex w-full items-center gap-1.5 pl-0.5">
          <span className="text-micro text-muted">Picture</span>
          {images.map((image) => {
            const chosen = variant.imageUrl === image.url;
            return (
              <button
                key={image.id}
                type="button"
                disabled={busy}
                aria-label={chosen ? `Remove picture from ${label}` : `Use this picture for ${label}`}
                aria-pressed={chosen}
                title={chosen ? "Tap again to clear" : "Use for this variant"}
                onClick={() =>
                  void onRun(
                    () =>
                      adminApi.patch(`admin/products/${productId}/variants/${variant.id}`, {
                        /* Tapping the chosen one clears it — otherwise a
                           swatch set by mistake could never be removed. */
                        imageId: chosen ? null : image.id,
                      }),
                    chosen ? "Picture removed" : "Picture set",
                  )
                }
                className={cn(
                  "relative size-9 shrink-0 overflow-hidden rounded-sm border-2",
                  chosen ? "border-ink" : "border-line",
                )}
              >
                <Image
                  src={image.url}
                  alt=""
                  fill
                  sizes="64px"
                  className={cn("object-cover", !chosen && "opacity-60 hover:opacity-100")}
                />
                {/* A visible mark on the chosen one, not only a hover tooltip.
                    "Tap again to clear" was discoverable by hovering and
                    waiting — which a touch screen never does, and a keyboard
                    user never sees. The tick says which one is set; the label
                    already told a screen reader it can be removed. */}
                {chosen && (
                  <span className="absolute inset-x-0 bottom-0 bg-ink/85 text-center text-[9px] font-medium leading-3 text-white">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

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
