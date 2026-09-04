"use client";

import { useCallback, useMemo, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import { AsyncState, Card, ErrorBanner } from "./ui";
import { LeadCard, type Lead } from "./LeadCard";
import { Button } from "@/components/ui/Button";
import { AutoRecoveryBotModal } from "./AutoRecoveryBotModal";

/**
 * The call list itself.
 *
 * Split out of the page so the page can put a report and the offer rules
 * beside it without this growing a third responsibility. Everything about
 * working a lead — ringing, messaging, offering, dismissing — lives here.
 *
 * Leads that turned into orders are hidden by default. Ringing a customer who
 * already bought is how a shop stops trusting this page.
 */
export function LeadList({
  showRecovered,
  onOpenCount,
}: {
  showRecovered: boolean;
  /** Lifted so the tab beside this one can show the waiting count. */
  onOpenCount?: (count: number) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  /* The shop's own WhatsApp wording. A second small read rather than threading
     settings down from the page: every other admin screen fetches its own, and
     one shared context for one string map is more machinery than it saves. */
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [botModalOpen, setBotModalOpen] = useState(false);

  const query = showRecovered ? "?includeRecovered=true" : "";

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ checkouts: Lead[]; openCount: number }>(
        `admin/abandoned${query}`,
      );
      setLeads(data.checkouts);
      setOpenCount(data.openCount);

      /* Failure here must not take the call list down with it. The messages
         fall back to the built-in wording, which is what they were before the
         shop could edit them at all. */
      try {
        const settings = await adminApi.get<{
          settings: { whatsappTemplates: Record<string, string> };
        }>("admin/settings");
        setTemplates(settings.settings.whatsappTemplates ?? {});
      } catch {
        setTemplates({});
      }

      onOpenCount?.(data.openCount);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the list.");
    } finally {
      setLoading(false);
    }
  }, [query, onOpenCount]);

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
   * Live offers are counted apart from waiting leads because they are the one
   * thing here with a deadline: a code nobody sends before it runs out is a
   * customer who was told nothing and a report line that reads as a refusal.
   * Everything else on this page keeps.
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
    <>
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

      {leads.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs">
              <svg className="size-5 fill-current" viewBox="0 0 24 24">
                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z" />
              </svg>
            </span>
            <div>
              <h3 className="text-body font-semibold text-emerald-950">Auto WhatsApp Recovery Bot</h3>
              <p className="text-caption text-emerald-800">
                Recover abandoned carts in 1 click with personalized cart resume links and discount coupons.
              </p>
            </div>
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={() => setBotModalOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white shrink-0"
          >
            <svg className="size-4 mr-1.5 fill-current" viewBox="0 0 24 24">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Launch Auto-Recovery Bot
          </Button>
        </div>
      )}

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
              templates={templates}
              actions={{
                onStatus: (status) =>
                  run(
                    () => adminApi.patch(`admin/abandoned/${lead.id}`, { status }),
                    status === "contacted" ? "Marked as called" : "Dismissed",
                  ),

                onNote: (input) =>
                  run(() => adminApi.patch(`admin/abandoned/${lead.id}`, input), "Note saved"),

                /* The API returns the offer already outstanding rather than
                   failing, so a second tap is not an error — the operator just
                   wants the code. */
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

      <AutoRecoveryBotModal
        isOpen={botModalOpen}
        onClose={() => setBotModalOpen(false)}
        leads={leads}
        templates={templates}
        onLeadsUpdated={load}
      />
    </>
  );
}
