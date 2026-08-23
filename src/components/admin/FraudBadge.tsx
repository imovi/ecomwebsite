"use client";

import { cn } from "@/lib/utils";
import type { ApiFraudReport } from "@/lib/api/types";

/**
 * A customer's delivery rate, small enough for a table row.
 *
 * WHAT THE COLOURS MEAN, AND WHAT THEY DO NOT
 * -------------------------------------------
 * The bands below are a reading aid, not a verdict. A red badge does not mean
 * refuse the order; it means ask more on the confirmation call. On a shop where
 * one phone can belong to a shared household and one address to a whole
 * building, a number is evidence, never a decision.
 *
 * Nothing is drawn at all when no courier has answered for this number — an
 * absent badge says "not looked up", which is the truth, where a grey 0% would
 * say "never took delivery of anything", which would not be.
 */

/** Below this many parcels the percentage is arithmetic, not a pattern. */
const ENOUGH_TO_JUDGE = 3;

export function fraudTone(report: ApiFraudReport): "positive" | "warn" | "sale" | "muted" {
  const { total, successRatio } = report.aggregate;

  if (total === 0) return "muted";
  /* One parcel returned out of one is 0%, and says almost nothing. Saying so
     quietly is better than shouting a number built from a single event. */
  if (total < ENOUGH_TO_JUDGE) return "muted";
  if (successRatio >= 80) return "positive";
  if (successRatio >= 50) return "warn";
  return "sale";
}

const TONE_CLASS = {
  positive: "bg-positive-soft text-positive",
  warn: "bg-warn-soft text-warn",
  sale: "bg-sale-soft text-sale",
  muted: "bg-surface text-muted",
} as const;

/**
 * The row-sized form.
 *
 * Shows the percentage and the parcel count together, because "100%" from one
 * parcel and "100%" from forty are different facts and the count is what tells
 * them apart at a glance.
 */
export function FraudBadge({
  report,
  className,
}: {
  report: ApiFraudReport | undefined;
  className?: string;
}) {
  if (!report || report.aggregate.answered === 0) return null;

  const { total, successRatio } = report.aggregate;

  if (total === 0) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-micro font-medium",
          TONE_CLASS.muted,
          className,
        )}
        title="No courier has carried a parcel for this number before."
      >
        new
      </span>
    );
  }

  return (
    <span
      className={cn(
        "tnum inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-medium",
        TONE_CLASS[fraudTone(report)],
        className,
      )}
      title={`${report.aggregate.success} delivered, ${report.aggregate.cancel} returned, from ${report.aggregate.answered} of ${report.aggregate.asked} couriers`}
    >
      {successRatio}%
      <span className="opacity-70">· {total}</span>
    </span>
  );
}
