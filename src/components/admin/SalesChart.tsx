"use client";

import { useMemo, useState } from "react";
import { formatTaka } from "@/lib/utils";
import type { ApiOverview } from "@/lib/api/types";

/**
 * Sales and orders over the chosen range.
 *
 * WHY THIS IS HAND-DRAWN SVG AND NOT A CHART LIBRARY
 * --------------------------------------------------
 * The panel's content security policy forbids third-party script hosts, so the
 * CDN `<script>` in the design prototype cannot run here at all — and bundling
 * a charting library to draw two series of bars would add more weight to every
 * admin page load than the whole feature is worth, on a panel that is opened
 * over Bangladeshi mobile data. Two rounded rectangles per bucket is not a
 * problem a dependency solves.
 *
 * PLACED AND DELIVERED ARE DRAWN SIDE BY SIDE AND NEVER STACKED
 * ------------------------------------------------------------
 * On cash on delivery they are not parts of a whole. One is what customers
 * promised, the other is cash that arrived, and the same order appears in both
 * on different days. Stacking them would draw a total that means nothing, and
 * overlaying them would suggest the second is a subset of the first on that
 * day, which it usually is not.
 *
 * WHAT IT DOES WHEN THERE IS NO MONEY TO SHOW
 * -------------------------------------------
 * A `manager` is sent order counts without the taka, so the chart switches its
 * axis to counts rather than drawing an empty frame. The shape of the day — when
 * the orders come in — is the order desk's own business.
 */

interface Props {
  points: ApiOverview["series"];
  /** The window the points were cut from, so empty buckets can be put back. */
  range: { from: string; to: string };
  bucket: "hour" | "day";
  /** False for the order desk, whose series arrives with no taka in it. */
  showMoney: boolean;
}

/** Enough to read a shape; more than this on a phone is a smear. */
const MAX_LABELS = 8;

