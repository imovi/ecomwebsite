"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { Banner } from "@/types";
import { cn } from "@/lib/utils";
import { useAutoAdvance } from "@/lib/hooks/use-auto-advance";

/**
 * Banner slider.
 *
 * Constraints applied deliberately, because carousels are usually a net
 * negative on conversion and always a risk to LCP:
 *
 *  - Slide 1 is preloaded and eagerly decoded; it is the LCP element on the
 *    homepage. Slides 2 and 3 lazy-load and cost nothing until swiped to.
 *  - Auto-advance is unhurried and stops permanently the moment the customer
 *    swipes the rail — fighting a user's scroll is the worst carousel failure
 *    mode. Scrolling the PAGE is not swiping the rail, which is the distinction
 *    the first version got wrong; see `useAutoAdvance`.
 *  - It pauses when the tab is hidden and never runs under
 *    `prefers-reduced-motion`.
 *  - Separate mobile and desktop crops, so phones never download a 1600px
 *    wide-format image they'd only see letterboxed.
 *  - **The rail takes the shape of the artwork.** It used to force every banner
 *    into a hardcoded 5:2 (and 9:7.6 on phones) and crop whatever did not fit,
 *    so a shop uploading a square or an unusually wide banner silently lost the
 *    edges. The first slide's real dimensions now set the ratio, and slides are
 *    letterboxed rather than cropped.
 *
 *    The FIRST slide decides, because a horizontal rail must have one height —
 *    and it is the slide most people see. Consistently sized artwork therefore
 *    fits perfectly; mixed sizes fit inside without losing anything.
 */

/** Falls back to the old fixed ratios when dimensions are unknown (0). */
function ratio(width?: number, height?: number, fallback = 5 / 2): number {
  if (!width || !height) return fallback;
  /* Guard against a nonsensical stored value producing a zero-height rail. */
  const value = width / height;
  return Number.isFinite(value) && value > 0.2 && value < 12 ? value : fallback;
}
export function BannerSlider({ banners }: { banners: Banner[] }) {
  const railRef = useRef<HTMLDivElement>(null);

  const first = banners[0];
  /* Phones use the mobile crop's shape when there is one, otherwise the wide
     image's — matching whichever file they will actually download. */
  const mobileRatio = ratio(
    first?.mobileWidth ?? first?.width,
    first?.mobileHeight ?? first?.height,
    9 / 7.6,
  );
  const desktopRatio = ratio(first?.width, first?.height);
  const [index, setIndex] = useState(0);
  const jumpingRef = useRef(false);

  const goTo = useCallback((i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    jumpingRef.current = true;
    rail.scrollTo({ left: i * rail.clientWidth, behavior: "smooth" });
    setIndex(i);
    setTimeout(() => (jumpingRef.current = false), 500);
  }, []);

  const { surrender, noteScroll, railHandlers } = useAutoAdvance({
    railRef,
    count: banners.length,
    goTo,
  });

  const onScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail || rail.clientWidth === 0) return;
    /* Asked before the programmatic-jump guard below returns, so a swipe that
       settles back on the slide it started from still counts. */
    noteScroll();
    if (jumpingRef.current) return;
    setIndex(Math.round(rail.scrollLeft / rail.clientWidth));
  }, [noteScroll]);

  return (
    <div className="relative">
      <div
        ref={railRef}
        onScroll={onScroll}
        {...railHandlers}
        /* Both ratios are published as custom properties so the breakpoint can
           be expressed in CSS. An inline `aspectRatio` cannot vary by media
           query, and phones and desktop use differently-shaped crops. */
        style={
          {
            "--banner-ratio": String(mobileRatio),
            "--banner-ratio-wide": String(desktopRatio),
          } as React.CSSProperties
        }
        className="snap-rail rounded-lg"
        aria-roledescription="carousel"
        aria-label="Promotions"
      >
        {banners.map((banner, i) => (
          <Link
            key={banner.id}
            href={banner.href}
            className="snap-item relative w-full overflow-hidden bg-surface aspect-[var(--banner-ratio)] sm:aspect-[var(--banner-ratio-wide)]"
            aria-label={banner.alt}
          >
            <Image
              src={banner.imageMobile ?? banner.image}
              alt={banner.alt}
              fill
              sizes="100vw"
              preload={i === 0}
              loading={i === 0 ? "eager" : "lazy"}
              /* `contain`, not `cover`: the whole picture is shown. A banner
                 carries words, and cropping them is worse than a narrow band of
                 background beside an oddly-shaped one. */
              className="object-contain sm:hidden"
            />
            <Image
              src={banner.image}
              alt=""
              fill
              sizes="(max-width: 640px) 0px, 100vw"
              preload={i === 0}
              loading={i === 0 ? "eager" : "lazy"}
              className="hidden object-contain sm:block"
            />
          </Link>
        ))}
      </div>

      {banners.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
          {banners.map((banner, i) => (
            <button
              key={banner.id}
              type="button"
              onClick={() => {
                surrender();
                goTo(i);
              }}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              /* 24px hit area around a 6px dot — the dot is decorative, the
                 target has to be thumb-sized. */
              className="flex h-6 w-6 items-center justify-center"
            >
              <span
                className={cn(
                  "h-1.5 rounded-full bg-white transition-all duration-200 ease-out",
                  i === index ? "w-5 opacity-100" : "w-1.5 opacity-50",
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
