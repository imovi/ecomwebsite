"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { useAutoAdvance } from "@/lib/hooks/use-auto-advance";

/**
 * Swipeable product gallery.
 *
 * Built on native CSS scroll-snap rather than a carousel library: it gets
 * real momentum scrolling on iOS, works before hydration, costs zero KB of
 * JavaScript for the scrolling itself, and degrades to a plain scroller if JS
 * fails. The only JS here is index tracking, the variant-change jump, and the
 * auto-advance timer.
 *
 * The photos turn by themselves so the back, the ports and what is in the box
 * are seen by a shopper who never thinks to swipe — on a phone the extra
 * frames are otherwise invisible. It stops the moment they take over, and a
 * variant change is not taking over: that jump is the page answering a choice
 * they made elsewhere, so the rail keeps running afterwards.
 */

interface GalleryProps {
  images: string[];
  title: string;
  /** When the selected variant changes, jump to its image. */
  activeIndex?: number;
  /**
   * Drawn inside one frame, over its photo. Used to hold a second version of
   * the same shot — the lamp switched off — so it can be cross-faded in place.
   *
   * Optional, and absent for every product that has none: with no overlay this
   * component renders exactly the markup it always did.
   */
  renderFrameOverlay?: (index: number) => ReactNode;
  /**
   * Drawn once, over the main image area rather than inside the rail, so it
   * stays put while the frames scroll under it. Receives the frame currently
   * in view.
   */
  renderOverlay?: (index: number) => ReactNode;
}

function isVideoMedia(url: string): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov|ogg)($|\?)/i.test(url) || url.includes("video/");
}

export function Gallery({
  images,
  title,
  activeIndex,
  renderFrameOverlay,
  renderOverlay,
}: GalleryProps) {
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

  const { surrender, noteScroll, railHandlers } = useAutoAdvance({
    railRef,
    count: images.length,
    goTo: scrollToIndex,
  });

  const onScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail || rail.clientWidth === 0) return;
    /* Before the programmatic-jump guard, so a swipe that settles back on the
       same photo still counts as the shopper taking over. */
    noteScroll();
    if (jumpingRef.current) return;
    const next = Math.round(rail.scrollLeft / rail.clientWidth);
    setIndex((prev) => (prev === next ? prev : next));
  }, [noteScroll]);

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
              onClick={() => {
                /* Picking a photo is the shopper driving; the rail stops
                   moving under them from here on. */
                surrender();
                scrollToIndex(i);
              }}
              aria-label={copy.product.imageOf(i + 1, images.length)}
              aria-current={i === index}
              className={cn(
                "relative size-16 overflow-hidden rounded-sm border transition-colors",
                i === index ? "border-ink" : "border-line hover:border-muted",
              )}
            >
              {isVideoMedia(src) ? (
                <div className="relative size-full bg-neutral-900">
                  <video
                    src={src}
                    className="size-full object-cover pointer-events-none"
                    muted
                    playsInline
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <span className="flex size-6 items-center justify-center rounded-full bg-white/90 text-ink shadow-xs">
                      <svg className="size-3 fill-current ml-0.5" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </div>
                </div>
              ) : (
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="relative min-w-0 flex-1">
        <div
          ref={railRef}
          onScroll={onScroll}
          {...railHandlers}
          /* Square, but never more than half the screen on a phone.
             A square frame is 390px tall on a 390px-wide phone, which is fine in
             Chrome and not fine inside Facebook's in-app browser, where the
             address bar and the bottom bar leave roughly 640px to work with — the
             price and the buttons end up below the fold on exactly the traffic
             the ads send. `svh` rather than `vh` measures the viewport with those
             bars showing, which is the state the shopper actually lands in. */
          className="snap-rail aspect-square max-h-[50svh] w-full rounded-md bg-surface md:max-h-none md:rounded-lg"
          role="group"
          aria-roledescription="carousel"
          aria-label={copy.product.gallery}
        >
          {/* Each frame fills the rail rather than setting its own square, so
              the cap above actually binds — an aspect-square item would grow
              past a capped rail and spill out of it. */}
          {images.map((src, i) => (
            <div key={src} className="snap-item relative h-full w-full overflow-hidden bg-neutral-900">
              {isVideoMedia(src) ? (
                <video
                  src={src}
                  muted
                  loop
                  playsInline
                  autoPlay={i === index}
                  controls
                  className="h-full w-full object-cover"
                />
              ) : (
                <Image
                  src={src}
                  alt={`${title} — ${copy.product.imageOf(i + 1, images.length)}`}
                  fill
                  sizes="(max-width: 767px) 100vw, (min-width: 1632px) 684px, calc(50vw - 116px)"
                  fetchPriority={i === 0 ? "high" : undefined}
                  loading={i === 0 ? "eager" : "lazy"}
                  className="object-cover"
                />
              )}
              {renderFrameOverlay?.(i)}
            </div>
          ))}
        </div>

        {renderOverlay?.(index)}

        {/* Frame counter — mobile only. Tells the shopper how many photos exist
            even before they reach the thumbnails below. */}
        {images.length > 1 && (
          <>
            <div className="absolute bottom-3 right-3 md:hidden" aria-hidden="true">
              <span className="tnum rounded-full bg-ink/70 px-2 py-0.5 text-micro font-semibold text-white backdrop-blur-sm">
                {index + 1}/{images.length}
              </span>
            </div>
            <p className="sr-only" aria-live="polite">
              {copy.product.imageOf(index + 1, images.length)}
            </p>
          </>
        )}
      </div>

      {/* Thumbnail strip — mobile only; the desktop column above does this job
          on wide screens.

          Dots used to live here instead. Dots say "there is more" but not *what*
          more, and on a product where the extra photos are the back, the ports and
          what is in the box, that is the difference between a shopper who scrolls
          on and one who swipes. Real thumbnails also give a tap target, so the
          gallery is navigable without a swipe gesture at all.

          Scrolls horizontally rather than wrapping: a second row would push the
          price below the fold on a small phone. */}
      {images.length > 1 && (
        <div
          className="-mx-gutter mt-2.5 flex gap-2 overflow-x-auto px-gutter pb-1 md:hidden"
          /* Native scrollbar hidden on mobile — the overflowing thumbnails are
             their own affordance. */
          style={{ scrollbarWidth: "none" }}
        >
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => {
                surrender();
                scrollToIndex(i);
              }}
              aria-label={copy.product.imageOf(i + 1, images.length)}
              aria-current={i === index}
              className={cn(
                "relative size-14 shrink-0 overflow-hidden rounded-sm border-2 transition-colors",
                i === index ? "border-ink" : "border-transparent",
              )}
            >
              {isVideoMedia(src) ? (
                <div className="relative size-full bg-neutral-900">
                  <video
                    src={src}
                    className="size-full object-cover pointer-events-none"
                    muted
                    playsInline
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <span className="flex size-4 items-center justify-center rounded-full bg-white/90 text-ink">
                      <svg className="size-2 fill-current ml-0.5" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </div>
                </div>
              ) : (
                <Image src={src} alt="" fill sizes="56px" className="object-cover" />
              )}
              {/* The unselected thumbnails are dimmed rather than the selected one
                  highlighted, so the current frame reads as the bright one. */}
              {i !== index && <span className="absolute inset-0 bg-white/35" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
