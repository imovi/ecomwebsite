"use client";

import { useMemo } from "react";
import { parseVideoUrl } from "@/lib/video-embed";
import { Icon } from "@/components/ui/Icon";

interface ProductVideoShowcaseProps {
  videoUrl: string | null | undefined;
  productTitle: string;
}

export function ProductVideoShowcase({
  videoUrl,
  productTitle,
}: ProductVideoShowcaseProps) {
  const video = useMemo(() => parseVideoUrl(videoUrl), [videoUrl]);

  if (!video) return null;

  return (
    <section
      id="product-video-showcase"
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-line bg-surface/50 p-4 sm:p-6 md:p-8"
      aria-label="Product video overview"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg
              className="size-5 translate-x-0.5 fill-current"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-title text-ink font-semibold">
                {video.isVertical ? "Product Reel / Short" : "Product Video"}
              </h3>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {video.platformName}
              </span>
            </div>
            <p className="text-caption text-muted">
              Watch real overview and demonstration of {productTitle}
            </p>
          </div>
        </div>

        {video.originalUrl && (
          <a
            href={video.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-caption font-medium text-ink hover:text-primary transition-colors underline underline-offset-4"
          >
            <span>Open in {video.platformName}</span>
            <svg
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}
      </div>

      {/* Video Container */}
      <div className="flex justify-center">
        {video.type === "direct" ? (
          <div className="relative w-full max-w-2xl overflow-hidden rounded-xl bg-black shadow-lg">
            <video
              src={video.embedUrl}
              controls
              playsInline
              preload="metadata"
              className="h-full max-h-[560px] w-full object-contain"
            />
          </div>
        ) : video.isVertical ? (
          /* Phone / Reel vertical frame */
          <div className="relative w-full max-w-[360px] overflow-hidden rounded-2xl bg-black shadow-2xl border-4 border-ink/10 aspect-[9/16]">
            <iframe
              src={video.embedUrl}
              title={`${productTitle} Video Reel`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
              loading="lazy"
            />
          </div>
        ) : (
          /* Landscape 16:9 standard video frame */
          <div className="relative w-full max-w-3xl overflow-hidden rounded-xl bg-black shadow-lg aspect-video">
            <iframe
              src={video.embedUrl}
              title={`${productTitle} Video`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </section>
  );
}
