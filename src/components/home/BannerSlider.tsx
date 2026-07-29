"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Banner } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Banner slider.
 *
 * Constraints applied deliberately, because carousels are usually a net
 * negative on conversion and always a risk to LCP:
 *
 *  - Slide 1 is preloaded and eagerly decoded; it is the LCP element on the
 *    homepage. Slides 2 and 3 lazy-load and cost nothing until swiped to.
 *  - Auto-advance is slow (6s) and stops permanently the moment the customer
 *    swipes — fighting a user's scroll is the worst carousel failure mode.
 *  - It pauses when the tab is hidden and never runs under
 *    `prefers-reduced-motion`.
 *  - Separate mobile and desktop crops, so phones never download a 1600px
 *    wide-format image they'd only see letterboxed.
 */
export function BannerSlider({ banners }: { banners: Banner[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const jumpingRef = useRef(false);

  const goTo = useCallback((i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    jumpingRef.current = true;
    rail.scrollTo({ left: i * rail.clientWidth, behavior: "smooth" });
    setIndex(i);
    setTimeout(() => (jumpingRef.current = false), 500);
  }, []);

  const onScroll = useCallback(() => {
    const rail = railRef.current;
    if (!rail || jumpingRef.current || rail.clientWidth === 0) return;
    setIndex(Math.round(rail.scrollLeft / rail.clientWidth));
  }, []);

  useEffect(() => {
    if (!autoPlay || banners.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = setInterval(() => {
      if (document.hidden) return;
      const rail = railRef.current;
      if (!rail) return;
      const next = (Math.round(rail.scrollLeft / rail.clientWidth) + 1) % banners.length;
      goTo(next);
    }, 6000);

    return () => clearInterval(timer);
  }, [autoPlay, banners.length, goTo]);

  /** Any touch or wheel input hands control to the customer for good. */
  const surrender = () => setAutoPlay(false);

  return (
    <div
      className="relative"
      onTouchStart={surrender}
      onMouseDown={surrender}
      onWheel={surrender}
    >
      <div
        ref={railRef}
        onScroll={onScroll}
        className="snap-rail rounded-lg"
        aria-roledescription="carousel"
        aria-label="Promotions"
      >
        {banners.map((banner, i) => (
          <Link
            key={banner.id}
            href={banner.href}
            className="snap-item relative aspect-[9/7.6] w-full overflow-hidden bg-surface sm:aspect-[5/2]"
            aria-label={banner.alt}
          >
            <Image
              src={banner.imageMobile ?? banner.image}
              alt={banner.alt}
              fill
              sizes="100vw"
              preload={i === 0}
              loading={i === 0 ? "eager" : "lazy"}
              className="object-cover sm:hidden"
            />
            <Image
              src={banner.image}
              alt=""
              fill
              sizes="(max-width: 640px) 0px, 100vw"
              preload={i === 0}
              loading={i === 0 ? "eager" : "lazy"}
              className="hidden object-cover sm:block"
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