export function SalesChart({ points, range, bucket, showMoney }: Props) {
  const [active, setActive] = useState<number | null>(null);

  const series = useMemo(
    () =>
      withGaps(points, range, bucket).map((point) => ({
        at: point.at,
        placed: showMoney ? (point.placedValue ?? 0) : point.placedOrders,
        delivered: showMoney
          ? (point.deliveredValue ?? 0)
          : point.deliveredOrders,
        placedOrders: point.placedOrders,
        deliveredOrders: point.deliveredOrders,
      })),
    [points, range, bucket, showMoney],
  );

  const peak = Math.max(
    1,
    ...series.map((point) => Math.max(point.placed, point.delivered)),
  );

  if (series.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-caption text-muted">
        Nothing happened in this range. Pick a wider one, or check back once
        orders start arriving.
      </p>
    );
  }

  const shown = active !== null ? series[active] : null;
  const format = (value: number) =>
    showMoney ? formatTaka(value) : `${value}`;

  /* Every nth label, so the axis stays legible whatever the range. */
  const labelEvery = Math.ceil(series.length / MAX_LABELS);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Key
            className="bg-ink"
            label={showMoney ? "Ordered" : "Orders placed"}
          />
          <Key
            className="bg-positive"
            label={showMoney ? "Delivered" : "Delivered"}
          />
        </div>

        {/* Reserves its own line whether or not a bar is hovered, so the chart
            does not jump a row taller as the pointer crosses it. */}
        <p className="tnum min-h-[1.05rem] text-micro text-muted">
          {shown
            ? `${labelFor(shown.at, bucket)} — ${format(shown.placed)} ordered` +
              `${shown.delivered > 0 ? `, ${format(shown.delivered)} delivered` : ""}` +
              ` · ${shown.placedOrders} order${shown.placedOrders === 1 ? "" : "s"}`
            : `Peak ${format(peak)} per ${bucket}`}
        </p>
      </div>

      <div
        className="flex h-40 items-end gap-[3px] sm:h-48"
        onMouseLeave={() => setActive(null)}
      >
        {series.map((point, index) => (
          <button
            key={point.at}
            type="button"
            /* A bar is a data point, not a control: it is focusable and
               announced, but it goes nowhere and does nothing on click. */
            aria-label={`${labelFor(point.at, bucket)}: ${format(point.placed)} ordered, ${format(point.delivered)} delivered`}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            className="group flex h-full flex-1 items-end gap-[2px] rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <Bar
              height={point.placed / peak}
              className="bg-ink/80 group-hover:bg-ink"
            />
            <Bar
              height={point.delivered / peak}
              className="bg-positive/70 group-hover:bg-positive"
            />
          </button>
        ))}
      </div>

      <div className="flex gap-[3px]">
        {series.map((point, index) => (
          <span
            key={point.at}
            className="tnum flex-1 overflow-hidden text-center text-[10px] leading-tight text-muted"
          >
            {index % labelEvery === 0 ? labelFor(point.at, bucket) : " "}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Bar({ height, className }: { height: number; className: string }) {
  /* A bucket with a real but tiny value must still draw something. A bar of
     zero height and a bar of one taka would otherwise look identical, which is
     the difference between "no orders" and "one small order". */
  const percent = height > 0 ? Math.max(height * 100, 2) : 0;

  return (
    <span
      className={`w-full rounded-t-xs transition-[height] ${className}`}
      style={{ height: `${percent}%` }}
    />
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-micro text-muted">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

/**
 * A bucket's label, in the shop's own clock.
 *
 * `at` is Dhaka wall-clock with no zone on it, deliberately — see the API type.
 * So it is sliced as text rather than parsed into a `Date`, which would apply
 * the reader's timezone and redraw a Dhaka evening as somebody else's
 * afternoon. An owner checking the panel from abroad must see their shop's
 * hours, not their own.
 */
function labelFor(at: string, bucket: "hour" | "day"): string {
  const [date = "", time = ""] = at.split("T");
  const [, month = "", day = ""] = date.split("-");

  if (bucket === "hour") {
    const hour = Number(time.slice(0, 2));
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}${hour < 12 ? "am" : "pm"}`;
  }

  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Buckets with nothing in them, put back.
 *
 * The API returns only buckets that saw activity, because it cannot know how
 * wide the axis should be. Drawn as-is, three orders spread across a day would
 * come out as three adjacent bars — a chart saying the shop was busy all day.
 * The gaps are the information.
 *
 * Filled here rather than server-side because "all time" over years is tens of
 * thousands of empty days, and past `LIMIT` the sparse points are left alone:
 * a chart nobody can read is not worth the memory to build it.
 */
const LIMIT = 400;

function withGaps(
  points: ApiOverview["series"],
  range: { from: string; to: string },
  bucket: "hour" | "day",
): ApiOverview["series"] {
  const step = bucket === "hour" ? 3_600_000 : 86_400_000;

  /* Shifted into Dhaka time, so a truncated bucket lines up with the keys the
     server produced — which were truncated in Dhaka time for the same reason. */
  const from = Date.parse(range.from) + SHOP_OFFSET_MS;
  const to = Date.parse(range.to) + SHOP_OFFSET_MS;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return points;

  const start = Math.floor(from / step) * step;
  if ((to - start) / step > LIMIT) return points;

  const found = new Map(points.map((point) => [point.at, point]));
  const filled: ApiOverview["series"] = [];

  for (let at = start; at < to; at += step) {
    const key = new Date(at).toISOString().slice(0, 19);
    filled.push(
      found.get(key) ?? {
        at: key,
        placedOrders: 0,
        deliveredOrders: 0,
        placedValue: 0,
        deliveredValue: 0,
      },
    );
  }

  return filled;
}

/** Bangladesh has one zone and no daylight saving, so an offset is exact. */
const SHOP_OFFSET_MS = 6 * 60 * 60_000;
