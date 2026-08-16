"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import type { ApiProduct, ApiProductImage } from "@/lib/api/types";
import { Card, CardHeader, ErrorBanner } from "./ui";
import { Icon } from "@/components/ui/Icon";

/**
 * The off switch, and the photos behind it.
 *
 * Every product photo in this shop is a photo of the thing working — the lamp
 * lit. This panel is where the shop uploads the other half of each shot, the
 * same frame with the lamp off, so the product page can offer a toggle between
 * them.
 *
 * DELIBERATELY A SEPARATE PANEL, NOT PART OF "Photos"
 * --------------------------------------------------
 * The gallery panel above owns what the product looks like. This owns an
 * optional extra that most products will never use. Keeping them apart means
 * the gallery is unchanged for the shop's other products, and removing this
 * feature is removing one file rather than untangling two.
 *
 * The mapping is not something anyone has to set. Each row IS a gallery photo,
 * in gallery order, and the upload attaches to that photo's id — so reordering
 * or deleting a photo can never leave an unlit picture attached to the wrong
 * frame.
 */

/** The one state the storefront reads today. Others are rows, not code. */
const OFF_STATE = { key: "off", label: "Off" } as const;

export function ProductInteractive({
  product,
  onChange,
}: {
  product: ApiProduct;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, action: () => Promise<unknown>, message: string) {
    setBusy(id);
    setError(null);
    try {
      await action();
      toast(message);
      onChange();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not update.");
    } finally {
      setBusy(null);
    }
  }

  const withOff = product.images.filter((image) =>
    image.states.some((state) => state.key === OFF_STATE.key),
  ).length;

  return (
    <Card>
      <CardHeader
        title="Light on / off"
        hint="Upload the same photo with the light off. Shoppers get a switch on the product page."
      />

      <div className="flex flex-col gap-4 p-4">
        <ErrorBanner message={error} />

        <label className="flex items-start gap-2.5 text-caption text-ink">
          <input
            type="checkbox"
            checked={product.interactiveEnabled}
            disabled={busy === "flag"}
            onChange={(event) =>
              void run(
                "flag",
                () =>
                  adminApi.patch(`admin/products/${product.id}`, {
                    interactiveEnabled: event.target.checked,
                  }),
                event.target.checked ? "Switch turned on" : "Switch turned off",
              )
            }
            className="mt-0.5 size-4 accent-[var(--color-ink)]"
          />
          <span>
            Show the switch on this product
            <span className="mt-0.5 block text-micro text-muted">
              Off by default. Turning this off later keeps the photos — nothing is deleted.
            </span>
          </span>
        </label>

        {/* Said plainly rather than left to be discovered: the switch appears
            only on frames that have a second photo, so a half-finished upload
            looks like a bug otherwise. */}
        {product.interactiveEnabled && withOff === 0 && (
          <p className="rounded-sm bg-warn-soft px-3 py-2 text-caption text-ink">
            The switch is on, but no photo has an off version yet — so nothing will show on the
            product page. Upload at least one below.
          </p>
        )}

        {product.images.length === 0 ? (
          <p className="rounded-sm bg-surface px-3 py-6 text-center text-caption text-muted">
            Add photos first. Each one can then get an off version.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {product.images.map((image, index) => (
              <ImagePair
                key={image.id}
                productId={product.id}
                image={image}
                position={index + 1}
                busy={busy === image.id}
                onRun={run}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * One gallery photo beside its off version.
 *
 * Shown as a pair, at the same size, because the whole point is that they are
 * the same shot — and a mismatch in framing is obvious side by side and
 * invisible in a list of filenames.
 */
function ImagePair({
  productId,
  image,
  position,
  busy,
  onRun,
}: {
  productId: string;
  image: ApiProductImage;
  position: number;
  busy: boolean;
  onRun: (id: string, action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const off = image.states.find((state) => state.key === OFF_STATE.key);

  /* Same shot, different exposure — so the frames should match. Compared as a
     ratio rather than exact pixels: the two photos may be different
     resolutions and still crop identically, which is fine. */
  const ratioOf = (w: number, h: number) => (h === 0 ? 0 : w / h);
  const mismatched =
    off !== undefined &&
    Math.abs(ratioOf(image.width, image.height) - ratioOf(off.width, off.height)) > 0.02;

  function handleFile(files: FileList | null): void {
    const file = files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append("image", file);
    form.append("stateKey", OFF_STATE.key);
    form.append("label", OFF_STATE.label);

    void onRun(
      image.id,
      () => adminApi.upload(`admin/products/${productId}/images/${image.id}/states`, form),
      off ? "Off photo replaced" : "Off photo added",
    ).finally(() => {
      /* Clear it so choosing the same file again still fires `change`. */
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <li className="flex items-start gap-3 rounded-sm border border-line p-3">
      <Frame url={image.url} alt={image.alt ?? ""} caption={`Photo ${position}`} lit />

      <div className="flex shrink-0 items-center self-center text-muted">
        <Icon name="arrowRight" size={16} />
      </div>

      {off ? (
        <Frame url={off.url} alt="" caption="Off" />
      ) : (
        <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-sm border border-dashed border-line text-micro text-muted">
          No off photo
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {mismatched && (
          <p className="text-micro text-warn">
            The two photos are not the same shape, so the switch will look like a jump rather
            than a light going on. Use the same framing for both.
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={(event) => handleFile(event.target.files)}
          className="hidden"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-xs border border-line px-2 py-1 text-micro font-medium text-ink-soft hover:bg-surface disabled:opacity-40"
          >
            {busy ? "Working…" : off ? "Replace off photo" : "Add off photo"}
          </button>

          {off && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Remove the off photo for this frame?")) return;
                void onRun(
                  image.id,
                  () =>
                    adminApi.delete(
                      `admin/products/${productId}/images/${image.id}/states/${OFF_STATE.key}`,
                    ),
                  "Off photo removed",
                );
              }}
              aria-label="Remove off photo"
              className="flex size-7 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale disabled:opacity-40"
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>

        <p className="text-micro text-muted">
          Any format — the shop resizes and compresses it for you.
        </p>
      </div>
    </li>
  );
}

function Frame({
  url,
  alt,
  caption,
  lit = false,
}: {
  url: string;
  alt: string;
  caption: string;
  lit?: boolean;
}) {
  return (
    <div className="shrink-0">
      <div className="relative size-20 overflow-hidden rounded-sm border border-line bg-surface">
        <Image src={url} alt={alt} fill sizes="80px" className="object-cover" />
      </div>
      <p className="mt-1 text-center text-micro text-muted">
        {caption}
        {lit ? " · on" : ""}
      </p>
    </div>
  );
}
