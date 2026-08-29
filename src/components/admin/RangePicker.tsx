"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

/**
 * The date range every report screen is read through.
 *
 * Extracted from the profit dashboard when performance became a second report:
 * two screens an owner flips between must not disagree about what "last 7 days"
 * covers, and two copies of these presets would eventually drift. The API takes
 * the same preset names, so the value here travels straight into the query.
 */

export type RangePreset = "today" | "yesterday" | "last7" | "last30" | "month" | "lifetime";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
  { value: "month", label: "This month" },
  { value: "lifetime", label: "All time" },
];

/**
 * Today in Dhaka, whatever the browser's clock says.
 *
 * The reports are dated in the shop's timezone server-side; a date field
 * defaulting to the visitor's "today" would open the custom picker on the wrong
 * day for anyone travelling, and on the previous day for the owner checking
 * takings after midnight.
 */
export function shopToday(): string {
  return new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10);
}

/** The query string for a range, ready to append to a report endpoint. */
export function rangeQuery(
  preset: RangePreset,
  custom: { from: string; to: string } | null,
): string {
  return custom ? `?from=${custom.from}&to=${custom.to}` : `?preset=${preset}`;
}

export function RangePicker({
  preset,
  custom,
  className,
  onPreset,
  onCustom,
}: {
  preset: RangePreset;
  custom: { from: string; to: string } | null;
  className?: string;
  onPreset: (value: RangePreset) => void;
  onCustom: (range: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(custom?.from ?? shopToday());
  const [to, setTo] = useState(custom?.to ?? shopToday());

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Wraps rather than scrolls, same as the range chips in ui.tsx: on a
          phone the later presets sat past the right edge of a strip that did
          not look scrollable. */}
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
            custom ? "border-ink bg-ink text-white" : "border-line bg-white text-muted hover:text-ink",
          )}
        >
          {custom ? `${custom.from} → ${custom.to}` : "Pick dates"}
        </button>
      </div>

      {open && (
        <Card>
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Input
              label="From"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              wrapperClassName="w-[160px]"
            />
            <Input
              label="To"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              wrapperClassName="w-[160px]"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={from > to}
              onClick={() => {
                setOpen(false);
                onCustom({ from, to });
              }}
            >
              Show
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
