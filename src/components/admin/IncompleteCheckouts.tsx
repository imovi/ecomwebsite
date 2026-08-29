"use client";

import { useCallback, useMemo, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, ErrorBanner, OrderTabs, PageBody } from "./ui";
import { LeadCard, type Lead } from "./LeadCard";

/**
 * Customers who started a checkout and left.
 *
 * A call list, and it is still designed as one: the phone number is the largest
 * thing on each card and it dials, because the action that recovers most of
 * this money is somebody ringing. What the shop can now do beyond ringing —
 * message them, offer free delivery for a day — sits beside that rather than in
 * front of it.
 *
 * Leads that turned into orders are hidden by default. Ringing a customer who
 * already bought is how a shop stops trusting this page.
 */
export function IncompleteCheckouts() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRecovered, setShowRecovered] = useState(false);

  const query = showRecovered ? "?includeRecovered=true" : "";

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ checkouts: Lead[]; openCount: number }>(
        `admin/abandoned${query}`,
      );
      setLeads(data.checkouts);
      setOpenCount(data.openCount);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the list.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useLoad(load);

  const run = useCallback(
    async (action: () => Promise<unknown>, message: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        toast(message);
        await load();
      } catch (caught) {
        setActionError(caught instanceof AdminApiError ? caught.message : "Could not save.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /**
   * What is sitting on the desk right now.
   *
   * Live offers are counted separately from waiting leads because they are the
   * one thing on this page with a deadline: a code nobody sends before it runs
   * out is a customer who was told nothing and a report line that reads as a
   * refusal. Everything else here keeps.
   */
  const summary = useMemo(() => {
    const live = leads.filter((lead) => lead.coupon?.state === "active");
    return {
      liveOffers: live.length,
      unsentOffers: live.filter((lead) => !lead.couponOfferSentAt).length,
      atStake: leads
        .filter((lead) => !lead.recovered && lead.status !== "dismissed")
        .reduce((sum, lead) => sum + lead.estimatedValue, 0),
    };
  }, [leads]);

  return (
    <AdminShell
      title="Orders"
      action={
        <label className="flex items-center gap-2 text-caption text-muted">
          <input
            type="checkbox"
            checked={showRecovered}
            onChange={(event) => {
              setShowRecovered(event.target.checked);
              setLoading(true);
            }}
          />
          Show recovered
        </label>
      }
    >
      <OrderTabs active="incomplete" incompleteCount={openCount} />

      <PageBody columns={false}>
        <ErrorBanner message={actionError} />

        <div className="grid gap-2 sm:grid-cols-3">
          <Card>
            <div className="flex flex-col gap-1 p-4">
              <p className="text-micro uppercase tracking-wide text-muted">Waiting for a call</p>
              <p className="tnum text-[28px] font-semibold leading-tight text-ink">{openCount}</p>
              <p className="text-caption text-muted">
                They already chose a product. A call is usually all that is missing.
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-1 p-4">
              <p className="text-micro uppercase tracking-wide text-muted">Offers running</p>
              <p className="tnum text-[28px] font-semibold leading-tight text-ink">
                {summary.liveOffers}
              </p>
              <p className="text-caption text-muted">
                {summary.unsentOffers > 0
                  ? `${summary.unsentOffers} not sent yet — they expire whether or not anyone sends them.`
                  : "All of them have been sent."}
              </p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-1 p-4">
              <p className="text-micro uppercase tracking-wide text-muted">Left in baskets</p>
              <p className="tnum text-[28px] font-semibold leading-tight text-ink">
                {formatTaka(summary.atStake)}
              </p>
              <p className="text-caption text-muted">
                Goods only. Nobody has chosen a delivery area yet.
              </p>
            </div>
          </Card>
        </div>

        <AsyncState
          loading={loading}
          error={error}
          empty={leads.length === 0}
          emptyMessage="Nobody has abandoned a checkout yet."
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          <ul className="flex flex-col gap-2">
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                busy={busy}
                actions={{
                  onStatus: (status) =>
                    run(
                      () => adminApi.patch(`admin/abandoned/${lead.id}`, { status }),
                      status === "contacted" ? "Marked as called" : "Dismissed",
                    ),

                  onNote: (input) =>
                    run(() => adminApi.patch(`admin/abandoned/${lead.id}`, input), "Note saved"),

                  /* The API returns the existing offer rather than failing when
                     one is already live, so a second tap is not an error — the
                     operator just wants the code. */
                  onGenerateCoupon: () =>
                    run(
                      () => adminApi.post(`admin/abandoned/${lead.id}/coupon`, {}),
                      "Offer ready to send",
                    ),

                  onCancelCoupon: () =>
                    run(
                      () => adminApi.delete(`admin/abandoned/${lead.id}/coupon`),
                      "Offer cancelled",
                    ),

                  onMarkSent: (kind) =>
                    run(
                      () => adminApi.post(`admin/abandoned/${lead.id}/sent`, { kind }),
                      "Recorded as sent",
                    ),

                  onDelete: () => {
                    if (!window.confirm(`Delete the record for ${lead.phone}?`)) return;
                    void run(
                      () => adminApi.delete(`admin/abandoned/${lead.id}`),
                      "Record deleted",
                    );
                  },
                }}
              />
            ))}
          </ul>
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}
