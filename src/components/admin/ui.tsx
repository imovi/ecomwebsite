"use client";

import { useState } from "react";
import Link from "next/link";
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

/* -------------------------------------------------------------------------- */
/* Date range                                                                 */
/* -------------------------------------------------------------------------- */

export type DateRangePreset = "today" | "yesterday" | "last7" | "last30" | "all";

/** What a chosen range resolves to. Both absent means "everything". */
export interface DateRange {
  dateFrom?: string;
  dateTo?: string;
}

const RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

/**
 * The shop's timezone, as a fixed offset.
 *
 * Bangladesh has one zone and no daylight saving, so an offset is exact rather
 * than an approximation of a real tz database lookup.
 */
const SHOP_UTC_OFFSET = "+06:00";
const SHOP_OFFSET_MS = 6 * 60 * 60_000;

/**
 * Today in Dhaka, as `YYYY-MM-DD`.
 *
 * The shop, its customers and its couriers are all in one timezone, so a "day"
 * here means a Dhaka day. Using the browser's local date would put an owner
 * checking the panel from abroad on a different day to their own orders.
 */
function shopToday(): Date {
  return new Date(Date.now() + SHOP_OFFSET_MS);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000);
}

/**
 * A Dhaka day's boundaries, as instants the API can compare against.
 *
 * Sent with the offset rather than as bare `YYYY-MM-DD`, because the API reads
 * a bare date as UTC. A Dhaka day starts at 18:00 UTC the day before, so
 * "Today" would silently drop every order placed between midnight and 6am —
 * and on a shop that takes evening orders that is a real slice of the day,
 * missing with no indication anything was left out.
 */
export function shopDayStart(day: string): string {
  return `${day}T00:00:00${SHOP_UTC_OFFSET}`;
}

export function shopDayEnd(day: string): string {
  return `${day}T23:59:59.999${SHOP_UTC_OFFSET}`;
}

/**
 * Turns a preset into the two instants the API takes.
 *
 * Exported because the caller needs the resolved range for its own query, and
 * because a preset resolved in two places would eventually be resolved two
 * different ways.
 */
export function resolveDateRange(preset: DateRangePreset): DateRange {
  const today = shopToday();

  const span = (fromDay: string, toDay: string): DateRange => ({
    dateFrom: shopDayStart(fromDay),
    dateTo: shopDayEnd(toDay),
  });

  switch (preset) {
    case "today":
      return span(isoDay(today), isoDay(today));
    case "yesterday": {
      const yesterday = isoDay(shiftDays(today, -1));
      return span(yesterday, yesterday);
    }
    /* Inclusive of today, so "last 7 days" is this day plus the six before it
       — which is what someone means when they ask for a week. */
    case "last7":
      return span(isoDay(shiftDays(today, -6)), isoDay(today));
    case "last30":
      return span(isoDay(shiftDays(today, -29)), isoDay(today));
    case "all":
      return {};
  }
}

/**
 * Range picker shared by the overview and the order queue.
 *
 * One control in both places, so "Today" cannot come to mean two different
 * windows on two screens that are read one after the other.
 */
export function DateRangeFilter({
  preset,
  custom,
  className,
  onPreset,
  onCustom,
}: {
  preset: DateRangePreset;
  custom: { from: string; to: string } | null;
  className?: string;
  onPreset: (value: DateRangePreset) => void;
  onCustom: (range: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(custom?.from ?? isoDay(shopToday()));
  const [to, setTo] = useState(custom?.to ?? isoDay(shopToday()));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Wraps rather than scrolls. Six chips do not fit across a phone, and a
          scrolling row put "Last 30 days", "All time" and "Custom" past the
          right edge of a strip with nothing to say it moved — an admin who
          never scrolled it believed the panel had four ranges. */}
      <div className="flex flex-wrap gap-1.5">
        {RANGE_PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setOpen(false);
              onPreset(option.value);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-caption font-medium transition-colors",
              !custom && preset === option.value
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-caption font-medium transition-colors",
            custom
              ? "border-ink bg-ink text-white"
              : "border-line bg-white text-muted hover:text-ink",
          )}
        >
          {custom ? `${custom.from} → ${custom.to}` : "Custom"}
        </button>
      </div>

      {/* The date inputs are the widest thing here — full width on a phone so
          neither of them is half a control. */}

      {open && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-4">
          <label className="flex min-w-[45%] flex-1 flex-col gap-1.5 sm:min-w-0 sm:flex-none">
            <span className="text-caption font-medium text-ink-soft">From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-11 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink sm:w-[160px]"
            />
          </label>
          <label className="flex min-w-[45%] flex-1 flex-col gap-1.5 sm:min-w-0 sm:flex-none">
            <span className="text-caption font-medium text-ink-soft">To</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-11 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink sm:w-[160px]"
            />
          </label>
          <button
            type="button"
            disabled={from > to}
            onClick={() => {
              setOpen(false);
              onCustom({ from, to });
            }}
            className="h-11 w-full rounded-sm bg-ink px-4 text-caption font-medium text-white disabled:opacity-40 sm:w-auto"
          >
            Show
          </button>
          {from > to && (
            <p className="text-caption text-sale">The start date is after the end date.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Orders / Incomplete section switcher.
 *
 * Incomplete checkouts are a call list scoped to orders, not a separate area of
 * the shop — so it lives one route down from Orders and is presented as a tab
 * rather than its own sidebar entry.
 */
export function OrderTabs({ active }: { active: "orders" | "incomplete" | "trash" }) {
  const tabs = [
    { key: "orders" as const, href: "/admin/orders", label: "Orders" },
    { key: "incomplete" as const, href: "/admin/incomplete", label: "Incomplete" },
    { key: "trash" as const, href: "/admin/orders/trash", label: "Trash" },
  ];

  return (
    <div className="mb-4 flex gap-4 border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "border-b-2 pb-2.5 text-caption font-medium transition-colors",
            active === tab.key
              ? "border-ink text-ink"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

/** Horizontal scroll wrapper so wide tables never widen the page itself. */
export function TableWrap({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0", className)}>
      <div className="min-w-[640px]">{children}</div>
    </div>
  );
}
