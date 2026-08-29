"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { cn, formatTaka } from "@/lib/utils";
import { offerDeadline } from "@/lib/admin/whatsapp";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, TableWrap } from "./ui";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Every free-delivery code the shop has issued, and a way to make one more.
 *
 * WHY THIS EXISTS WHEN THE ABANDONED PAGE ALREADY MAKES COUPONS
 * That page makes them FOR A LEAD — somebody the shop is already chasing, whose
 * basket and number it knows. This one covers the case that had nowhere to go:
 * the desk is on the phone to a customer who was never in the call list, agrees
 * to free delivery, and needs a code in the next ten seconds.
 *
 * The coupon counts live here rather than on the recovery report. They were on
 * both for about an hour, which is how a shop ends up with two screens
 * disagreeing about how many offers it made. The report keeps what is uniquely
 * its own: how many leads came back, and by which route.
 */

type CouponState = "active" | "used" | "expired" | "cancelled";

interface Coupon {
  id: string;
  code: string;
  state: CouponState;
  cartValue: number;
  note: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  phone: string | null;
  orderNumber: string | null;
}

interface Totals {
  created: number;
  active: number;
  used: number;
  expired: number;
  cancelled: number;
  deliveryCost: number;
}

const FILTERS: { key: CouponState | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Running" },
  { key: "used", label: "Used" },
  { key: "expired", label: "Ran out" },
  { key: "cancelled", label: "Cancelled" },
];

const STATE_TONE: Record<CouponState, "positive" | "neutral" | "warn" | "saleSoft"> = {
  active: "positive",
  used: "neutral",
  expired: "warn",
  cancelled: "saleSoft",
};

const STATE_LABEL: Record<CouponState, string> = {
  active: "Running",
  used: "Used",
  expired: "Ran out",
  cancelled: "Cancelled",
};

