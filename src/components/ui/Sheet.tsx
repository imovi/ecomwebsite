"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Icon } from "./Icon";

/**
 * Bottom sheet on phones, centred dialog from `md` up.
 *
 * Used for: search, variant selection when Buy Now is pressed with an
 * incomplete selection, and the mobile category menu. Deliberately hand-rolled
 * rather than pulling in a dialog library — the app needs one modal pattern,
 * not twelve.
 */

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Hides the visual header but keeps an accessible label. */
  hideHeader?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  hideHeader,
  children,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * React has no built-in exit animation, so the panel has to stay mounted for
   * the duration of the closing transition.
   *
   * `exiting` is adjusted during render when `open` changes — the pattern React
   * documents for deriving state from props — and cleared from a timeout, so
   * there is no state-syncing effect here.
   */
  const [exiting, setExiting] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (prevOpen !== open) {
    setPrevOpen(open);
    setExiting(!open);
  }

  useEffect(() => {
    if (open || !exiting) return;
    const timer = setTimeout(() => setExiting(false), 220);
    return () => clearTimeout(timer);
  }, [open, exiting]);

  // Escape to dismiss + scroll lock while open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const { overflow, paddingRight } = document.body.style;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    // Move focus into the panel so keyboard and screen-reader users land here.
    const focusTimer = setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        "[data-autofocus], button, a[href], input, select, textarea",
      );
      target?.focus();
    }, 60);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  // Keep Tab inside the panel while it's open.
  const onKeyDownTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // `document` is absent during SSR; the sheet always starts closed, so there
  // is nothing to hydrate and no mismatch to guard against.
  if (typeof document === "undefined" || (!open && !exiting)) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={onKeyDownTrap}
    >
      <button
        type="button"
        aria-label={copy.nav.close}
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-ink/40 transition-opacity duration-200 ease-out",
          open ? "opacity-100" : "opacity-0",
        )}
      />

      <div
        ref={panelRef}
        className={cn(
          "relative flex max-h-[88vh] w-full flex-col overflow-hidden bg-white shadow-sheet",
          "rounded-t-lg md:max-w-md md:rounded-lg",
          "transition-transform duration-[220ms] [transition-timing-function:var(--ease-spring)]",
          "motion-reduce:transition-none",
          open ? "translate-y-0" : "translate-y-full md:translate-y-4",
          className,
        )}
      >
        {/* Grab handle — a purely visual affordance that this pulls down. */}
        <div className="flex justify-center pt-2.5 md:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-line" />
        </div>

        {!hideHeader && title && (
          <div className="flex items-center justify-between gap-3 px-gutter py-3">
            <h2 className="text-title">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={copy.nav.close}
              className="-mr-1.5 flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
