"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { recoveryMessage, whatsappHref } from "@/lib/admin/whatsapp";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { AsyncState, ErrorBanner } from "./ui";
import { FraudCard } from "./FraudCard";
import type { Lead } from "./LeadCard";

/**
 * The call list, one tap from the dashboard.
 *
 * WHY A DRAWER AND NOT A LINK TO THE ABANDONED PAGE
 * -------------------------------------------------
 * The Abandoned screen is where a lead gets worked — notes, offers, coupons,
 * the history of who said what. This is the other thing a shop does with that
 * list, which is to sit down and ring five people. Navigating away for that
 * loses the dashboard, and coming back means finding the range picker again;
 * five minutes later nobody does it. So the phone numbers come to the
 * dashboard and the rest stays where it is — there is a link at the bottom for
 * when a lead needs more than a call.
 *
 * IT DOES NOT LOAD UNTIL IT IS OPENED
 * -----------------------------------
 * Mounted closed on every dashboard visit, so fetching on mount would put a
 * second request on the first paint of the busiest screen in the panel for a
 * panel most visits never open.
 *
 * MARKING SOMEBODY CALLED IS THE POINT
 * ------------------------------------
 * Without it the list is the same five names tomorrow and the shop stops
 * opening it. The button writes the same event the Abandoned page writes, so
 * the two cannot disagree about who has been rung.
 */

export function CallListDrawer({
  open,
  onClose,
  onWorked,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired after a lead changes, so the banner behind can recount. */
  onWorked: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ checkouts: Lead[] }>("admin/abandoned");
      /* Recovered and dismissed leads are already excluded by the API's
         default; what is left is the queue, freshest first. */
      setLeads(data.checkouts);

      /* The shop's own wording. A failure here must not take the phone numbers
         down with it — the messages fall back to the built-in text, which is
         what they were before the wording became editable at all. */
      try {
        const settings = await adminApi.get<{
          settings: { whatsappTemplates: Record<string, string> };
        }>("admin/settings");
        setTemplates(settings.settings.whatsappTemplates ?? {});
      } catch {
        setTemplates({});
      }

      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Could not load the list.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /* Loading is driven by the open flag rather than by mount, and `key` on the
     Sheet's content is not enough — the panel stays mounted through its own
     closing animation. */
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setLoading(true);
    void load();
  }
  if (!open && wasOpen) setWasOpen(false);

  const markCalled = async (lead: Lead) => {
    setBusy(lead.id);
    setActionError(null);
    try {
      await adminApi.patch(`admin/abandoned/${lead.id}`, {
        status: "contacted",
      });
      toast("Marked as called");
      await load();
      onWorked();
    } catch (caught) {
      setActionError(
        caught instanceof AdminApiError ? caught.message : "Could not save.",
      );
    } finally {
      setBusy(null);
    }
  };

  const atStake = leads.reduce((sum, lead) => sum + lead.estimatedValue, 0);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Who to ring"
      className="sm:max-w-lg"
    >
      <div className="flex flex-col gap-3">
        <p className="text-caption text-muted">
          {leads.length === 0
            ? "Nobody is waiting for a call."
            : `${leads.length} ${leads.length === 1 ? "person" : "people"} left ${formatTaka(atStake)} of goods in the basket. They already chose a product — a call is usually all that is missing.`}
        </p>

        <ErrorBanner message={actionError} />

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
              <Row
                key={lead.id}
                lead={lead}
                templates={templates}
                busy={busy === lead.id}
                onCalled={() => void markCalled(lead)}
              />
            ))}
          </ul>
        </AsyncState>

        <Link
          href="/admin/abandoned"
          onClick={onClose}
          className="text-caption text-ink underline-offset-4 hover:underline"
        >
          Open Abandoned for notes, offers and the full history →
        </Link>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

function Row({
  lead,
  templates,
  busy,
  onCalled,
}: {
  lead: Lead;
  templates: Record<string, string>;
  busy: boolean;
  onCalled: () => void;
}) {
  const message = recoveryMessage(lead, {
    storeName: copy.brand.name,
    templates,
  });
  const chat = whatsappHref(lead.phone, message);

  /*
   * A lead already marked contacted stays in the list — somebody may need a
   * second call — but it must not look like work still waiting.
   *
   * `status`, NOT the derived `stage`. Stage moves to `help_message_sent` the
   * moment somebody sends the WhatsApp message, which left this row reading
   * "Already called" while the banner above still counted the lead as waiting.
   * The banner counts `status = 'open'`, so this has to read the same column or
   * the two disagree in front of whoever is working the list.
   */
  const called = lead.status === "contacted";
  const [showFraudCheck, setShowFraudCheck] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-caption font-semibold text-ink">
            {lead.customerName || "No name given"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="tnum truncate text-micro text-muted">
              {lead.phone}
              {lead.areaText ? ` · ${lead.areaText}` : ""}
            </p>
            <button
              type="button"
              onClick={() => setShowFraudCheck((v) => !v)}
              className="inline-flex items-center gap-0.5 text-micro font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline"
              title="Check courier delivery records"
            >
              <Icon name="shield" size={11} />
              <span>{showFraudCheck ? "Hide courier" : "Courier record"}</span>
            </button>
          </div>
        </div>
        <span className="tnum shrink-0 rounded-xs bg-warn-soft px-1.5 py-0.5 text-micro font-medium text-warn">
          {formatTaka(lead.estimatedValue)}
        </span>
      </div>

      <p className="truncate text-micro text-ink-soft">
        {lead.contents
          .map((line) => `${line.name} × ${line.quantity}`)
          .join(", ")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* `tel:` rather than a dialer integration: on the phone the desk
            actually uses, this opens the dialer with the number in it. */}
        <Button href={`tel:${lead.phone}`} variant="primary" size="sm">
          <Icon name="phone" size={14} />
          Call
        </Button>

        {chat && (
          <Button
            href={chat}
            target="_blank"
            rel="noopener noreferrer"
            variant="soft"
            size="sm"
          >
            WhatsApp
          </Button>
        )}

        <Button
          variant={showFraudCheck ? "soft" : "ghost"}
          size="sm"
          onClick={() => setShowFraudCheck((v) => !v)}
        >
          <Icon name="shield" size={14} />
          {showFraudCheck ? "Hide courier" : "Courier record"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          disabled={called}
          onClick={onCalled}
        >
          {called ? "Already called" : "Mark called"}
        </Button>
      </div>

      {showFraudCheck && (
        <div className="mt-1">
          <FraudCard phone={lead.phone} />
        </div>
      )}
    </li>
  );
}
