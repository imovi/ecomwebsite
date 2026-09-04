"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import type { ApiProductImage } from "@/lib/api/types";
import { Card, CardHeader, ErrorBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { parseVideoUrl, type ParsedVideoInfo } from "@/lib/video-embed";

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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [videoLinkUrl, setVideoLinkUrl] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedMap, setResolvedMap] = useState<Record<string, ParsedVideoInfo>>({});

  useEffect(() => {
    images.forEach((image) => {
      const fullUrl = image.url.split("#")[0] ?? image.url;
      if (resolvedMap[fullUrl]) return;

      const parsed = parseVideoUrl(fullUrl);
      if (parsed && (parsed.type === "instagram" || parsed.type === "tiktok")) {
        fetch(`/api/video/resolve?url=${encodeURIComponent(fullUrl)}`)
          .then((r) => r.json())
          .then((res) => {
            if (res.success && res.data) {
              setResolvedMap((prev) => ({
                ...prev,
                [fullUrl]: res.data,
              }));
            }
          })
          .catch(() => {});
      }
    });
  }, [images, resolvedMap]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    const form = new FormData();
    for (const file of Array.from(files)) form.append("images", file);

    try {
      await adminApi.uploadWithProgress(
        `admin/products/${productId}/images`,
        form,
        (percent) => setUploadProgress(percent),
      );
      toast(files.length === 1 ? "Media uploaded" : `${files.length} media uploaded`);
      onChange();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress(null);
      /* Clear the input so re-selecting the same file fires `change` again. */
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleAddVideoLink(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = videoLinkUrl.trim();
    if (!trimmed) return;

    const parsed = parseVideoUrl(trimmed);
    if (!parsed) {
      setError("Please enter a valid video link (Facebook Reel, TikTok, Instagram, YouTube, or direct MP4 URL).");
      return;
    }

    setAddingLink(true);
    setError(null);
    try {
      await adminApi.post(`admin/products/${productId}/images/link`, {
        url: trimmed,
        alt: `${parsed.platformName} Video`,
      });
      toast("Video link added successfully");
      setVideoLinkUrl("");
      setShowLinkModal(false);
      onChange();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Failed to add video link.");
    } finally {
      setAddingLink(false);
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

        {uploading && (
          <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-3">
            <div className="flex items-center justify-between text-caption">
              <span className="font-medium text-ink flex items-center gap-2">
                <Icon name="spinner" size={15} className="animate-spin text-ink" />
                {uploadProgress !== null && uploadProgress >= 100
                  ? "Processing media on server…"
                  : `Uploading media… ${uploadProgress ?? 0}%`}
              </span>
              <span className="text-micro font-bold text-ink">{uploadProgress ?? 0}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-line/60">
              <div
                className="h-full bg-ink transition-all duration-150 rounded-full"
                style={{ width: `${Math.max(5, uploadProgress ?? 0)}%` }}
              />
            </div>
          </div>
        )}

        {images.length === 0 ? (
          <p className="rounded-sm bg-surface px-3 py-6 text-center text-caption text-muted">
            No photos or videos yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((image, index) => {
              const cleanUrl = (image.url.split("#")[0] ?? image.url).split("?")[0] ?? image.url;
              const fullUrl = image.url.split("#")[0] ?? image.url;
              const initialEmbed = parseVideoUrl(fullUrl);
              const embed = resolvedMap[fullUrl] ?? initialEmbed;
              const isDirectVideo =
                /\.(mp4|webm|mov|ogg)($|\?)/i.test(cleanUrl) || embed?.type === "direct";
              const isSocialVideo =
                embed !== null &&
                embed.type !== "direct" &&
                embed.type !== "unknown";
              const parsed = parseFit(image.alt);
              const fitClass =
                parsed.fit === "contain"
                  ? "object-contain bg-neutral-950"
                  : parsed.position === "top"
                    ? "object-cover object-top"
                    : parsed.position === "bottom"
                      ? "object-cover object-bottom"
                      : "object-cover object-center";

              const videoPlaybackUrl = embed?.embedUrl || image.url;
              const hasPoster = Boolean(embed?.posterUrl);

              return (
                <li key={image.id} className="flex flex-col gap-1.5">
                  <div className="relative aspect-square overflow-hidden rounded-sm border border-line bg-surface">
                    {hasPoster ? (
                      <div className="group/vid relative size-full bg-neutral-950 text-white overflow-hidden">
                        <img
                          src={embed!.posterUrl}
                          alt={image.alt ?? "Video Cover"}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                        <button
                          type="button"
                          onClick={() => setPreviewVideoUrl(videoPlaybackUrl)}
                          title={`Click to preview ${embed!.platformName}`}
                          className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/vid:bg-black/40 transition-colors"
                        >
                          <span className="flex size-9 items-center justify-center rounded-full bg-red-600 text-white shadow-md group-hover/vid:scale-110 transition-transform">
                            <svg className="size-4 fill-current ml-0.5" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </button>
                        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-xs bg-black/80 px-1.5 py-0.5 text-micro font-medium text-white backdrop-blur-xs pointer-events-none">
                          {embed!.platformName}
                        </span>
                      </div>
                    ) : isDirectVideo ? (
                      <div className="group/vid relative size-full bg-neutral-900">
                        <video
                          src={`${image.url.split("#")[0]}#t=0.5`}
                          preload="metadata"
                          muted
                          loop
                          playsInline
                          onLoadedMetadata={(e) => {
                            if (e.currentTarget.currentTime < 0.1) {
                              e.currentTarget.currentTime = 0.5;
                            }
                          }}
                          className={cn("size-full", fitClass)}
                        />
                        {/* Play / Preview button overlay */}
                        <button
                          type="button"
                          onClick={() => setPreviewVideoUrl(videoPlaybackUrl)}
                          title="Click to preview video"
                          className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/vid:bg-black/40 transition-colors"
                        >
                          <span className="flex size-9 items-center justify-center rounded-full bg-black/80 text-white backdrop-blur-xs group-hover/vid:scale-110 group-hover/vid:bg-black transition-transform shadow-md">
                            <svg className="size-4 fill-current ml-0.5" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </button>
                        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-xs bg-black/75 px-1.5 py-0.5 text-micro font-medium text-white backdrop-blur-xs pointer-events-none">
                          <svg className="size-2.5 fill-current" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          Video
                        </span>
                      </div>
                    ) : isSocialVideo ? (
                      <div className="group/vid relative size-full flex flex-col items-center justify-center bg-neutral-950 text-white overflow-hidden">
                        <div
                          className={cn(
                            "absolute inset-0 flex flex-col items-center justify-center p-2 text-center",
                            embed?.type === "facebook"
                              ? "bg-gradient-to-br from-blue-700 to-blue-950"
                              : embed?.type === "instagram"
                                ? "bg-gradient-to-br from-purple-700 via-pink-600 to-amber-600"
                                : embed?.type === "tiktok"
                                  ? "bg-neutral-900"
                                  : "bg-neutral-900",
                          )}
                        >
                          <span className="text-micro font-bold uppercase tracking-wider text-white/90">
                            {embed?.platformName}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewVideoUrl(videoPlaybackUrl)}
                          title={`Click to preview ${embed?.platformName}`}
                          className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/vid:bg-black/50 transition-colors"
                        >
                          <span className="flex size-9 items-center justify-center rounded-full bg-red-600 text-white shadow-md group-hover/vid:scale-110 transition-transform">
                            <svg className="size-4 fill-current ml-0.5" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </button>
                        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-xs bg-black/80 px-1.5 py-0.5 text-micro font-medium text-white backdrop-blur-xs pointer-events-none">
                          {embed?.platformName}
                        </span>
                      </div>
                    ) : (
                      <Image
                        src={cleanUrl}
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {!uploading && <Icon name="plus" size={16} />}
            {uploading
              ? uploadProgress !== null && uploadProgress >= 100
                ? "Processing…"
                : `Uploading (${uploadProgress ?? 0}%)…`
              : "Add photos or videos"}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setShowLinkModal(true)}
          >
            <svg className="size-4 text-ink-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Add Video Link
          </Button>
        </div>
      </div>

      {/* Video Link Modal */}
      {showLinkModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLinkModal(false);
          }}
        >
          <div className="relative w-full max-w-lg rounded-xl border border-line bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-neutral-900">
            <div className="flex items-center justify-between border-b border-line pb-3 dark:border-white/10">
              <h3 className="font-heading text-base font-semibold text-ink flex items-center gap-2 dark:text-white">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-primary">
                  <svg className="size-3.5 fill-current ml-0.5" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                Add Video Link
              </h3>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-line/40 hover:text-ink transition-colors"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleAddVideoLink(e)} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="block text-caption font-medium text-ink dark:text-neutral-200">
                  Video Link (Facebook Reel, TikTok, Instagram Reel, YouTube Shorts, or MP4)
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://www.facebook.com/reel/... or TikTok / Instagram / YouTube"
                  value={videoLinkUrl}
                  onChange={(e) => setVideoLinkUrl(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-white"
                />
                <div className="mt-2 flex flex-wrap gap-1 text-micro text-muted">
                  <span className="rounded-xs bg-line/60 px-1.5 py-0.5 font-medium">Facebook Reel</span>
                  <span className="rounded-xs bg-line/60 px-1.5 py-0.5 font-medium">TikTok</span>
                  <span className="rounded-xs bg-line/60 px-1.5 py-0.5 font-medium">Instagram</span>
                  <span className="rounded-xs bg-line/60 px-1.5 py-0.5 font-medium">YouTube</span>
                  <span className="rounded-xs bg-line/60 px-1.5 py-0.5 font-medium">Direct MP4</span>
                </div>
                <p className="mt-2 text-micro text-emerald-600 dark:text-emerald-400 font-medium">
                  ⚡ Loads in under 1 second directly from global CDN networks without eating VPS disk or bandwidth.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLinkModal(false)}
                  disabled={addingLink}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={addingLink}
                >
                  Add to Media
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Video Preview Modal */}
      {previewVideoUrl && (() => {
        const previewEmbed = resolvedMap[previewVideoUrl] ?? parseVideoUrl(previewVideoUrl);
        const isDirect =
          previewVideoUrl.includes(".mp4") ||
          previewEmbed?.type === "direct" ||
          /\.(mp4|webm|mov|ogg)($|\?)/i.test(previewVideoUrl);
        const isSocial = !isDirect && previewEmbed !== null && previewEmbed.type !== "unknown";

        return (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewVideoUrl(null);
            }}
          >
            <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-neutral-950 shadow-2xl border border-white/10">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-primary">
                    <svg className="size-3 fill-current ml-0.5" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                  <span className="text-caption font-semibold">
                    {isSocial ? `${previewEmbed.platformName} Preview` : "Video Preview"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewVideoUrl(null)}
                  className="flex size-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
                  aria-label="Close preview"
                >
                  ✕
                </button>
              </div>
              <div
                className={cn(
                  "relative flex items-center justify-center bg-black",
                  previewEmbed?.isVertical
                    ? "h-[75vh] max-w-sm mx-auto aspect-[9/16]"
                    : "aspect-video max-h-[70vh] w-full",
                )}
              >
                {isSocial ? (
                  <iframe
                    src={previewEmbed.embedUrl}
                    title="Video Preview"
                    className="size-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video
                    src={previewVideoUrl}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-full max-w-full"
                  />
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </Card>
  );
}