export function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [filter, setFilter] = useState<CouponState | "all">("all");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [note, setNote] = useState("");
  /** The code just minted, held so it can be read out before the list redraws. */
  const [minted, setMinted] = useState<Coupon | null>(null);

  const query = filter === "all" ? "" : `?state=${filter}`;

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ coupons: Coupon[]; totals: Totals }>(
        `admin/coupons${query}`,
      );
      setCoupons(data.coupons);
      setTotals(data.totals);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the coupons.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useLoad(load);

  const create = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await adminApi.post<{ coupon: Coupon; created: boolean }>(
        "admin/coupons",
        note.trim() ? { note: note.trim() } : {},
      );
      setMinted(result.coupon);
      setNote("");
      toast("Coupon ready");
      await load();
    } catch (caught) {
      setActionError(caught instanceof AdminApiError ? caught.message : "Could not create it.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (coupon: Coupon) => {
    if (!window.confirm(`Withdraw ${coupon.code}? Anyone holding it will be refused.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminApi.delete(`admin/coupons/${coupon.id}`);
      toast("Coupon withdrawn");
      if (minted?.id === coupon.id) setMinted(null);
      await load();
    } catch (caught) {
      setActionError(caught instanceof AdminApiError ? caught.message : "Could not withdraw it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Coupons">
      <PageBody columns={false}>
        <ErrorBanner message={actionError} />

        <MakeOne
          note={note}
          setNote={setNote}
          busy={busy}
          minted={minted}
          onCreate={create}
          onCancel={cancel}
        />

        {totals && <Counts totals={totals} />}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => {
                setFilter(entry.key);
                setLoading(true);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-caption font-medium transition-colors",
                filter === entry.key
                  ? "bg-ink text-white"
                  : "bg-surface text-ink-soft hover:text-ink",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <AsyncState
          loading={loading}
          error={error}
          empty={coupons.length === 0}
          emptyMessage="No coupons here yet."
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          <Card>
            <TableWrap>
              <table className="w-full text-caption">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-4 py-2 font-medium">Code</th>
                    <th className="px-4 py-2 font-medium">For</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 font-medium">Runs out</th>
                    <th className="px-4 py-2 font-medium">Order</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => (
                    <tr key={coupon.id} className="border-b border-line last:border-0">
                      {/* Largest thing on the row, for the same reason the phone
                          number is largest on a lead card: it is what somebody
                          reads out or copies. */}
                      <td className="tnum px-4 py-2.5 text-body font-semibold tracking-wider text-ink">
                        {coupon.code}
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft">
                        {coupon.phone ? (
                          <span className="tnum">{coupon.phone}</span>
                        ) : coupon.note ? (
                          coupon.note
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={STATE_TONE[coupon.state]}>
                          {STATE_LABEL[coupon.state]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {offerDeadline(coupon.expiresAt)}
                      </td>
                      <td className="tnum px-4 py-2.5 text-muted">
                        {coupon.orderNumber ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {coupon.state === "active" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void cancel(coupon)}
                            className="text-caption text-muted underline-offset-4 hover:text-sale hover:underline disabled:opacity-40"
                          >
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

function MakeOne({
  note,
  setNote,
  busy,
  minted,
  onCreate,
  onCancel,
}: {
  note: string;
  setNote: (value: string) => void;
  busy: boolean;
  minted: Coupon | null;
  onCreate: () => Promise<void>;
  onCancel: (coupon: Coupon) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Make a coupon"
        hint="Free delivery, one use — for a customer who is not in the abandoned list"
      />

      <div className="p-4 pt-0">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Who is it for?"
            value={note}
            placeholder="Rahim — phone order"
            onChange={(event) => setNote(event.target.value)}
            hint="Optional, but the list is unreadable without it."
            wrapperClassName="flex-1 min-w-[220px]"
          />
          <Button variant="primary" loading={busy} onClick={() => void onCreate()}>
            <Icon name="plus" size={15} />
            Create
          </Button>
        </div>

        {/* Said plainly rather than left as a principle. The offer costs the
            same whatever the basket is worth, and here there is no basket for
            the minimum in Offer rules to measure — so nothing is stopping a
            code being spent on a 200-taka order. The owner should know that
            before they hand one out, not after. */}
        <p className="mt-3 rounded-sm bg-surface px-3 py-2 text-caption text-ink-soft">
          The smallest-basket rule under Abandoned → Offer rules does not apply to a coupon made
          here — there is no basket to measure. Whoever it goes to can spend it on an order of any
          size.
        </p>

        {minted && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-sm border border-positive-soft bg-positive-soft px-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-micro uppercase tracking-wide text-positive">Ready to give out</p>
              <p className="tnum text-title font-semibold tracking-wider text-ink">
                {minted.code}
              </p>
              <p className="text-micro text-muted">
                Runs out {offerDeadline(minted.expiresAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  /* Swallowed: the code is on screen and can be read. A toast
                     about a failed copy helps nobody select six characters. */
                  void navigator.clipboard
                    ?.writeText(minted.code)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                    .catch(() => undefined);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onCancel(minted)}>
                Withdraw
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function Counts({ totals }: { totals: Totals }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Made" value={String(totals.created)} />
      <Stat label="Running" value={String(totals.active)} tone="good" />
      <Stat label="Used" value={String(totals.used)} tone="good" />
      <Stat label="Ran out" value={String(totals.expired)} />
      <Stat label="Cancelled" value={String(totals.cancelled)} />
      {/* The only figure here that is money. The orders themselves say the
          delivery charge was zero — that is the point of the offer — so its
          cost appears nowhere else in the shop. */}
      <Stat
        label="Delivery paid for"
        value={formatTaka(totals.deliveryCost)}
        tone={totals.deliveryCost > 0 ? "warn" : "plain"}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "good" | "warn";
}) {
  return (
    <Card>
      <div className="flex flex-col gap-0.5 p-3">
        <span className="text-micro text-muted">{label}</span>
        <span
          className={cn(
            "tnum text-title font-semibold",
            tone === "good" && "text-positive",
            tone === "warn" && "text-warn",
            tone === "plain" && "text-ink",
          )}
        >
          {value}
        </span>
      </div>
    </Card>
  );
}
