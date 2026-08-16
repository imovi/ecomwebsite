"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ProductImageState } from "@/types";

/**
 * The switch that turns the product off.
 *
 * Every photo in this gallery is a photo of the lamp lit. This hangs the same
 * shot unlit on top of it and cross-fades between the two, so a shopper can see
 * what the thing looks like when it is off — which, for a lamp, is most of the
 * day, and is the one question a page of glowing photographs cannot answer.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not own the gallery. Swiping, snapping, thumbnails, the auto-advance
 * and the frame counter are all exactly as they were; this draws two things
 * into slots the gallery offers and reads the frame number back out. Remove the
 * two props and the file and the gallery is untouched.
 *
 * On a frame with no unlit photo the switch is not rendered at all. A control
 * that is visible but does nothing is worse than no control, and half a
 * gallery having one is the normal case — a marketing collage has no unlit
 * counterpart and never will.
 */

/** Long enough to read as a light coming up, short enough not to feel slow. */
const FADE_MS = 450;

interface LightSwitchProps {
  /** Per gallery frame, in gallery order. `null` where a frame has no pair. */
  offByIndex: (ProductImageState | null)[];
  title: string;
}

export function useLightSwitch({ offByIndex }: LightSwitchProps) {
  /**
   * On by default, and back on whenever the shopper moves to another photo.
   *
   * Keyed by frame rather than kept as one flag: the alternative is a flag
   * that survives the move, so tapping the next thumbnail shows an unlit photo
   * of something they have not seen lit yet.
   */
  const [offFrame, setOffFrame] = useState<number | null>(null);

  const isOff = (index: number) => offFrame === index;
  const hasPair = (index: number) => offByIndex[index] != null;

  const toggle = (index: number) =>
    setOffFrame((current) => (current === index ? null : index));

  return { isOff, hasPair, toggle };
}

/**
 * The unlit photo, stacked on the lit one inside a single frame.
 *
 * `opacity` and nothing else: the lit photo underneath keeps its place in the
 * layout, so there is no reflow, no second reserved box, and no shift when the
 * switch is thrown. The unlit file is only fetched when its frame is the one
 * being looked at — ten photos would otherwise mean twenty downloads for a
 * gallery most shoppers swipe twice.
 */
export function OffFrame({
  state,
  title,
  index,
  total,
  visible,
}: {
  state: ProductImageState | null;
  title: string;
  index: number;
  total: number;
  visible: boolean;
}) {
  /**
   * Mounted on first use and kept, so flicking the switch back and forth costs
   * one request rather than one per flick.
   *
   * Frame 0 is mounted up front because it is the photo everybody lands on and
   * therefore the one most likely to be switched. Every other frame waits until
   * its switch is actually thrown — a ten-photo gallery would otherwise fetch
   * ten extra files for a shopper who swipes twice. While it loads, the lit
   * photo underneath is what shows, so the worst case is that the light comes
   * on a moment late rather than a blank frame.
   */
  const [mounted, setMounted] = useState(index === 0);
  if (visible && !mounted) setMounted(true);

  if (!state || !mounted) return null;

  return (
    <Image
      src={state.url}
      alt={`${title} — photo ${index + 1} of ${total}, light off`}
      fill
      sizes="(max-width: 767px) 100vw, (min-width: 1632px) 684px, calc(50vw - 116px)"
      loading="lazy"
      className={cn(
        "object-cover transition-opacity ease-out motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      /* Never the thing a shopper taps — the switch below is. */
      aria-hidden="true"
    />
  );
}

/**
 * The control: a pill that reads as a switch and behaves as a checkbox.
 *
 * A real `button` with `aria-pressed`, not a styled `div`, so it is reachable
 * by keyboard and announced as a control that is currently on or off. The
 * label says what pressing it DOES rather than what state it is in, because
 * that is what a screen reader user needs before they press it.
 *
 * Sits bottom-LEFT on a phone and bottom-right from `md` up: the gallery's own
 * frame counter occupies the bottom-right corner below `md`, and two things in
 * one corner is how a small screen ends up with neither being readable.
 */
export function LightPill({
  isOff,
  onToggle,
}: {
  isOff: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!isOff}
      aria-label={isOff ? "Turn the light on" : "Turn the light off"}
      className={cn(
        /* A fixed track, so the knob has somewhere to travel and the pill does
           not resize between a two- and three-letter word. */
        "absolute bottom-3 left-3 z-10 h-7 w-[68px] rounded-full",
        "border backdrop-blur-sm transition-colors duration-200 motion-reduce:transition-none",
        "md:left-auto md:right-3",
        isOff
          ? "border-white/20 bg-ink/70"
          : "border-white/45 bg-white/85 shadow-[0_0_18px_rgba(255,214,140,0.7)]",
      )}
    >
      {/* Knob. Left when off, right when on — the direction a switch moves. */}
      <span
        className={cn(
          "absolute top-1/2 left-1 grid size-5 -translate-y-1/2 place-items-center rounded-full",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          isOff ? "translate-x-0 bg-white/30" : "translate-x-[40px] bg-[#ffd68c]",
        )}
      >
        <span
          className={cn(
            "block size-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none",
            isOff ? "bg-white/60" : "bg-[#8a5a00]",
          )}
        />
      </span>

      {/* Label on the side the knob is not. */}
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 text-micro font-semibold tracking-wide",
          isOff ? "right-2.5 text-white/85" : "left-2.5 text-ink",
        )}
      >
        {isOff ? "OFF" : "ON"}
      </span>
    </button>
  );
}
