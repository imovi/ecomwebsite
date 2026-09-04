"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import type { ApiProductImage } from "@/lib/api/types";
import { Card, CardHeader, ErrorBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * Product photos.
 *
 * The API does the optimisation — it re-encodes and resizes on upload — so this
 * component only has to get the bytes there. Files are sent as one multipart
 * request rather than one per file, because on a mobile connection the request
 * overhead dominates and a partial batch is harder to reason about than a
 * failed one.
 *
 * Ordering is by explicit sort order with a move-left/right control instead of
 * drag and drop: this panel is used on a phone, and dragging a 90px thumbnail
 * with a thumb is worse than tapping an arrow.
 */
export function ProductImages({
  productId,
  images,
  onChange,
}: {
  productId: string;
  images: ApiProductImage[];
  onChange: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);

    const form = new FormData();
    for (const file of Array.from(files)) form.append("images", file);

    try {
      await adminApi.upload(`admin/products/${productId}/images`, form);
      toast(files.length === 1 ? "Photo uploaded" : `${files.length} photos uploaded`);
      onChange();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
      /* Clear the input so re-selecting the same file fires `change` again. */
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function run(id: string, action: () => Promise<unknown>, successMessage: string) {
    setBusy(id);
    setError(null);
    try {
      await action();
      toast(successMessage);
      onChange();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not update photos.");
    } finally {
      setBusy(null);
    }
  }

  /** Swaps two images' sort orders and sends the whole list back. */
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const reordered = [...images];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);

    void run(
      moved.id,
      () =>
        adminApi.patch(`admin/products/${productId}/images/reorder`, {
          order: reordered.map((image, position) => ({ id: image.id, sortOrder: position })),
        }),
      "Order updated",
    );
  }

  function parseFit(alt: string | null | undefined): {
    fit: "cover" | "contain";
    position: "center" | "top" | "bottom";
  } {
    const isContain = Boolean(alt?.includes("fit:contain"));
    let position: "center" | "top" | "bottom" = "center";
    if (alt?.includes("pos:top")) position = "top";
    else if (alt?.includes("pos:bottom")) position = "bottom";
    return { fit: isContain ? "contain" : "cover", position };
  }

  function serializeFit(
    fit: "cover" | "contain",
    position: "center" | "top" | "bottom",
    baseAlt?: string | null,
  ): string {
    const clean = (baseAlt || "")
      .replace(/fit:(cover|contain)/g, "")
      .replace(/pos:(center|top|bottom)/g, "")
      .replace(/\[\s*\]/g, "")
      .trim();
    const tags = `fit:${fit};pos:${position}`;
    return clean ? `${clean} [${tags}]` : tags;
  }

  async function toggleFit(image: ApiProductImage) {
    const parsed = parseFit(image.alt);
    const nextFit = parsed.fit === "cover" ? "contain" : "cover";
    const nextAlt = serializeFit(nextFit, parsed.position, image.alt);
    await run(
      image.id,
      () => adminApi.patch(`admin/products/${productId}/images/${image.id}`, { alt: nextAlt }),
      `Switched to ${nextFit === "contain" ? "Manual Fit (Full)" : "Smart Crop (1:1)"}`,
    );
  }

  async function cyclePosition(image: ApiProductImage) {
    const parsed = parseFit(image.alt);
    const nextPos =
      parsed.position === "center" ? "top" : parsed.position === "top" ? "bottom" : "center";
    const nextAlt = serializeFit(parsed.fit, nextPos, image.alt);
    await run(
      image.id,
      () => adminApi.patch(`admin/products/${productId}/images/${image.id}`, { alt: nextAlt }),
      `Crop focus set to ${nextPos}`,
    );
  }

  return (
    <Card>
      <CardHeader
        title="Photos & Videos"
        hint="First item is shown in listings and ads. Toggle between Smart Crop (1:1) and Manual Fit (Full) per media."
      />

      <div className="flex flex-col gap-4 p-4">
        <ErrorBanner message={error} />

        {images.length === 0 ? (
          <p className="rounded-sm bg-surface px-3 py-6 text-center text-caption text-muted">
            No photos or videos yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((image, index) => {
              const isVideo = /\.(mp4|webm|mov|ogg)($|\?)/i.test(image.url);
              const parsed = parseFit(image.alt);
              const fitClass =
                parsed.fit === "contain"
                  ? "object-contain bg-neutral-950"
                  : parsed.position === "top"
                    ? "object-cover object-top"
                    : parsed.position === "bottom"
                      ? "object-cover object-bottom"
                      : "object-cover object-center";

              return (
                <li key={image.id} className="flex flex-col gap-1.5">
                  <div className="relative aspect-square overflow-hidden rounded-sm border border-line bg-surface">
                    {isVideo ? (
                      <div className="relative size-full bg-neutral-900">
                        <video
                          src={image.url}
                          muted
                          loop
                          playsInline
                          className={cn("size-full", fitClass)}
                        />
                        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-xs bg-black/75 px-1.5 py-0.5 text-micro font-medium text-white backdrop-blur-xs">
                          <svg className="size-2.5 fill-current" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          Video
                        </span>
                      </div>
                    ) : (
                      <Image
                        src={image.url}
                        alt={image.alt ?? ""}
                        fill
                        sizes="(min-width: 640px) 25vw, 50vw"
                        className={cn(fitClass)}
                      />
                    )}
                    {image.isFeatured && (
                      <span className="absolute left-1.5 top-1.5 rounded-xs bg-ink px-1.5 py-0.5 text-micro font-semibold text-white">
                        Main
                      </span>
                    )}
                    {busy === image.id && (
                      <span className="absolute inset-0 grid place-items-center bg-white/60">
                        <Icon name="spinner" size={20} className="animate-spin text-ink" />
                      </span>
                    )}
                  </div>

                  {/* Fit Mode Switcher */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleFit(image)}
                      title={
                        parsed.fit === "cover"
                          ? "Currently: Smart Crop (1:1). Click for Manual Fit (Full without crop)"
                          : "Currently: Manual Fit (Full). Click for Smart Crop (1:1)"
                      }
                      className={cn(
                        "flex h-6 flex-1 items-center justify-center gap-1 rounded-xs border text-micro font-medium transition-colors",
                        parsed.fit === "contain"
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : "border-line bg-surface text-ink-soft hover:bg-line/40",
                      )}
                    >
                      {parsed.fit === "contain" ? "🖼️ Full" : "🔲 Crop"}
                    </button>
                    {parsed.fit === "cover" && (
                      <button
                        type="button"
                        onClick={() => void cyclePosition(image)}
                        title="Crop focal position: Center -> Top -> Bottom"
                        className="flex h-6 items-center justify-center rounded-xs border border-line bg-surface px-1.5 text-micro font-medium text-ink-soft hover:bg-line/40 transition-colors"
                      >
                        {parsed.position === "top" ? "⬆ Top" : parsed.position === "bottom" ? "⬇ Btm" : "⏺ Mid"}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move photo earlier"
                      className="flex size-7 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === images.length - 1}
                      aria-label="Move photo later"
                      className="flex size-7 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                    >
                      →
                    </button>

                  {!image.isFeatured && (
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          image.id,
                          () =>
                            adminApi.patch(
                              `admin/products/${productId}/images/${image.id}/featured`,
                              {},
                            ),
                          "Main photo updated",
                        )
                      }
                      className="ml-auto rounded-xs px-1.5 py-1 text-micro font-medium text-ink-soft hover:bg-surface"
                    >
                      Set main
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm("Delete this photo? This cannot be undone.")) return;
                      void run(
                        image.id,
                        () =>
                          adminApi.delete(`admin/products/${productId}/images/${image.id}`),
                        "Photo deleted",
                      );
                    }}
                    aria-label="Delete photo"
                    className="ml-auto flex size-7 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            );
          })}
          </ul>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          onChange={(event) => void handleFiles(event.target.files)}
          className="hidden"
        />

        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
          className="self-start"
        >
          {!uploading && <Icon name="plus" size={16} />}
          {uploading ? "Uploading…" : "Add photos or videos"}
        </Button>
      </div>
    </Card>
  );
}
