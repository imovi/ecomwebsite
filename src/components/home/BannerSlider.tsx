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
 *  - Slide 1 is marked high priority; it is the LCP element on the homepage.
 *    Every slide stays lazy, including that one — each slide holds two crops
 *    and only one of them is ever displayed, so eager loading would fetch the
 *    hidden crop too. Slides 2 and 3 cost nothing until swiped to.
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

/**
 * How tall the banner may get from `sm` up — laptops, desktops and tablets.
 *
 * Phones are untouched: there the banner is the full page width and its own
 * shape is right, because a phone screen is roughly the shape of the artwork.
 *
 * A wide screen is not. The uploaded banner is 1717×916 — a poster, not a
 * banner — so at the container's full 1568px it stands 838px tall and pushes
 * the products, which are what the page is for, entirely below the fold.
 *
 * The cap is applied to the WIDTH, computed from this height and the image's
 * own ratio, rather than by squeezing the frame. Capping height alone would
 * leave a box wider than the picture and `object-contain` would fill the
 * difference with empty background; forcing a 3:1 crop instead would cut the
 * logo row off the top and the feature strip off the bottom. Constraining the
 * whole block keeps every pixel of the artwork and simply makes it smaller.
 *
 * Upload a properly banner-shaped image — 1600×500 or similar — and this stops
 * binding on its own: the ratio is read from the file, so a wide crop fills the
 * width at the height it was designed for.
 */
const BANNER_MAX_HEIGHT_PX = 440;

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
    /* The cap sits on the whole block, not just the rail, so the dots and the
       arrows stay centred under the banner rather than under the page. */
    <div
      className="relative sm:mx-auto sm:w-full sm:max-w-[var(--banner-max-width)]"
      style={
        {
          "--banner-max-width": `${Math.round(BANNER_MAX_HEIGHT_PX * desktopRatio)}px`,
        } as React.CSSProperties
      }
    >
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
            {/* Two crops of the same banner, one hidden by CSS at each width.
                Neither may be eager or preloaded: a hidden <img> that has been
                told to load eagerly still downloads, so forcing the first slide
                would fetch BOTH the phone and the desktop banner on every
                visit and the wrong one is pure waste. Left lazy, the browser
                skips the one that is `display: none`, and `fetchPriority`
                carries the urgency instead — which is exactly the trade Next's
                own art-direction guidance describes. */}
            <Image
              src={banner.imageMobile ?? banner.image}
              alt={banner.alt}
              fill
              sizes="100vw"
              fetchPriority={i === 0 ? "high" : undefined}
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
              fetchPriority={i === 0 ? "high" : undefined}
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
