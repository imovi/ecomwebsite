"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatDateTime } from "@/lib/utils";
import type { ApiFraudReport } from "@/lib/api/types";
import { Card, CardHeader } from "./ui";
import { Button } from "@/components/ui/Button";
import { fraudTone } from "./FraudBadge";

/**
 * The customer's delivery record, in full, on the order.
 *
 * Laid out to answer three questions in the order the desk asks them: is this
 * number good for it, where does that come from, and how much of the picture
 * is missing.
 *
 * That third one is why the failures are on screen rather than in a log. If
 * three couriers refused to answer, the percentage above them is built from
 * two — and a person deciding whether to send a parcel needs to know that
 * before they trust it.
 */

const TONE_TEXT = {
  positive: "text-positive",
  warn: "text-warn",
  sale: "text-sale",
  muted: "text-ink",
} as const;

import Link from "next/link";
import { cn } from "@/lib/utils";

export function FraudCard({ phone }: { phone: string }) {
  const [report, setReport] = useState<ApiFraudReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (refresh: boolean) => {
    try {
      const data = await adminApi.get<{ report: ApiFraudReport | null }>(
        `admin/fraud/check/${phone}${refresh ? "?refresh=true" : ""}`,
      );
      setReport(data.report);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not check the courier record.",
      );
    }
  }, [phone]);

  const load = useCallback(async () => {
    await fetchReport(false);
    setLoading(false);
  }, [fetchReport]);

  useLoad(load);

  if (loading) {
    return (
      <Card>
        <CardHeader title="Courier record" hint="Loading delivery track record..." />
        <div className="p-4 text-caption text-muted">Checking courier records...</div>
      </Card>
    );
  }

  if (!report && !error) {
    return (
      <Card>
        <CardHeader title="Courier record" hint="Customer delivery rate" />
        <div className="flex flex-col gap-2 p-4 text-caption text-muted">
          <p>No courier delivery record checked yet for this phone number.</p>
          <div className="flex gap-2 pt-1">
            <Link
              href="/admin/settings"
              className="inline-flex items-center gap-1.5 rounded-sm bg-surface px-3 py-1.5 text-caption font-medium text-ink hover:bg-surface-hover"
            >
              Configure in Settings → Courier
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Courier record"
        hint={report?.checkedAt ? `Checked ${formatDateTime(report.checkedAt)}` : undefined}
      />

      <div className="flex flex-col gap-3.5 p-4">
        {error && <p className="text-caption text-sale">{error}</p>}

        {report && <Summary report={report} />}
        {report && report.couriers.length > 0 && <PerCourier report={report} />}
        {report && report.failures.length > 0 && <Failures report={report} />}

        <Button
          type="button"
          variant="soft"
          size="sm"
          className="self-start"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await fetchReport(true);
            setBusy(false);
          }}
        >
          Check again
        </Button>
      </div>
    </Card>
  );
}

function Summary({ report }: { report: ApiFraudReport }) {
  const { success, cancel, total, successRatio, answered, asked } = report.aggregate;

  if (total === 0) {
    return (
      <div>
        <p className="text-body font-semibold text-ink">No parcels on record</p>
        <p className="mt-0.5 text-caption text-muted">
          {answered === 0
            ? asked === 0
              ? "No courier APIs configured yet. Configure Steadfast in Settings → Courier."
              : "No courier answered."
            : `None of the ${answered} courier${answered === 1 ? "" : "s"} that answered has carried anything for this number. Treat as a new customer.`}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <p className={`tnum text-[32px] font-bold leading-tight ${TONE_TEXT[fraudTone(report)]}`}>
          {successRatio}%
        </p>
        <span className="text-caption font-medium text-muted">
          Delivery success rate
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-caption">
        <span className="inline-flex items-center gap-1 font-semibold text-positive">
          ✓ {success} Received
        </span>
        <span className="text-muted">·</span>
        <span className="inline-flex items-center gap-1 font-semibold text-sale">
          ✕ {cancel} Not received
        </span>
        <span className="text-muted">·</span>
        <span className="text-ink-soft">
          {total} total parcel{total === 1 ? "" : "s"}
        </span>
      </div>
      {answered < asked && (
        <p className="mt-1.5 text-micro text-warn">
          From {answered} of {asked} couriers — the rest did not answer.
        </p>
      )}
    </div>
  );
}

function PerCourier({ report }: { report: ApiFraudReport }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-micro font-medium uppercase tracking-wider text-muted">
        Breakdown by courier
      </p>
      <ul className="flex flex-col gap-2">
        {report.couriers.map((courier) => (
          <li key={courier.courier} className="rounded-sm border border-line bg-surface/50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-semibold text-ink">{courier.label}</span>
              <span className="tnum text-caption font-bold text-ink">
                {courier.total === 0 ? "0%" : `${courier.successRatio}%`}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-micro text-muted">
              <span className="font-medium text-positive">
                Received: {courier.success}
              </span>
              <span className="font-medium text-sale">
                Not received: {courier.cancel}
              </span>
              <span>
                Total: {courier.total}
              </span>
            </div>
            {courier.total > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    courier.successRatio >= 80
                      ? "bg-positive"
                      : courier.successRatio >= 50
                        ? "bg-warn"
                        : "bg-sale",
                  )}
                  style={{ width: `${courier.successRatio}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Failures({ report }: { report: ApiFraudReport }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <p className="text-micro uppercase tracking-wide text-muted">Did not answer</p>
      {report.failures.map((failure) => (
        <p key={failure.courier} className="text-micro text-warn">
          {failure.message}
          {failure.kind === "credentials" && (
            <span className="text-muted"> — check the sign-in under Fraud check.</span>
          )}
        </p>
      ))}
    </div>
  );
}
