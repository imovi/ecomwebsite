"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

/**
 * Swipeable product gallery.
 *
 * Built on native CSS scroll-snap rather than a carousel library: it gets
 * real momentum scrolling on iOS, works before hydration, costs zero KB of
 * JavaScript for the scrolling itself, and degrades to a plain scroller if JS
 * fails. The only JS here is index tracking and the variant-change jump.
 */

interface GalleryProps {
  images: string[];
  title: string;
  /** When the selected variant changes, jump to its image. */
  activeIndex?: number;
}

export function Gallery({ images, title, activeIndex }: GalleryProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Prevents the scroll handler from fighting a programmatic scroll.
  const jumpingRef = useRef(false);

  const scrollToIndex = useCallback((i: number, smooth = true) => {
    const rail = railRef.current;
    if (!rail) return;
    jumpingRef.current = true;
    rail.scrollTo({ left: i * rail.clientWidth, behavior: smooth ? "smooth" : "auto" });
    setIndex(i);
    setTimeout(() => (jumpingRef.current = false), 400);
  }, []);

  const onScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail || jumpingRef.current || rail.clientWidth === 0) return;
    const next = Math.round(rail.scrollLeft / rail.clientWidth);
    setIndex((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (activeIndex == null) return;
    if (activeIndex === index) return;
    if (activeIndex < 0 || activeIndex >= images.length) return;
    scrollToIndex(activeIndex);
    // Only react to an external variant change, not to the user's own swipes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  return (
    <div className="md:flex md:gap-4">
      {/* Thumbnail column — desktop only. On mobile the swipe *is* the control. */}
      {images.length > 1 && (
        <div className="hidden shrink-0 flex-col gap-2 md:flex">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => scrollToIndex(i)}
              aria-label={copy.product.imageOf(i + 1, images.length)}
              aria-current={i === index}
              className={cn(
                "relative size-16 overflow-hidden rounded-sm border transition-colors",
                i === index ? "border-ink" : "border-line hover:border-muted",
              )}
            >
              <Image
                src={src}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <div className="relative min-w-0 flex-1">
        <div
          ref={railRef}
          onScroll={onScroll}
          className="snap-rail aspect-square w-full rounded-md bg-surface md:rounded-lg"
          role="group"
          aria-roledescription="carousel"
          aria-label={copy.product.gallery}
        >
          {images.map((src, i) => (
            <div key={src} className="snap-item relative aspect-square w-full">
              <Image
                src={src}
                alt={`${title} — ${copy.product.imageOf(i + 1, images.length)}`}
                fill
                sizes="(max-width: 768px) 100vw, 520px"
                /* Only the first frame is worth preloading; it is the LCP
                   element on the product page. The rest lazy-load. */
                preload={i === 0}
                loading={i === 0 ? "eager" : "lazy"}
                className="object-cover"
              />
            </div>
          ))}
        </div>

        {/* Dots — mobile only, non-interactive targets are too small to be
            useful buttons, so they're presentational with a live label. */}
        {images.length > 1 && (
          <>
            <div
              className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 md:hidden"
              aria-hidden="true"
            >
              {images.map((src, i) => (
                <span
                  key={src}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200 ease-out",
                    i === index ? "w-4 bg-ink" : "w-1.5 bg-ink/25",
                  )}
                />
              ))}
            </div>
            <p className="sr-only" aria-live="polite">
              {copy.product.imageOf(index + 1, images.length)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
