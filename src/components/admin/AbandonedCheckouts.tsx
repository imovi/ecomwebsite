"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { PageBody } from "./ui";
import { RangePicker, rangeQuery, type RangePreset } from "./RangePicker";
import { LeadList } from "./LeadList";
import { OfferRules } from "./OfferRules";
import { RecoveryReport } from "./RecoveryReport";

/**
 * Everything about customers who did not finish, in one place.
 *
 * Three tabs rather than three screens, because they are three views of one
 * job: the leads are the work, the report says whether the work is paying, and
 * the rules are what the work is allowed to offer. An owner reading a 12%
 * recovery rate wants to change the floor and go back to the list without
 * hunting through Settings for it.
 *
 * The report used to sit on the Performance page and the rules on Settings.
 * Both were moved here rather than copied — the same figure on two screens is
 * how a shop ends up with two answers to one question and trusts neither.
 */

type Tab = "leads" | "report" | "rules";

const TABS: { key: Tab; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "report", label: "Report" },
  { key: "rules", label: "Offer rules" },
];

export function AbandonedCheckouts() {
  const [tab, setTab] = useState<Tab>("leads");
  const [showRecovered, setShowRecovered] = useState(false);
  const [openCount, setOpenCount] = useState(0);

  /* The report's own window. Same vocabulary as the Profit and Performance
     pages, so an owner comparing screens does not re-learn the chips. */
  const [preset, setPreset] = useState<RangePreset>("last30");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);

  /* Stable, so it does not re-trigger the list's load on every render of this
     page — `useLoad` keys off the callback's identity. */
  const handleOpenCount = useCallback((count: number) => setOpenCount(count), []);

  return (
    <AdminShell
      title="Abandoned checkouts"
      action={
        tab === "leads" ? (
          <label className="flex items-center gap-2 text-caption text-muted">
            <input
              type="checkbox"
              checked={showRecovered}
              onChange={(event) => setShowRecovered(event.target.checked)}
            />
            Show recovered
          </label>
        ) : undefined
      }
    >
      {/* One continuous page, not two columns: PageBody's default grid at 2xl
          would strand the tabs on the left with every figure on the right. */}
      <PageBody columns={false}>
        <div className="flex gap-4 border-b border-line">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 pb-2.5 text-caption font-medium transition-colors",
                tab === entry.key
                  ? "border-ink text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {entry.label}
              {/* Only on Leads, and only when there is work. A "0" is one more
                  thing to read on a day when there is nothing to do. */}
              {entry.key === "leads" && openCount > 0 && (
                <span className="tnum rounded-full bg-warn-soft px-1.5 py-0.5 text-micro font-semibold text-warn">
                  {openCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Mounted per tab rather than hidden with CSS: the list and the report
            each hold a fetch, and keeping both alive would re-query the API
            every time somebody switched back and forth. */}
        {tab === "leads" && (
          <LeadList showRecovered={showRecovered} onOpenCount={handleOpenCount} />
        )}

        {tab === "report" && (
          <>
            <RangePicker
              preset={preset}
              custom={custom}
              onPreset={(value) => {
                setCustom(null);
                setPreset(value);
              }}
              onCustom={(range) => setCustom(range)}
            />
            <RecoveryReport query={rangeQuery(preset, custom)} />
          </>
        )}

        {tab === "rules" && <OfferRules />}
      </PageBody>
    </AdminShell>
  );
}
