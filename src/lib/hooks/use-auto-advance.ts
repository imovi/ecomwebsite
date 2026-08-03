"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-advance for a scroll-snap rail.
 *
 * Both carousels on the shop — the homepage banners and the product gallery —
 * are native CSS scroll-snap rails with JavaScript doing nothing but tracking
 * the index. This adds the timer they share, so the two behave identically
 * rather than drifting apart.
 *
 * WHEN IT STOPS, AND WHY THAT IS THE HARD PART
 * --------------------------------------------
 * The rule is easy to state — never fight a customer who is driving the
 * carousel themselves — and easy to get wrong. The banner used to hand over
 * control on `wheel` or `mousedown` anywhere on it. But the hero sits at the
 * top of the homepage, so the first flick of the page scroll happened with the
 * pointer over it and auto-advance switched off permanently before a single
 * slide had turned. On phones it was worse: scrolling the page means touching
 * whatever is under your thumb.
 *
 * "The rail scrolled" is not the answer either. A smooth programmatic scroll
 * keeps firing scroll events after any fixed guard window you pick, and those
 * trailing events look exactly like a swipe.
 *
 * What actually distinguishes the two is the pointer: the rail scrolls
 * horizontally under a finger or a held mouse button only when the customer
 * drags it, and a vertical page scroll never scrolls the rail at all. So the
 * signal is a scroll that happens WHILE the pointer is down on the rail, plus
 * a horizontal wheel or trackpad swipe, plus an outright tap on a dot or
 * thumbnail. No timers, so nothing to race.
 *
 * It also pauses on a hidden tab and never runs at all under
 * `prefers-reduced-motion` — an animation nobody asked for is exactly what
 * that setting is about.
 */

/** Long enough to read a banner, short enough to notice. */
export const AUTO_ADVANCE_MS = 5_000;

interface AutoAdvanceOptions {
  /** The scroll-snap rail. */
  railRef: React.RefObject<HTMLDivElement | null>;
  /** Number of slides. Fewer than two means there is nothing to advance to. */
  count: number;
  /** Moves the rail and updates the index. Must be stable. */
  goTo: (index: number) => void;
  /** Off for a rail that should sit still until asked. */
  enabled?: boolean;
  intervalMs?: number;
}

export function useAutoAdvance({
  railRef,
  count,
  goTo,
  enabled = true,
  intervalMs = AUTO_ADVANCE_MS,
}: AutoAdvanceOptions) {
  const [playing, setPlaying] = useState(true);
  /** True while a finger or mouse button is down on the rail. */
  const draggingRef = useRef(false);

  /** Hands the rail to the customer for the rest of the visit. */
  const surrender = useCallback(() => setPlaying(false), []);

  /**
   * Call from the rail's `onScroll`. Only a scroll under a held pointer is the
   * customer swiping; everything else is this hook's own smooth scroll, or the
   * page moving beneath a rail that never moved at all.
   */
  const noteScroll = useCallback(() => {
    if (draggingRef.current) setPlaying(false);
  }, []);

  /**
   * Spread onto the rail element. Pointer events cover touch, mouse and pen,
   * so one pair of handlers catches a swipe, a drag of the scrollbar and a
   * stylus alike.
   */
  const railHandlers = {
    onPointerDown: () => {
      draggingRef.current = true;
    },
    onPointerUp: () => {
      draggingRef.current = false;
    },
    onPointerCancel: () => {
      draggingRef.current = false;
    },
    /* A trackpad's horizontal swipe scrolls the rail with no pointer down at
       all. Vertical deltas are the page being read and are ignored — that
       distinction is the whole bug this file exists to describe. */
    onWheel: (event: React.WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) setPlaying(false);
    },
  };

  useEffect(() => {
    if (!playing || !enabled || count < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = setInterval(() => {
      /* A background tab would otherwise burn through every slide and land the
         customer somewhere they never chose when they come back. */
      if (document.hidden) return;

      const rail = railRef.current;
      if (!rail || rail.clientWidth === 0) return;

      /* Read the position from the rail rather than from React state: the rail
         is the source of truth for where the carousel actually is. */
      const current = Math.round(rail.scrollLeft / rail.clientWidth);
      goTo((current + 1) % count);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [playing, enabled, count, goTo, intervalMs, railRef]);

  return { surrender, noteScroll, railHandlers };
}
