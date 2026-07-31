"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Customers who started a checkout and left.
 *
 * A call list, and it is designed as one: the phone number is the largest thing
 * on each row and it dials, because the only action that recovers any of this
 * money is somebody ringing. Everything else on the row exists to make that
 * call better — what they were buying, what it was worth, how long ago.
 *
 * Leads that turned into orders are hidden by default. Ringing a customer who
 * already bought is how a shop stops trusting this page.
 */

interface Line {
  name: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
}

interface Lead {
  id: string;
  phone: string;
  customerName: string | null;
  address: string | null;
  areaText: string | null;
  contents: Line[];
  itemCount: number;
  estimatedValue: number;
  status: "open" | "contacted" | "dismissed";
  note: string;
  contactedAt: string | null;
  recovered: boolean;
  lastSeenAt: string;
}

/** "12 minutes ago" beats a timestamp when deciding who to ring first. */
function sinceLabel(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

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
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not load the list.",
      );
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

  return (
    <AdminShell
      title="Incomplete"
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
      <PageBody columns={false}>
        <ErrorBanner message={actionError} />

        <Card>
          <div className="flex flex-col gap-1 p-4">
            <p className="text-micro uppercase tracking-wide text-muted">Waiting for a call</p>
            <p className="tnum text-[28px] font-semibold leading-tight text-ink">{openCount}</p>
            <p className="text-caption text-muted">
              People who gave their number and did not finish. They already chose a product —
              a call is usually all that is missing.
            </p>
          </div>
        </Card>

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
              <LeadRow
                key={lead.id}
                lead={lead}
                busy={busy}
                onStatus={(status) =>
                  run(
                    () => adminApi.patch(`admin/abandoned/${lead.id}`, { status }),
                    status === "contacted" ? "Marked as called" : "Dismissed",
                  )
                }
                onNote={(note) =>
                  run(() => adminApi.patch(`admin/abandoned/${lead.id}`, { note }), "Note saved")
                }
                onDelete={() => {
                  if (!window.confirm(`Delete the record for ${lead.phone}?`)) return;
                  void run(
                    () => adminApi.delete(`admin/abandoned/${lead.id}`),
                    "Record deleted",
                  );
                }}
              />
            ))}
          </ul>
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

function LeadRow({
  lead,
  busy,
  onStatus,
  onNote,
  onDelete,
}: {
  lead: Lead;
  busy: boolean;
  onStatus: (status: "contacted" | "dismissed") => Promise<void>;
  onNote: (note: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(lead.note);
  const [editingNote, setEditingNote] = useState(false);

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border bg-white p-3",
        lead.recovered ? "border-line opacity-60" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The phone is the point of the page, so it is the biggest thing on
              the row and it dials on a tap. */}
          <a
            href={`tel:${lead.phone}`}
            className="tnum text-title font-semibold text-ink underline-offset-4 hover:underline"
          >
            {lead.phone}
          </a>

          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-muted">
            {lead.customerName ?? "No name given"}
            <span>· {sinceLabel(lead.lastSeenAt)}</span>
            {lead.recovered && <Badge tone="positive">Ordered</Badge>}
            {!lead.recovered && lead.status === "contacted" && <Badge tone="saleSoft">Called</Badge>}
            {!lead.recovered && lead.status === "dismissed" && <Badge tone="warn">Dismissed</Badge>}
          </p>

          {lead.areaText && (
            <p className="mt-0.5 truncate text-micro text-muted">
              {[lead.address, lead.areaText].filter(Boolean).join(", ")}
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="tnum text-body font-semibold text-ink">
            {formatTaka(lead.estimatedValue)}
          </p>
          <p className="text-micro text-muted">
            {lead.itemCount} item{lead.itemCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {lead.contents.length > 0 && (
        <ul className="flex flex-col gap-0.5 rounded-sm bg-surface px-3 py-2">
          {lead.contents.map((line, index) => (
            <li key={`${line.name}-${index}`} className="text-caption text-ink-soft">
              {line.name}
              {line.variantLabel && <span className="text-muted"> ({line.variantLabel})</span>}
              <span className="text-muted"> × {line.quantity}</span>
            </li>
          ))}
        </ul>
      )}

      {editingNote ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Note"
            value={note}
            placeholder="What did they say?"
            onChange={(event) => setNote(event.target.value)}
            wrapperClassName="flex-1 min-w-[200px]"
          />
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() => void onNote(note).then(() => setEditingNote(false))}
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditingNote(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        lead.note && <p className="text-caption text-muted">“{lead.note}”</p>
      )}

      {!lead.recovered && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || lead.status === "contacted"}
            onClick={() => void onStatus("contacted")}
          >
            <Icon name="phone" size={15} />
            {lead.status === "contacted" ? "Called" : "Mark called"}
          </Button>

          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingNote(true)}>
            {lead.note ? "Edit note" : "Add note"}
          </Button>

          <Button
            variant="soft"
            size="sm"
            disabled={busy || lead.status === "dismissed"}
            onClick={() => void onStatus("dismissed")}
          >
            Dismiss
          </Button>

          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete the record for ${lead.phone}`}
            className="ml-auto flex size-8 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale disabled:opacity-30"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}
    </li>
  );
}
