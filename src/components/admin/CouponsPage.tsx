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
import { Input, Select } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Every free-delivery code the shop has issued, and a way to make one more.
 *
 * WHY THIS EXISTS WHEN THE ABANDONED PAGE ALREADY MAKES COUPONS
 * That page makes them FOR A LEAD — somebody the shop is already chasing, whose
 * basket and number it knows, on the shop's own default terms. This one is for
 * everything else: a code for a customer who was never in the call list, one
 * that lasts a week, one that twenty people can use, or one the owner named
 * themselves.
 *
 * The Abandoned page is deliberately not given these fields. An offer to a lead
 * is one use on the shop's default deadline, exactly as it was before any of
 * this existed, and the desk should not have four decisions to make while a
 * customer waits on the phone.
 */

type CouponState = "active" | "used" | "expired" | "cancelled";

interface CouponUse {
  orderNumber: string;
  deliverySaved: number;
  discountSaved?: number;
  at: string;
}

interface Coupon {
  id: string;
  code: string;
  state: CouponState;
  discountType: "free_delivery" | "fixed" | "percentage";
  discountValue: number;
  cartValue: number;
  note: string;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  phone: string | null;
  orderNumber: string | null;
  uses: CouponUse[];
}

interface Totals {
  created: number;
  active: number;
  used: number;
  expired: number;
  cancelled: number;
  redemptions: number;
  deliveryCost: number;
}

const FILTERS: { key: CouponState | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Running" },
  { key: "used", label: "Used up" },
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
  used: "Used up",
  expired: "Ran out",
  cancelled: "Cancelled",
};

/** "3 of 5", or "3 times" when there is no limit. */
function usesLabel(coupon: Coupon): string {
  if (coupon.maxUses === null) {
    return coupon.usedCount === 0
      ? "0 · no limit"
      : `${coupon.usedCount} · no limit`;
  }
  return `${coupon.usedCount} of ${coupon.maxUses}`;
}

