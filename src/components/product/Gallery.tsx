"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { useAutoAdvance } from "@/lib/hooks/use-auto-advance";
import { parseVideoUrl } from "@/lib/video-embed";

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

export function isVideoMedia(url: string): boolean {
  if (!url) return false;
  const withoutHash = url.split("#")[0] ?? "";
  const cleanPath = withoutHash.split("?")[0] ?? "";
  return (
    /\.(mp4|webm|mov|ogg|m3u8|mpd)$/i.test(cleanPath) ||
    cleanPath.includes("video/") ||
    withoutHash.includes("facebook.com/reel") ||
    withoutHash.includes("facebook.com/watch") ||
    withoutHash.includes("instagram.com/reel") ||
    withoutHash.includes("instagram.com/p/") ||
    withoutHash.includes("tiktok.com") ||
    withoutHash.includes("youtube.com") ||
    withoutHash.includes("youtu.be")
  );
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
  const [overrideFit, setOverrideFit] = useState<Record<number, "cover" | "contain">>({});
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
                (() => {
                  const clean = src.split("#")[0] ?? src;
                  const embed = parseVideoUrl(clean);
                  const isSocial = embed && embed.type !== "direct" && embed.type !== "unknown";

                  return (
                    <div className="relative size-full bg-neutral-900 flex items-center justify-center">
                      {isSocial ? (
                        <div className="flex flex-col items-center justify-center p-1 text-center">
                          <span className="text-micro font-bold text-white uppercase tracking-tight">
                            {embed.platformName.replace(" Video", "").replace(" Reel", "")}
                          </span>
                          <span className="mt-1 flex size-5 items-center justify-center rounded-full bg-white/90 text-ink shadow-xs">
                            <svg className="size-2.5 fill-current ml-0.5" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </div>
                      ) : (
                        <>
                          <video
                            src={`${clean.split("?")[0]}#t=0.5`}
                            preload="metadata"
                            muted
                            playsInline
                            onLoadedMetadata={(e) => {
                              if (e.currentTarget.currentTime < 0.1) {
                                e.currentTarget.currentTime = 0.5;
                              }
                            }}
                            className="size-full object-cover pointer-events-none"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                            <span className="flex size-6 items-center justify-center rounded-full bg-white/90 text-ink shadow-xs">
                              <svg className="size-3 fill-current ml-0.5" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()
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
          {images.map((src, i) => {
            const isVideo = isVideoMedia(src);
            const defaultContain = src.includes("fit=contain");
            const activeFit = overrideFit[i] ?? (defaultContain ? "contain" : "cover");
            const isTop = src.includes("pos=top");
            const isBottom = src.includes("pos=bottom");
            const fitClass =
              activeFit === "contain"
                ? "object-contain bg-black"
                : isTop
                  ? "object-cover object-top"
                  : isBottom
                    ? "object-cover object-bottom"
                    : "object-cover object-center";

            const cleanMediaUrl = src.split("#")[0] ?? src;
            const embed = isVideo ? parseVideoUrl(cleanMediaUrl) : null;
            const isSocial = embed && embed.type !== "direct" && embed.type !== "unknown";

            return (
              <div key={src} className="snap-item relative h-full w-full overflow-hidden bg-neutral-950">
                {isSocial ? (
                  <div className="relative size-full flex items-center justify-center bg-black">
                    <iframe
                      src={embed.embedUrl}
                      title={embed.platformName}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      className="size-full border-0"
                    />
                  </div>
                ) : isVideo ? (
                  <>
                    <video
                      src={`${cleanMediaUrl.split("?")[0]}#t=0.5`}
                      preload="metadata"
                      muted
                      loop
                      playsInline
                      autoPlay={i === index}
                      controls
                      onLoadedMetadata={(e) => {
                        if (e.currentTarget.currentTime < 0.1 && i !== index) {
                          e.currentTarget.currentTime = 0.5;
                        }
                      }}
                      className={cn("h-full w-full", fitClass)}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setOverrideFit((prev) => ({
                          ...prev,
                          [i]: activeFit === "contain" ? "cover" : "contain",
                        }))
                      }
                      title={activeFit === "contain" ? "Crop to 1:1 frame" : "Show full video"}
                      className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-micro font-medium text-white backdrop-blur-xs hover:bg-black/90 transition-colors shadow-xs"
                    >
                      <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {activeFit === "contain" ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h16v16H4z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        )}
                      </svg>
                      <span>{activeFit === "contain" ? "Fill Frame" : "Full Video"}</span>
                    </button>
                  </>
                ) : (
                  <Image
                    src={src}
                    alt={`${title} — ${copy.product.imageOf(i + 1, images.length)}`}
                    fill
                    sizes="(max-width: 767px) 100vw, (min-width: 1632px) 684px, calc(50vw - 116px)"
                    fetchPriority={i === 0 ? "high" : undefined}
                    loading={i === 0 ? "eager" : "lazy"}
                    className={cn(fitClass)}
                  />
                )}
                {renderFrameOverlay?.(i)}
              </div>
            );
          })}
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
                (() => {
                  const clean = src.split("#")[0] ?? src;
                  const embed = parseVideoUrl(clean);
                  const isSocial = embed && embed.type !== "direct" && embed.type !== "unknown";

                  return (
                    <div className="relative size-full bg-neutral-900 flex items-center justify-center">
                      {isSocial ? (
                        <div className="flex flex-col items-center justify-center p-0.5 text-center">
                          <span className="text-[9px] font-bold text-white uppercase tracking-tight leading-none">
                            {embed.platformName.replace(" Video", "").replace(" Reel", "").slice(0, 5)}
                          </span>
                          <span className="mt-0.5 flex size-4 items-center justify-center rounded-full bg-white/90 text-ink">
                            <svg className="size-2 fill-current ml-0.25" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </div>
                      ) : (
                        <>
                          <video
                            src={`${clean.split("?")[0]}#t=0.5`}
                            preload="metadata"
                            muted
                            playsInline
                            onLoadedMetadata={(e) => {
                              if (e.currentTarget.currentTime < 0.1) {
                                e.currentTarget.currentTime = 0.5;
                              }
                            }}
                            className="size-full object-cover pointer-events-none"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                            <span className="flex size-4 items-center justify-center rounded-full bg-white/90 text-ink">
                              <svg className="size-2 fill-current ml-0.5" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()
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
