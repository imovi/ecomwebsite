"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { useAutoAdvance } from "@/lib/hooks/use-auto-advance";
import { parseVideoUrl, type ParsedVideoInfo } from "@/lib/video-embed";

interface GalleryProps {
  images: string[];
  title: string;
  /** When the selected variant changes, jump to its image. */
  activeIndex?: number;
  resolvedVideos?: Record<string, ParsedVideoInfo>;
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
  resolvedVideos,
  renderFrameOverlay,
  renderOverlay,
}: GalleryProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [overrideFit, setOverrideFit] = useState<Record<number, "cover" | "contain">>({});
  const [resolvedMap, setResolvedMap] = useState<Record<string, ParsedVideoInfo>>(
    () => resolvedVideos ?? {},
  );
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());


  const handleMuteToggle = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      videoRefs.current.forEach((vid) => {
        vid.muted = next;
        if (!next) {
          vid.volume = volume > 0 ? volume : 1;
        }
      });
      if (!next && volume === 0) setVolume(1);
      return next;
    });
  }, [volume]);

  // Set volume when navigating to a slide that has configured volume
  useEffect(() => {
    const currentSrc = images[index];
    if (currentSrc) {
      const volMatch = currentSrc.match(/vol=(\d+)/);
      if (volMatch) {
        const configuredVol = parseInt(volMatch[1], 10) / 100;
        setVolume(configuredVol);
        if (configuredVol === 0) {
          setIsMuted(true);
        }
      }
    }
  }, [images, index]);

  // Sync volume and active video play state
  useEffect(() => {
    videoRefs.current.forEach((vid, vidIndex) => {
      vid.muted = isMuted;
      vid.volume = isMuted ? 0 : volume;
      if (vidIndex === index) {
        vid.play().catch(() => {});
      } else {
        vid.pause();
      }
    });
  }, [index, isMuted, volume]);

  // Sync resolvedVideos prop if updated
  useEffect(() => {
    if (resolvedVideos) {
      setResolvedMap((prev) => ({ ...prev, ...resolvedVideos }));
    }
  }, [resolvedVideos]);

  // Client-side auto-resolve fallback for any social videos (Instagram, TikTok, etc.)
  useEffect(() => {
    images.forEach((src) => {
      const clean = src.split("#")[0] ?? src;
      if (resolvedMap[clean]) return;

      const parsed = parseVideoUrl(clean);
      if (parsed && (parsed.type === "instagram" || parsed.type === "tiktok")) {
        fetch(`/api/video/resolve?url=${encodeURIComponent(clean)}`)
          .then((r) => r.json())
          .then((res) => {
            if (res.success && res.data) {
              setResolvedMap((prev) => ({
                ...prev,
                [clean]: res.data,
              }));
            }
          })
          .catch(() => {});
      }
    });
  }, [images, resolvedMap]);
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
                  const initialEmbed = parseVideoUrl(clean);
                  const embed = resolvedMap[clean] ?? initialEmbed;
                  const hasPoster = Boolean(embed?.posterUrl);

                  return (
                    <div className="relative size-full bg-neutral-900 flex items-center justify-center overflow-hidden">
                      {embed && embed.type !== "direct" && embed.type !== "unknown" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-1 text-center">
                          <span className="text-micro font-bold text-white uppercase tracking-tight">
                            {embed.platformName.replace(" Video", "").replace(" Reel", "")}
                          </span>
                          <span className="mt-1 flex size-5 items-center justify-center rounded-full bg-white/90 text-ink shadow-xs">
                            <svg className="size-2.5 fill-current ml-0.5" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </div>
                      )}
                      {hasPoster ? (
                        <>
                          <img
                            src={embed!.posterUrl}
                            alt="Video Cover"
                            className="relative z-1 size-full object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                          <div className="absolute inset-0 z-2 flex items-center justify-center bg-black/25">
                            <span className="flex size-6 items-center justify-center rounded-full bg-white/90 text-ink shadow-xs">
                              <svg className="size-3 fill-current ml-0.5" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </span>
                          </div>
                        </>
                      ) : !embed || embed.type === "direct" || embed.type === "unknown" ? (
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
                      ) : null}
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
            const initialEmbed = isVideo ? parseVideoUrl(cleanMediaUrl) : null;
            const embed = resolvedMap[cleanMediaUrl] ?? initialEmbed;
            const isDirect = embed?.type === "direct";
            const isSocial = embed && !isDirect && embed.type !== "unknown";

            return (
              <div key={src} className="snap-item relative h-full w-full overflow-hidden bg-neutral-950">
                {isDirect ? (
                  <>
                    <video
                      ref={(el) => {
                        if (el) videoRefs.current.set(i, el);
                        else videoRefs.current.delete(i);
                      }}
                      src={embed.embedUrl}
                      poster={embed.posterUrl}
                      preload="metadata"
                      muted={isMuted}
                      loop
                      playsInline
                      autoPlay={i === index}
                      controls
                      onLoadedMetadata={(e) => {
                        e.currentTarget.muted = isMuted;
                        e.currentTarget.volume = isMuted ? 0 : volume;
                        if (e.currentTarget.currentTime < 0.1 && i !== index) {
                          e.currentTarget.currentTime = 0.5;
                        }
                      }}
                      className={cn(
                        "h-full w-full",
                        embed.isVertical ? "object-contain bg-black" : fitClass,
                      )}
                    />
                    {/* Mute / Unmute Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMuteToggle();
                      }}
                      title={isMuted ? "Unmute sound" : "Mute sound"}
                      className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-white backdrop-blur-xs hover:bg-black/90 active:scale-95 transition-all shadow-md"
                    >
                      {isMuted ? (
                        <>
                          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </svg>
                          <span className="text-micro font-medium tracking-tight">Unmute</span>
                        </>
                      ) : (
                        <>
                          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                          <span className="text-micro font-medium tracking-tight">Mute</span>
                        </>
                      )}
                    </button>
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
                      <span>{activeFit === "contain" ? "1:1 Frame" : "Full View"}</span>
                    </button>
                  </>
                ) : isSocial ? (
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
                      ref={(el) => {
                        if (el) videoRefs.current.set(i, el);
                        else videoRefs.current.delete(i);
                      }}
                      src={`${cleanMediaUrl.split("?")[0]}#t=0.5`}
                      preload="metadata"
                      muted={isMuted}
                      loop
                      playsInline
                      autoPlay={i === index}
                      controls
                      onLoadedMetadata={(e) => {
                        e.currentTarget.muted = isMuted;
                        e.currentTarget.volume = isMuted ? 0 : volume;
                        if (e.currentTarget.currentTime < 0.1 && i !== index) {
                          e.currentTarget.currentTime = 0.5;
                        }
                      }}
                      className={cn("h-full w-full", fitClass)}
                    />
                    {/* Mute / Unmute Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMuteToggle();
                      }}
                      title={isMuted ? "Unmute sound" : "Mute sound"}
                      className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-white backdrop-blur-xs hover:bg-black/90 active:scale-95 transition-all shadow-md"
                    >
                      {isMuted ? (
                        <>
                          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </svg>
                          <span className="text-micro font-medium tracking-tight">Unmute</span>
                        </>
                      ) : (
                        <>
                          <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                          <span className="text-micro font-medium tracking-tight">Mute</span>
                        </>
                      )}
                    </button>
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
                  const initialEmbed = parseVideoUrl(clean);
                  const embed = resolvedMap[clean] ?? initialEmbed;
                  const hasPoster = Boolean(embed?.posterUrl);

                  return (
                    <div className="relative size-full bg-neutral-900 flex items-center justify-center overflow-hidden">
                      {embed && embed.type !== "direct" && embed.type !== "unknown" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-0.5 text-center">
                          <span className="text-[9px] font-bold text-white uppercase tracking-tight leading-none">
                            {embed.platformName.replace(" Video", "").replace(" Reel", "").slice(0, 5)}
                          </span>
                          <span className="mt-0.5 flex size-4 items-center justify-center rounded-full bg-white/90 text-ink">
                            <svg className="size-2 fill-current ml-0.25" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </div>
                      )}
                      {hasPoster ? (
                        <>
                          <img
                            src={embed!.posterUrl}
                            alt="Video Cover"
                            className="relative z-1 size-full object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                          <div className="absolute inset-0 z-2 flex items-center justify-center bg-black/25">
                            <span className="flex size-4 items-center justify-center rounded-full bg-white/90 text-ink">
                              <svg className="size-2 fill-current ml-0.5" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </span>
                          </div>
                        </>
                      ) : !embed || embed.type === "direct" || embed.type === "unknown" ? (
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
                      ) : null}
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