export function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [filter, setFilter] = useState<CouponState | "all">("all");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const create = async (body: Record<string, unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await adminApi.post<{ coupon: Coupon; created: boolean }>(
        "admin/coupons",
        body,
      );
      setMinted(result.coupon);
      toast("Coupon ready");
      await load();
      return true;
    } catch (caught) {
      setActionError(caught instanceof AdminApiError ? caught.message : "Could not create it.");
      return false;
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

        <MakeOne busy={busy} minted={minted} onCreate={create} onCancel={cancel} />

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
                    <th className="px-4 py-2 font-medium">Discount</th>
                    <th className="px-4 py-2 font-medium">Note / purpose</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 text-right font-medium">Used</th>
                    <th className="px-4 py-2 font-medium">Runs out</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => (
                    <CouponRow
                      key={coupon.id}
                      coupon={coupon}
                      busy={busy}
                      onCancel={() => void cancel(coupon)}
                    />
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

function CouponRow({
  coupon,
  busy,
  onCancel,
}: {
  coupon: Coupon;
  busy: boolean;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-b border-line last:border-0">
        {/* Largest thing on the row, for the same reason the phone number is
            largest on a lead card: it is what somebody reads out or copies. */}
        <td className="tnum px-4 py-2.5 text-body font-semibold tracking-wider text-ink">
          {coupon.code}
        </td>
        <td className="px-4 py-2.5 font-medium">
          {coupon.discountType === "free_delivery" ? (
            <span className="text-positive">Free delivery</span>
          ) : coupon.discountType === "fixed" ? (
            <span className="text-ink">{formatTaka(coupon.discountValue)} off</span>
          ) : (
            <span className="text-ink">{coupon.discountValue}% off</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-ink-soft">
          {coupon.note || (coupon.phone ? <span className="tnum">{coupon.phone}</span> : null) || (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          <Badge tone={STATE_TONE[coupon.state]}>{STATE_LABEL[coupon.state]}</Badge>
        </td>
        <td className="tnum px-4 py-2.5 text-right">
          {coupon.usedCount > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="underline-offset-4 hover:underline"
              /* The count is the affordance: an owner asking "used how many
                 times" is one tap from "on which orders". */
              aria-expanded={open}
            >
              {usesLabel(coupon)}
            </button>
          ) : (
            <span className="text-muted">{usesLabel(coupon)}</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-muted">{offerDeadline(coupon.expiresAt)}</td>
        <td className="px-4 py-2.5 text-right">
          {coupon.state === "active" && (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="text-caption text-muted underline-offset-4 hover:text-sale hover:underline disabled:opacity-40"
            >
              Withdraw
            </button>
          )}
        </td>
      </tr>

      {open && coupon.uses.length > 0 && (
        <tr className="border-b border-line last:border-0">
          <td colSpan={7} className="bg-surface px-4 py-3">
            <p className="mb-1 text-micro uppercase tracking-wide text-muted">
              Spent on
            </p>
            <ul className="flex flex-col gap-1">
              {coupon.uses.map((use, index) => (
                <li
                  key={`${use.orderNumber}-${index}`}
                  className="flex flex-wrap justify-between gap-3 text-caption"
                >
                  <span className="tnum text-ink">{use.orderNumber || "order removed"}</span>
                  <span className="text-muted">
                    {offerDeadline(use.at)} · saved {formatTaka(use.deliverySaved + (use.discountSaved ?? 0))}
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function MakeOne({
  busy,
  minted,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  minted: Coupon | null;
  onCreate: (body: Record<string, unknown>) => Promise<boolean>;
  onCancel: (coupon: Coupon) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"free_delivery" | "fixed" | "percentage">("free_delivery");
  const [discountValue, setDiscountValue] = useState("100");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<"hours" | "days">("days");
  const [uses, setUses] = useState("1");
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    const hours = unit === "days" ? Number(amount) * 24 : Number(amount);

    const body: Record<string, unknown> = {
      discountType,
      ...(discountType !== "free_delivery" && Number(discountValue) > 0
        ? { discountValue: Math.round(Number(discountValue)) }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(code.trim() ? { code: code.trim() } : {}),
      ...(Number.isFinite(hours) && hours > 0 ? { validHours: Math.round(hours) } : {}),
      /* "unlimited" is sent as null rather than 0 or a huge number, so nothing
         downstream has to guess which large number meant "no limit". */
      maxUses: uses === "unlimited" ? null : Number(uses),
    };

    if (await onCreate(body)) {
      setNote("");
      setCode("");
    }
  };

  return (
    <Card>
      <CardHeader
        title="Make a coupon"
        hint="Free delivery or custom discount — on your own terms, for anyone, whether or not they are in the abandoned list"
      />

      <div className="p-4 pt-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            label="Note / purpose"
            value={note}
            placeholder="Eid campaign — Facebook post"
            onChange={(event) => setNote(event.target.value)}
            hint="What it is for. The list is unreadable without it."
          />

          <Input
            label="Code"
            value={code}
            placeholder="Leave blank for a random one"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            /* Same reason as the Campaign ID field: Chrome will happily fill
               the first text box on an admin page with an email address. */
            autoComplete="off"
            name="coupon-code"
            hint="Letters, numbers and dashes."
            className="tnum uppercase"
          />

          <Select
            label="Discount type"
            value={discountType}
            onChange={(event) =>
              setDiscountType(event.target.value as "free_delivery" | "fixed" | "percentage")
            }
            hint="Free delivery or custom amount."
          >
            <option value="free_delivery">Free delivery</option>
            <option value="fixed">Fixed discount (৳)</option>
            <option value="percentage">Percentage discount (%)</option>
          </Select>

          {discountType !== "free_delivery" && (
            <Input
              label={discountType === "fixed" ? "Discount amount (৳)" : "Discount percentage (%)"}
              type="number"
              min={1}
              max={discountType === "percentage" ? 100 : undefined}
              step={1}
              value={discountValue}
              onChange={(event) => setDiscountValue(event.target.value)}
              hint={
                discountType === "fixed"
                  ? "Amount in taka deducted from subtotal."
                  : "Percentage of subtotal deducted (1-100%)."
              }
            />
          )}

          <div className="flex items-end gap-2">
            <Input
              label="Lasts for"
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              wrapperClassName="flex-1"
              hint="The deadline is what makes an offer work."
            />
            <Select
              label=""
              aria-label="Hours or days"
              value={unit}
              onChange={(event) => setUnit(event.target.value as "hours" | "days")}
              wrapperClassName="w-[92px]"
            >
              <option value="hours">hours</option>
              <option value="days">days</option>
            </Select>
          </div>

          <Select
            label="How many times can it be used?"
            value={uses}
            onChange={(event) => setUses(event.target.value)}
            hint="One use is the safe default."
          >
            <option value="1">Once only</option>
            <option value="3">3 times</option>
            <option value="5">5 times</option>
            <option value="10">10 times</option>
            <option value="25">25 times</option>
            <option value="50">50 times</option>
            <option value="100">100 times</option>
            <option value="unlimited">No limit</option>
          </Select>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            <Icon name="plus" size={15} />
            Create
          </Button>

          {/* Said in money rather than left as a principle. Multiplied out,
              because a 50-use code is not one delivery charge — it is fifty,
              and that is the number worth seeing before pressing Create. */}
          <p className="text-caption text-muted">
            {discountType === "free_delivery"
              ? uses === "unlimited"
                ? "No limit means no ceiling on what this costs you. Give it a deadline you are comfortable with."
                : `Each use costs you one delivery charge — up to ${uses} of them.`
              : discountType === "fixed"
                ? `Each use deducts ৳${discountValue || 0} from the total — up to ${uses === "unlimited" ? "unlimited" : uses} uses.`
                : `Each use deducts ${discountValue || 0}% from the subtotal — up to ${uses === "unlimited" ? "unlimited" : uses} uses.`}
          </p>
        </div>

        <p className="mt-3 rounded-sm bg-surface px-3 py-2 text-caption text-ink-soft">
          The smallest-basket rule under Abandoned → Offer rules does not apply to a coupon made
          here — there is no basket to measure. Whoever holds it can spend it on an order of any
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
                {minted.discountType === "free_delivery"
                  ? "Free delivery"
                  : minted.discountType === "fixed"
                    ? `${formatTaka(minted.discountValue)} off`
                    : `${minted.discountValue}% off`}
                {" · "}
                {minted.maxUses === null ? "No use limit" : `Up to ${minted.maxUses} use${minted.maxUses === 1 ? "" : "s"}`}
                {" · runs out "}
                {offerDeadline(minted.expiresAt)}
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
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void onCancel(minted)}
              >
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
      {/* Times used, not coupons used. A ten-use code spent nine times has
          cost the shop nine deliveries and would read as "0 used" if this
          counted coupons. */}
      <Stat label="Times used" value={String(totals.redemptions)} tone="good" />
      <Stat label="Used up" value={String(totals.used)} />
      <Stat label="Ran out" value={String(totals.expired)} />
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
