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

  /* Nothing is configured, so there is nothing to say. Showing an empty card
     with "0%" would be worse than showing no card. */
  if (loading || (!report && !error)) return null;

  return (
    <Card>
      <CardHeader
        title="Courier record"
        hint={report ? `Checked ${formatDateTime(report.checkedAt)}` : undefined}
      />

      <div className="flex flex-col gap-3 p-4">
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
            ? "No courier answered."
            : `None of the ${answered} courier${answered === 1 ? "" : "s"} that answered has carried anything for this number. Treat as a new customer.`}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className={`tnum text-[28px] font-semibold leading-tight ${TONE_TEXT[fraudTone(report)]}`}>
        {successRatio}%
      </p>
      <p className="text-caption text-ink-soft">
        {success} delivered · {cancel} came back · {total} parcels
      </p>
      {/* Stated whenever the picture is incomplete, so the figure above is
          never read as the whole truth. */}
      {answered < asked && (
        <p className="mt-1 text-micro text-warn">
          From {answered} of {asked} couriers — the rest did not answer.
        </p>
      )}
    </div>
  );
}

function PerCourier({ report }: { report: ApiFraudReport }) {
  return (
    <ul className="flex flex-col gap-2 border-t border-line pt-3">
      {report.couriers.map((courier) => (
        <li key={courier.courier}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-caption text-ink">{courier.label}</span>
            <span className="tnum shrink-0 text-micro text-muted">
              {courier.total === 0
                ? "nothing"
                : `${courier.success}/${courier.total} · ${courier.successRatio}%`}
            </span>
          </div>
          {courier.total > 0 && (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full bg-positive"
                style={{ width: `${courier.successRatio}%` }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
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
