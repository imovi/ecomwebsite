"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "./ui";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * Photo picker for a product that does not exist yet.
 *
 * Images attach to a product row, so during creation there is nothing to upload
 * to. Rather than make the admin save first and hunt for a second screen, files
 * are held in memory here and uploaded the instant the product row is created.
 *
 * Previews come from `URL.createObjectURL`, which means the browser renders the
 * local file with no round trip — the admin sees exactly what they picked before
 * committing anything. Those URLs pin the file in memory until revoked, which is
 * why the effect below cleans them up.
 */

export interface StagedImage {
  /** Stable key so React does not remount a row when the list is reordered. */
  id: string;
  file: File;
  previewUrl: string;
}

/** Matches what the API's upload middleware will accept. */
const ACCEPTED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 12;

export function createStagedImages(
  files: FileList | File[],
  existingCount: number,
): { staged: StagedImage[]; rejected: string[] } {
  const staged: StagedImage[] = [];
  const rejected: string[] = [];
  let budget = MAX_FILES - existingCount;

  for (const file of Array.from(files)) {
    if (budget <= 0) {
      rejected.push(`${file.name} — over the ${MAX_FILES} photo/video limit`);
      continue;
    }
    /* Checked here as well as server-side. The point is not security — the API
       re-validates and re-encodes every byte — it is telling the admin now
       instead of after a slow upload on a phone connection. */
    if (!ACCEPTED.includes(file.type) && !/\.(mp4|webm|mov)$/i.test(file.name)) {
      rejected.push(`${file.name} — must be JPG, PNG, WebP or MP4/WebM video`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      rejected.push(`${file.name} — larger than 50 MB`);
      continue;
    }

    staged.push({
      id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file),
    });
    budget -= 1;
  }

  return { staged, rejected };
}

export function ProductImageStaging({
  images,
  onChange,
  disabled,
}: {
  images: StagedImage[];
  onChange: (images: StagedImage[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  /* Revoke object URLs for images that are no longer staged. Without this the
     browser holds every file the admin ever previewed for the life of the page,
     which on a phone with ten 4 MB photos is a real amount of memory. */
  const liveUrls = useRef(new Set<string>());
  useEffect(() => {
    for (const image of images) liveUrls.current.add(image.previewUrl);
    const current = new Set(images.map((image) => image.previewUrl));
    for (const url of liveUrls.current) {
      if (!current.has(url)) {
        URL.revokeObjectURL(url);
        liveUrls.current.delete(url);
      }
    }
  }, [images]);

  useEffect(() => {
    /* Unmount: release whatever is left. Captured in a local so the cleanup does
       not read a ref that React may have already reset. */
    const urls = liveUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    const { staged, rejected: bad } = createStagedImages(files, images.length);
    if (staged.length > 0) onChange([...images, ...staged]);
    setRejected(bad);
    /* Clear the input so picking the same file again still fires `change`. */
    if (inputRef.current) inputRef.current.value = "";
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <Card>
      <CardHeader
        title="Photos & Videos"
        hint="Pick them now — they upload as soon as the product is created. The first one is used in listings and ads. Videos auto-crop to square frame."
      />

      <div className="flex flex-col gap-4 p-4">
        {rejected.length > 0 && (
          <ul className="flex flex-col gap-0.5 rounded-sm bg-warn-soft px-3 py-2">
            {rejected.map((message) => (
              <li key={message} className="text-caption text-warn">
                {message}
              </li>
            ))}
          </ul>
        )}

        {images.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="flex flex-col items-center gap-2 rounded-sm border border-dashed border-line bg-surface px-4 py-8 text-center transition-colors hover:border-ink/30 hover:bg-white disabled:opacity-50"
          >
            <Icon name="camera" size={24} className="text-muted" />
            <span className="text-caption font-medium text-ink">Add photos or videos</span>
            <span className="text-micro text-muted">JPG, PNG, WebP or MP4/WebM video · up to 50 MB each</span>
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((image, index) => (
              <li key={image.id} className="flex flex-col gap-1.5">
                <div className="relative aspect-square overflow-hidden rounded-sm border border-line bg-surface">
                  {image.file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(image.file.name) ? (
                    <div className="group/vid relative size-full bg-neutral-900">
                      <video
                        src={`${image.previewUrl}#t=0.5`}
                        preload="metadata"
                        muted
                        loop
                        playsInline
                        onLoadedMetadata={(e) => {
                          if (e.currentTarget.currentTime < 0.1) {
                            e.currentTarget.currentTime = 0.5;
                          }
                        }}
                        className="size-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPreviewVideoUrl(image.previewUrl)}
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
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={image.previewUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  )}
                  {index === 0 && (
                    <span className="absolute left-1.5 top-1.5 rounded-xs bg-ink px-1.5 py-0.5 text-micro font-semibold text-white">
                      Main
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || disabled}
                    aria-label={`Move photo ${index + 1} earlier`}
                    className="flex size-7 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === images.length - 1 || disabled}
                    aria-label={`Move photo ${index + 1} later`}
                    className="flex size-7 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(images.filter((_, i) => i !== index))}
                    disabled={disabled}
                    aria-label={`Remove photo ${index + 1}`}
                    className="ml-auto flex size-7 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale disabled:opacity-30"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          multiple
          onChange={(event) => add(event.target.files)}
          className="hidden"
        />

        {images.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={disabled || images.length >= MAX_FILES}
            onClick={() => inputRef.current?.click()}
            className={cn("self-start")}
          >
            <Icon name="plus" size={16} />
            {images.length >= MAX_FILES ? `Limit of ${MAX_FILES} reached` : "Add more"}
          </Button>
        )}
      </div>

      {previewVideoUrl && (
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
                <span className="text-caption font-semibold">Staged Video Preview</span>
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
            <div className="relative flex aspect-video max-h-[70vh] w-full items-center justify-center bg-black">
              <video
                src={previewVideoUrl}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
