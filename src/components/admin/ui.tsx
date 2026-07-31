"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Layout";

/** Shared admin building blocks. Kept small — this is a tool, not a product. */

/**
 * The body of an admin screen.
 *
 * Fills the window rather than sitting in a narrow centred column: this is a
 * tool used on a desktop, and a shop owner comparing delivery charges against
 * courier costs should not have to scroll past a screenful of empty margin to
 * do it.
 *
 * Cards flow into two columns once there is genuinely room for them (1280px+).
 * A single column stretched across a 2560px monitor would be worse than the
 * narrow version — form rows a metre wide, with the label at one end and the
 * field at the other. Anything that needs the full width (a table, a list of
 * orders) opts out with `className="2xl:col-span-2"` on that card.
 *
 * `items-start` matters: without it, grid stretches every card in a row to the
 * height of the tallest, leaving a short card with a large empty base.
 */
export function PageBody({
  children,
  columns = true,
  className,
}: {
  children: React.ReactNode;
  /** False for screens that are one wide table and would look absurd halved. */
  columns?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        columns && "2xl:grid 2xl:grid-cols-2 2xl:items-start",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-md border border-line bg-white", className)}>{children}</div>
  );
}

export function CardHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <h2 className="text-body font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-caption text-muted">{hint}</p>}
    </div>
  );
}

/** One place to render the three states every admin screen has. */
export function AsyncState({
  loading,
  error,
  empty,
  emptyMessage = "Nothing here yet.",
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  /* `2xl:col-span-2` on each state: these render as a direct child of the page
     grid, and a skeleton or an error occupying half the window while the other
     half sits empty reads as a broken layout rather than a loading one. */
  if (loading) {
    return (
      <div className="flex flex-col gap-2 2xl:col-span-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-sale/25 bg-sale-soft px-4 py-5 text-center 2xl:col-span-2">
        <p className="text-caption text-sale">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-caption font-medium text-ink underline"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="rounded-md border border-line bg-white px-4 py-10 text-center 2xl:col-span-2">
        <Icon name="package" size={26} className="mx-auto text-muted" />
        <p className="mt-2 text-caption text-muted">{emptyMessage}</p>
      </div>
    );
  }

  return <>{children}</>;
}

/** Inline banner for a failed write, above the form that caused it. */
export function ErrorBanner({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cn("rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale", className)}
    >
      {message}
    </p>
  );
}

export function SuccessBanner({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-sm bg-positive-soft px-3 py-2 text-caption text-positive",
        className,
      )}
    >
      {message}
    </p>
  );
}

/** A labelled figure for the overview screen. */
export function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warn" | "positive";
}) {
  return (
    <div className="rounded-md border border-line bg-white px-4 py-3.5">
      <p className="text-micro uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "tnum mt-1 text-[22px] font-semibold",
          tone === "warn" ? "text-warn" : tone === "positive" ? "text-positive" : "text-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Horizontal scroll wrapper so wide tables never widen the page itself. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <div className="min-w-[640px]">{children}</div>
    </div>
  );
}
