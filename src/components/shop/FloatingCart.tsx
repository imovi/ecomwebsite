"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCartCount } from "@/lib/stores/cart-store";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

/**
 * Draggable cart button.
 *
 * Appears only once there is something in the cart, so an empty shop is not
 * cluttered by a control that does nothing. The header cart icon scrolls away on
 * a long product page; this keeps the route to checkout one tap away wherever the
 * shopper is.
 *
 * WHY IT MOVES
 * ------------
 * A fixed floating button eventually covers something that matters — a price, a
 * variant swatch, the last line of a description — and which thing depends on the
 * page and the phone. Rather than guess, the shopper can drag it out of the way,
 * and where they put it is remembered.
 *
 * IMPLEMENTATION NOTES
 * --------------------
 * - Pointer Events, not separate mouse/touch handlers: one code path covers
 *   finger, mouse and stylus, and `setPointerCapture` keeps the drag alive when
 *   the pointer outruns the button.
 * - A movement threshold separates a tap from a drag. Without it, the tiny finger
 *   travel in a normal tap reads as a drag and the link never fires.
 * - Position is stored as a fraction of the viewport, not pixels: a phone that
 *   rotates, or a browser whose toolbar collapses, would otherwise leave the
 *   button off-screen.
 * - `touch-none` is required. Without it the browser claims the gesture for
 *   scrolling and the drag never starts on a phone.
 */

const STORAGE_KEY = "gng-cart-fab-position-v1";

/** Distance in px before a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 6;

const SIZE = 56;
/** Keeps the button clear of the screen edge and the safe-area inset. */
const MARGIN = 12;

interface Position {
  /** Fraction of the available width, 0–1. */
  x: number;
  y: number;
}

/** Bottom-right by default, above where the sticky buy bar sits. */
const DEFAULT_POSITION: Position = { x: 1, y: 0.82 };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readStored(): Position {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POSITION;
    const parsed = JSON.parse(raw) as Partial<Position>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return DEFAULT_POSITION;
    }
    return { x: clamp01(parsed.x), y: clamp01(parsed.y) };
  } catch {
    /* Private mode, quota, or a corrupt value. The default is always fine. */
    return DEFAULT_POSITION;
  }
}

export function FloatingCart() {
  const count = useCartCount();

  const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
  const [dragging, setDragging] = useState(false);
  /** Set once the stored position has been read, to avoid a visible jump. */
  const [ready, setReady] = useState(false);

  const nodeRef = useRef<HTMLDivElement>(null);
  /** Offset from the pointer to the button's top-left, so it does not snap. */
  const grabRef = useRef({ dx: 0, dy: 0 });
  const startRef = useRef({ x: 0, y: 0 });
  /** True once the pointer has travelled far enough to count as a drag. */
  const movedRef = useRef(false);
  /**
   * The pointer currently pressing the button.
   *
   * Drag state is tracked here rather than inferred from `hasPointerCapture`.
   * `setPointerCapture` can throw — a pointer that has already been released, an
   * engine that disagrees about the id — and hanging the whole gesture off it
   * means one throw leaves the button undraggable with no way back.
   */
  const activePointerRef = useRef<number | null>(null);

  useEffect(() => {
    /* localStorage is browser-only, so this cannot run during the server render.
       Reading it in an effect costs one extra paint, which `ready` hides. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition(readStored());
    setReady(true);
  }, []);

  const persist = useCallback((next: Position) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* Non-fatal: the button still works, it just forgets where it was. */
    }
  }, []);

  /** Fractions → pixels, against the space the button can actually occupy. */
  const toPixels = useCallback((p: Position) => {
    const maxX = Math.max(0, window.innerWidth - SIZE - MARGIN * 2);
    const maxY = Math.max(0, window.innerHeight - SIZE - MARGIN * 2);
    return { left: MARGIN + p.x * maxX, top: MARGIN + p.y * maxY };
  }, []);

  const [pixels, setPixels] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!ready) return;

    const sync = () => setPixels(toPixels(position));
    sync();

    /* Re-clamp on rotation and on the mobile toolbar collapsing, either of which
       can otherwise strand the button outside the viewport. */
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, [ready, position, toPixels]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const node = nodeRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    grabRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    startRef.current = { x: event.clientX, y: event.clientY };
    movedRef.current = false;
    activePointerRef.current = event.pointerId;

    /* Best effort: keeps move events coming even if the pointer outruns the
       button. Not required for the drag to work, so a failure is ignored. */
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* Without capture the drag still works while the pointer stays over the
         button, which is the normal case for a 56px target under a thumb. */
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== event.pointerId) return;

    const travelled =
      Math.abs(event.clientX - startRef.current.x) +
      Math.abs(event.clientY - startRef.current.y);

    if (!movedRef.current && travelled < DRAG_THRESHOLD) return;

    if (!movedRef.current) {
      movedRef.current = true;
      setDragging(true);
    }

    const left = event.clientX - grabRef.current.dx;
    const top = event.clientY - grabRef.current.dy;

    const maxX = Math.max(0, window.innerWidth - SIZE - MARGIN * 2);
    const maxY = Math.max(0, window.innerHeight - SIZE - MARGIN * 2);

    setPixels({
      left: Math.min(MARGIN + maxX, Math.max(MARGIN, left)),
      top: Math.min(MARGIN + maxY, Math.max(MARGIN, top)),
    });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;

    const node = nodeRef.current;
    try {
      if (node?.hasPointerCapture(event.pointerId)) {
        node.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* Already released by the browser. */
    }

    /* A press that never moved is a tap; the link handles it. */
    if (!movedRef.current) return;

    /* Convert back to fractions so the stored position survives a rotation. */
    const maxX = Math.max(1, window.innerWidth - SIZE - MARGIN * 2);
    const maxY = Math.max(1, window.innerHeight - SIZE - MARGIN * 2);
    const next: Position = {
      x: clamp01((pixels.left - MARGIN) / maxX),
      y: clamp01((pixels.top - MARGIN) / maxY),
    };

    setPosition(next);
    persist(next);
    setDragging(false);
  }

  /* Nothing to show until the cart has something in it. Also covers the server
     render and the first client paint, where the count is always 0. */
  if (count === 0 || !ready) return null;

  return (
    <div
      ref={nodeRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ left: pixels.left, top: pixels.top, width: SIZE, height: SIZE }}
      className={cn(
        "fixed z-40 touch-none select-none",
        /* No transition while dragging — the button must track the finger
           exactly, and easing here reads as lag. */
        dragging ? "cursor-grabbing" : "cursor-grab transition-[left,top] duration-150 ease-out",
      )}
    >
      <Link
        href="/cart"
        aria-label={`${copy.nav.cart}, ${copy.cart.itemCount(count)}`}
        /* A drag ends with a click event on most browsers; swallow it so moving
           the button does not also navigate to the cart. */
        onClick={(event) => {
          if (movedRef.current) event.preventDefault();
        }}
        /* Dragging an <a> triggers the browser's native link-drag ghost. */
        draggable={false}
        className={cn(
          "flex size-full items-center justify-center rounded-full bg-ink text-white shadow-card",
          "transition-transform duration-150 ease-out motion-reduce:transition-none",
          dragging ? "scale-105" : "active:scale-95",
        )}
      >
        <Icon name="cart" size={23} />
        <span className="tnum absolute -right-0.5 -top-0.5 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-sale px-1 text-micro font-bold text-white ring-2 ring-white">
          {count > 99 ? "99+" : count}
        </span>
      </Link>
    </div>
  );
}
