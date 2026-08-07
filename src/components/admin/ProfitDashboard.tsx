"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import type { ApiProductListItem, ApiStoreSettings } from "@/lib/api/types";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, TableWrap } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Profit and loss.
 *
 * Built around one belief: an owner will act on a number they understand and
 * ignore one they do not. So the page states plainly what each figure is made
 * of, keeps money that has actually arrived separate from money that has only
 * been promised, and says out loud when part of the calculation is a guess. A
 * confident wrong number here would be worse than no page at all — it would be
 * acted on.
 */

type RangePreset = "today" | "yesterday" | "last7" | "last30" | "month" | "lifetime";

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
  { value: "month", label: "This month" },
  { value: "lifetime", label: "All time" },
];

interface ProductProfit {
  productId: string | null;
  productName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  revenueWithUnknownCost: number;
  unitsWithUnknownCost: number;
  /** Share of the shop-wide ad line, by revenue. An estimate. */
  estimatedAdSpend: number;
  /** Boosts recorded against this product. Measured, not inferred. */
  recordedAdSpend: number;
  /** Its share of the parcels it travelled in — courier plus boxing. */
  parcelCost: number;
  estimatedNetProfit: number;
  marginPercent: number | null;
}

interface ProfitReport {
  range: { from: string; to: string; preset: RangePreset | null };
  realised: {
    orderCount: number;
    revenue: number;
    costOfGoods: number;
    grossProfit: number;
    deliveryCharged: number;
    courierPaid: number;
    deliveryMargin: number;
    packaging: number;
    returns: { count: number; cost: number };
    expenses: { total: number; byCategory: Record<string, number> };
    /** Boosts recorded per product. Its own line — see the profit service. */
    productBoosts: number;
    netProfit: number;
    marginPercent: number | null;
  };
  inFlight: { orderCount: number; value: number; expectedGrossProfit: number };
  leaked: { cancelled: number; returned: number; returnCost: number; lostValue: number };
  coverage: {
    linesWithCost: number;
    linesWithoutCost: number;
    revenueWithUnknownCost: number;
    complete: boolean;
  };
  products: ProductProfit[];
}

interface Expense {
  id: string;
  category: string;
  amount: number;
  incurredOn: string;
  period: "day" | "month";
  note: string;
}

const CATEGORIES = [
  { value: "ads", label: "Ads" },
  { value: "rent", label: "Rent" },
  { value: "salary", label: "Salary" },
  { value: "packaging", label: "Packaging" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
];

/** Today in Dhaka, matching how the server dates a report. */
function shopToday(): string {
  return new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10);
}

export function ProfitDashboard() {
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  /* The two things that FEED the report, editable here rather than only on the
     pages they belong to. Finding out the margin is wrong and then hunting for
     the screen that fixes it is where an owner gives up on the feature. */
  const [settings, setSettings] = useState<ApiStoreSettings | null>(null);
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [preset, setPreset] = useState<RangePreset>("last7");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);

  const query = custom
    ? `?from=${custom.from}&to=${custom.to}`
    : `?preset=${preset}`;

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ report: ProfitReport }>(`admin/reports/profit${query}`);
      setReport(data.report);

      const [ledger, storeSettings, catalogue] = await Promise.all([
        adminApi.get<{ expenses: Expense[] }>(
          `admin/expenses?from=${data.report.range.from}&to=${data.report.range.to}`,
        ),
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.list<ApiProductListItem>("admin/products?perPage=100"),
      ]);

      setExpenses(ledger.expenses);
      setSettings(storeSettings.settings);
      setProducts(catalogue.items);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner or manager account can see the shop's profit."
            : caught.message
          : "Could not load the report.",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  /* `load` is rebuilt whenever the range changes, and useLoad re-runs on that
     identity change — so switching a chip refetches with no extra effect. */
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
      title="Profit"
      action={
        report && (
          <a
            href={`/api/admin/admin/reports/profit.csv${query}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line px-3 text-caption font-medium text-ink hover:bg-surface"
          >
            <Icon name="package" size={15} />
            Export
          </a>
        )
      }
    >
      <PageBody>
        <RangePicker
          className="2xl:col-span-2"
          preset={preset}
          custom={custom}
          onPreset={(value) => {
            setCustom(null);
            setPreset(value);
            setLoading(true);
          }}
          onCustom={(range) => {
            setCustom(range);
            setLoading(true);
          }}
        />

        <ErrorBanner message={actionError} className="2xl:col-span-2" />

        <AsyncState
          loading={loading}
          error={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          {report && (
            <>
              <Headline report={report} />
              {!report.coverage.complete && (
                <div className="2xl:col-span-2">
                  <CoverageWarning report={report} />
                </div>
              )}
              <Breakdown report={report} />
              <div className="2xl:col-span-2">
                <InFlightAndLeaked report={report} />
              </div>
              {settings && <CostSettingsCard settings={settings} busy={busy} onSave={run} />}
              <AdSpendEntry busy={busy} onSave={run} />
              <ProductBoostEntry products={products} busy={busy} onSave={run} />
              <BuyingPrices products={products} busy={busy} onSave={run} />
              <ExpenseLedger expenses={expenses} busy={busy} onRun={run} />
              <div className="2xl:col-span-2">
                <ProductTable report={report} />
              </div>
            </>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

function RangePicker({
  preset,
  custom,
  className,
  onPreset,
  onCustom,
}: {
  preset: RangePreset;
  custom: { from: string; to: string } | null;
  className?: string;
  onPreset: (value: RangePreset) => void;
  onCustom: (range: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(custom?.from ?? shopToday());
  const [to, setTo] = useState(custom?.to ?? shopToday());

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Wraps rather than scrolls, same as the range chips in ui.tsx: on a
          phone the later presets sat past the right edge of a strip that did
          not look scrollable. */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setOpen(false);
              onPreset(option.value);
            }}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-caption font-medium transition-colors",
              !custom && preset === option.value
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-caption font-medium transition-colors",
            custom ? "border-ink bg-ink text-white" : "border-line bg-white text-muted hover:text-ink",
          )}
        >
          {custom ? `${custom.from} → ${custom.to}` : "Pick dates"}
        </button>
      </div>

      {open && (
        <Card>
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Input
              label="From"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              wrapperClassName="w-[160px]"
            />
            <Input
              label="To"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              wrapperClassName="w-[160px]"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={from > to}
              onClick={() => {
                setOpen(false);
                onCustom({ from, to });
              }}
            >
              Show
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * The one number, and what it means.
 *
 * Net profit leads because it is the only figure that answers "am I making
 * money". Revenue is the number people reach for and the one that flatters.
 */
function Headline({ report }: { report: ProfitReport }) {
  const { netProfit, revenue, marginPercent, orderCount } = report.realised;
  const positive = netProfit >= 0;

  return (
    <Card>
      <div className="flex flex-col gap-1 p-4">
        <p className="text-micro uppercase tracking-wide text-muted">
          Net profit · {orderCount} order{orderCount === 1 ? "" : "s"} delivered
        </p>
        <p
          className={cn(
            "tnum text-[34px] font-semibold leading-tight",
            positive ? "text-positive" : "text-sale",
          )}
        >
          {formatTaka(netProfit)}
        </p>
        <p className="text-caption text-muted">
          on {formatTaka(revenue)} of delivered sales
          {marginPercent !== null && ` · ${marginPercent}% margin`}
        </p>
        {orderCount === 0 && (
          <p className="mt-1 text-micro text-muted">
            Nothing has been delivered in this period. Orders count towards profit when they
            reach the customer, not when they are placed.
          </p>
        )}
      </div>
    </Card>
  );
}

function CoverageWarning({ report }: { report: ProfitReport }) {
  return (
    <div className="flex gap-2.5 rounded-md border border-warn/30 bg-warn-soft px-4 py-3">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warn" />
      <div>
        <p className="text-caption font-medium text-ink">
          {formatTaka(report.coverage.revenueWithUnknownCost)} of these sales have no buying
          price recorded.
        </p>
        <p className="mt-0.5 text-micro text-muted">
          Those lines are counted as earning nothing, so the real profit is higher than what is
          shown here. Add a buying price on each product and future orders will be costed
          automatically.
        </p>
      </div>
    </div>
  );
}

/** Every line that turns revenue into net profit, in the order it is deducted. */
function Breakdown({ report }: { report: ProfitReport }) {
  const r = report.realised;

  /* Amounts stay positive and carry a `deduct` flag rather than a sign. A
     negated zero is `-0` in JavaScript, which is not `< 0`, so a sign test
     would render "৳-0" on every empty line of a quiet week. */
  const rows: { label: string; amount: number; hint?: string; deduct?: boolean }[] = [
    { label: "Sales delivered", amount: r.revenue },
    { label: "Cost of goods", amount: r.costOfGoods, deduct: true },
    { label: "Delivery charged to customers", amount: r.deliveryCharged },
    { label: "Paid to the courier", amount: r.courierPaid, deduct: true },
    { label: "Packaging", amount: r.packaging, deduct: true },
    {
      label: "Returns",
      amount: r.returns.cost,
      hint: `${r.returns.count} parcel${r.returns.count === 1 ? "" : "s"} came back`,
      deduct: true,
    },
    ...Object.entries(r.expenses.byCategory).map(([category, amount]) => ({
      label: CATEGORIES.find((c) => c.value === category)?.label ?? category,
      amount,
      deduct: true,
    })),
    /* Its own line rather than folded into the ads category above: this is the
       one advertising figure that was measured per product rather than shared
       out, and hiding that distinction is what the feature exists to avoid.
       Omitted entirely when nothing was recorded, so it does not add an empty
       row to every quiet week. */
    ...(r.productBoosts > 0
      ? [
          {
            label: "Product boosts",
            amount: r.productBoosts,
            hint: "Recorded per product, not shared out",
            deduct: true,
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader title="Where it went" />
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => (
          <li key={row.label} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <span className="text-caption text-ink">
              {row.label}
              {row.hint && <span className="ml-1.5 text-micro text-muted">{row.hint}</span>}
            </span>
            <span
              className={cn(
                "tnum shrink-0 text-caption font-medium",
                row.deduct ? "text-muted" : "text-ink",
              )}
            >
              {row.deduct ? `− ${formatTaka(row.amount)}` : formatTaka(row.amount)}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 bg-surface px-4 py-3">
          <span className="text-caption font-semibold text-ink">Net profit</span>
          <span
            className={cn(
              "tnum text-body font-semibold",
              r.netProfit >= 0 ? "text-positive" : "text-sale",
            )}
          >
            {formatTaka(r.netProfit)}
          </span>
        </li>
      </ul>

      {r.deliveryMargin < 0 && (
        <p className="border-t border-line px-4 py-2.5 text-micro text-muted">
          Delivery costs you {formatTaka(Math.abs(r.deliveryMargin))} more than you charge for
          it. That is the price of free or discounted delivery — worth it if it wins orders,
          worth knowing either way.
        </p>
      )}
    </Card>
  );
}

function InFlightAndLeaked({ report }: { report: ProfitReport }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card>
        <div className="flex flex-col gap-1 p-4">
          <p className="text-micro uppercase tracking-wide text-muted">On the way</p>
          <p className="tnum text-[22px] font-semibold text-ink">
            {formatTaka(report.inFlight.value)}
          </p>
          <p className="text-micro text-muted">
            {report.inFlight.orderCount} order{report.inFlight.orderCount === 1 ? "" : "s"} not
            yet delivered, worth about {formatTaka(report.inFlight.expectedGrossProfit)} in
            profit if they all arrive. Not counted above.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-1 p-4">
          <p className="text-micro uppercase tracking-wide text-muted">Lost</p>
          <p className="tnum text-[22px] font-semibold text-ink">
            {formatTaka(report.leaked.lostValue)}
          </p>
          <p className="text-micro text-muted">
            {report.leaked.cancelled} cancelled, {report.leaked.returned} returned. The ads and
            packaging behind them are spent either way.
          </p>
        </div>
      </Card>
    </div>
  );
}

/**
 * One field, one number, one day.
 *
 * Ad spend is the figure that has to be entered every day for the rest of the
 * page to mean anything, so it gets the shortest possible path: type, save.
 * Saving the same day twice corrects it rather than adding to it.
 */
/**
 * A day's boost budget for one product.
 *
 * The difference between this and the ads line beside it is the whole reason it
 * exists: the ledger's figure is shop-wide and gets split across products by
 * share of revenue, which is an inference — and its worst case is a product
 * selling BECAUSE it is boosted, which then gets charged in proportion to the
 * sales the boost created. A number entered here is measured, and the report
 * uses it directly for that product.
 */
function ProductBoostEntry({
  products,
  busy,
  onSave,
}: {
  products: ApiProductListItem[];
  busy: boolean;
  onSave: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [productId, setProductId] = useState("");
  const [date, setDate] = useState(shopToday());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const canSave = productId !== "" && amount.trim() !== "" && Number(amount) >= 0;

  return (
    <Card>
      <CardHeader
        title="Boost spend, per product"
        hint="What you spent boosting one product on one day. Exact, unlike the shared-out ads figure."
      />
      <div className="flex flex-col gap-4 p-4">
        <Select
          label="Product"
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
        >
          <option value="">Choose a product…</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </Select>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Day"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Input
            label="Amount (৳)"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>

        <Input
          label="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Facebook boost"
        />

        <Button
          variant="primary"
          size="sm"
          className="self-start"
          loading={busy}
          disabled={!canSave}
          onClick={() =>
            void onSave(
              () =>
                adminApi.put("admin/reports/boosts", {
                  productId,
                  spentOn: date,
                  amount: Number(amount),
                  ...(note.trim() ? { note: note.trim() } : {}),
                }),
              "Boost recorded",
            ).then(() => {
              setAmount("");
              setNote("");
            })
          }
        >
          Save boost
        </Button>

        {/* The one way to get this wrong, said where the mistake would be made
            rather than in a help page nobody opens. */}
        <p className="rounded-sm bg-warn-soft px-3 py-2 text-micro text-warn">
          Record a boost here <b>or</b> in the general ads expense — not both, or the same taka
          is counted twice. Entering the same product and day again corrects the figure rather
          than adding to it.
        </p>
      </div>
    </Card>
  );
}

function AdSpendEntry({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [date, setDate] = useState(shopToday());
  const [amount, setAmount] = useState("");

  return (
    <Card>
      <CardHeader
        title="Today's ad spend"
        hint="Enter it once a day. Saving the same date again corrects that day rather than adding to it."
      />
      <div className="flex flex-wrap items-end gap-3 p-4">
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          wrapperClassName="w-[160px]"
        />
        <Input
          label="Amount (৳)"
          type="number"
          inputMode="numeric"
          min={0}
          value={amount}
          placeholder="0"
          onChange={(event) => setAmount(event.target.value)}
          wrapperClassName="w-[140px]"
        />
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={amount.trim() === ""}
          onClick={() =>
            void onSave(
              () =>
                adminApi.put("admin/expenses/ad-spend", {
                  date,
                  amount: Number(amount),
                }),
              "Ad spend saved",
            ).then(() => setAmount(""))
          }
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

/**
 * The four per-order costs, editable here as well as in Settings.
 *
 * They belong in Settings — they are configuration, not a report. But they are
 * also three of the six lines in "Where it went" directly above, and an owner
 * who spots that the courier figure is wrong should be able to correct it in
 * the place they noticed, not go looking for the screen that owns it. Saving
 * reloads the report, so the numbers move under the change.
 */
function CostSettingsCard({
  settings,
  busy,
  onSave,
}: {
  settings: ApiStoreSettings;
  busy: boolean;
  onSave: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    courierInsideDhaka: String(settings.costs.courierInsideDhaka),
    courierOutsideDhaka: String(settings.costs.courierOutsideDhaka),
    packagingPerOrder: String(settings.costs.packagingPerOrder),
    returnPerOrder: String(settings.costs.returnPerOrder),
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <CardHeader
        title="What an order costs you"
        hint="Applied to every delivered order. Also in Settings — changing it here changes it everywhere."
      />
      <div className="flex flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Courier, inside Dhaka (৳)"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.courierInsideDhaka}
            onChange={(event) => set("courierInsideDhaka", event.target.value)}
            hint="What the courier bills you, not what you charge."
          />
          <Input
            label="Courier, outside Dhaka (৳)"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.courierOutsideDhaka}
            onChange={(event) => set("courierOutsideDhaka", event.target.value)}
          />
          <Input
            label="Packaging per parcel (৳)"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.packagingPerOrder}
            onChange={(event) => set("packagingPerOrder", event.target.value)}
          />
          <Input
            label="A returned parcel (৳)"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.returnPerOrder}
            onChange={(event) => set("returnPerOrder", event.target.value)}
          />
        </div>

        <Button
          variant="primary"
          size="sm"
          className="self-start"
          loading={busy}
          onClick={() =>
            void onSave(
              () =>
                adminApi.patch("admin/settings", {
                  costs: {
                    courierInsideDhaka: Number(form.courierInsideDhaka || 0),
                    courierOutsideDhaka: Number(form.courierOutsideDhaka || 0),
                    packagingPerOrder: Number(form.packagingPerOrder || 0),
                    returnPerOrder: Number(form.returnPerOrder || 0),
                  },
                }),
              "Costs updated",
            )
          }
        >
          Save costs
        </Button>
      </div>
    </Card>
  );
}

/**
 * Buying prices for the whole catalogue, in one list.
 *
 * This is the fastest way to make the report honest. The coverage warning at
 * the top says how much revenue has no cost behind it; this is where that gets
 * fixed, without opening each product in turn.
 *
 * Products with no price recorded sort first — they are the ones dragging the
 * figures down, and they are what someone opening this card came to deal with.
 *
 * Changing a price here affects FUTURE orders only. Past orders keep the cost
 * they were placed with, which is stated on the card because it is the one
 * thing about this screen that could otherwise surprise someone.
 */
function BuyingPrices({
  products,
  busy,
  onSave,
}: {
  products: ApiProductListItem[];
  busy: boolean;
  onSave: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (products.length === 0) return null;

  const missing = products.filter(
    (product) => product.costPrice === null || product.costPrice === undefined,
  );
  const sorted = [...missing, ...products.filter((product) => !missing.includes(product))];

  const valueFor = (product: ApiProductListItem) =>
    drafts[product.id] ?? (product.costPrice === null || product.costPrice === undefined
      ? ""
      : String(product.costPrice));

  return (
    <Card className="2xl:col-span-2">
      <CardHeader
        title="Buying prices"
        hint="What you pay for one of each. Applies to future orders — past ones keep the price they were bought at."
      />

      {missing.length > 0 && (
        <p className="border-b border-line bg-warn-soft px-4 py-2.5 text-caption text-warn">
          {missing.length} product{missing.length === 1 ? " has" : "s have"} no buying price, so
          {missing.length === 1 ? " it counts" : " they count"} as earning nothing in the figures
          above.
        </p>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {sorted.map((product) => {
          const draft = valueFor(product);
          const stored =
            product.costPrice === null || product.costPrice === undefined
              ? ""
              : String(product.costPrice);
          const changed = draft !== stored;
          const margin =
            draft.trim() !== "" && product.price > 0
              ? Math.round(((product.price - Number(draft)) / product.price) * 100)
              : null;

          return (
            <li key={product.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-[160px] flex-1">
                <p className="text-caption text-ink">{product.name}</p>
                <p className="text-micro text-muted">
                  Sells for {formatTaka(product.price)}
                  {margin !== null && (
                    <span className={cn("ml-1.5", margin < 0 ? "text-sale" : "text-muted")}>
                      · {margin}% margin
                    </span>
                  )}
                </p>
              </div>

              <Input
                label=""
                aria-label={`Buying price for ${product.name}`}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="Not set"
                value={draft}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [product.id]: event.target.value }))
                }
                wrapperClassName="w-[120px]"
                className="h-9 text-caption"
              />

              <Button
                variant={changed ? "primary" : "soft"}
                size="sm"
                disabled={busy || !changed}
                onClick={() =>
                  void onSave(
                    () =>
                      adminApi.patch(`admin/products/${product.id}`, {
                        /* Blank means "not recorded", which is a different fact
                           from zero and reported differently. */
                        costPrice: draft.trim() === "" ? null : Number(draft),
                      }),
                    "Buying price saved",
                  ).then(() =>
                    setDrafts((current) => {
                      const next = { ...current };
                      delete next[product.id];
                      return next;
                    }),
                  )
                }
              >
                Save
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ExpenseLedger({
  expenses,
  busy,
  onRun,
}: {
  expenses: Expense[];
  busy: boolean;
  onRun: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState("other");
  const [amount, setAmount] = useState("");
  const [incurredOn, setIncurredOn] = useState(shopToday());
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [note, setNote] = useState("");

  return (
    <Card>
      <CardHeader
        title="Other costs"
        hint="Rent, salaries, a bulk packaging order. Anything you spend that does not travel with a parcel."
      />

      <div className="flex flex-col gap-3 p-4">
        {expenses.length === 0 ? (
          <p className="text-caption text-muted">Nothing recorded in this period.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-caption text-ink">
                    {CATEGORIES.find((c) => c.value === expense.category)?.label ??
                      expense.category}
                    {expense.note && <span className="text-muted"> · {expense.note}</span>}
                  </p>
                  <p className="text-micro text-muted">
                    {expense.incurredOn}
                    {expense.period === "month" && " · spread across the month"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tnum text-caption font-medium text-ink">
                    {formatTaka(expense.amount)}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Delete ${expense.category} expense`}
                    onClick={() =>
                      void onRun(
                        () => adminApi.delete(`admin/expenses/${expense.id}`),
                        "Expense deleted",
                      )
                    }
                    className="flex size-7 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale disabled:opacity-30"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="flex flex-col gap-3 rounded-sm bg-surface p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="What"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                wrapperClassName="w-[150px]"
              >
                {CATEGORIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Input
                label="Amount (৳)"
                type="number"
                inputMode="numeric"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                wrapperClassName="w-[130px]"
              />
              <Input
                label="Date"
                type="date"
                value={incurredOn}
                onChange={(event) => setIncurredOn(event.target.value)}
                wrapperClassName="w-[160px]"
              />
              <Select
                label="Covers"
                value={period}
                onChange={(event) => setPeriod(event.target.value as "day" | "month")}
                wrapperClassName="w-[180px]"
                hint={
                  period === "month"
                    ? "Split evenly across the month, so a 7-day view carries a week of it."
                    : "Spent on this one day."
                }
              >
                <option value="day">That day</option>
                <option value="month">The whole month</option>
              </Select>
            </div>

            <Input
              label="Note"
              value={note}
              placeholder="Optional"
              onChange={(event) => setNote(event.target.value)}
            />

            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                disabled={amount.trim() === "" || Number(amount) < 1}
                onClick={() =>
                  void onRun(
                    () =>
                      adminApi.post("admin/expenses", {
                        category,
                        amount: Number(amount),
                        incurredOn,
                        period,
                        ...(note.trim() ? { note: note.trim() } : {}),
                      }),
                    "Cost recorded",
                  ).then(() => {
                    setAmount("");
                    setNote("");
                    setAdding(false);
                  })
                }
              >
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="soft" size="sm" className="self-start" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            Add a cost
          </Button>
        )}
      </div>
    </Card>
  );
}

function ProductTable({ report }: { report: ProfitReport }) {
  if (report.products.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="By product"
        hint="Ads are shared out by each product's share of sales — an estimate, unless you run one campaign per product."
      />
      <div className="p-4">
        <TableWrap>
          <table className="w-full text-caption">
            <thead>
              <tr className="border-b border-line text-left text-micro uppercase tracking-wide text-muted">
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 text-right font-medium">Sold</th>
                <th className="pb-2 text-right font-medium">Sales</th>
                <th className="pb-2 text-right font-medium">Cost</th>
                <th className="pb-2 text-right font-medium">Ship + box</th>
                <th className="pb-2 text-right font-medium">Boost</th>
                <th className="pb-2 text-right font-medium">Ad share</th>
                <th className="pb-2 text-right font-medium">Profit</th>
                <th className="pb-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.products.map((product) => (
                <tr key={`${product.productId ?? "gone"}-${product.productName}`}>
                  <td className="py-2.5 pr-3 text-ink">
                    {product.productName}
                    {product.unitsWithUnknownCost > 0 && (
                      <span className="ml-1.5 text-micro text-warn">no buying price</span>
                    )}
                  </td>
                  <td className="tnum py-2.5 text-right text-muted">{product.unitsSold}</td>
                  <td className="tnum py-2.5 text-right text-ink">
                    {formatTaka(product.revenue)}
                  </td>
                  <td className="tnum py-2.5 text-right text-muted">
                    {formatTaka(product.cost)}
                  </td>
                  <td className="tnum py-2.5 text-right text-muted">
                    {formatTaka(product.parcelCost)}
                  </td>
                  {/* Measured, so it reads darker than the estimate beside it. */}
                  <td className="tnum py-2.5 text-right text-ink-soft">
                    {product.recordedAdSpend > 0 ? formatTaka(product.recordedAdSpend) : "—"}
                  </td>
                  <td className="tnum py-2.5 text-right text-muted">
                    {formatTaka(product.estimatedAdSpend)}
                  </td>
                  <td
                    className={cn(
                      "tnum py-2.5 text-right font-medium",
                      product.estimatedNetProfit >= 0 ? "text-ink" : "text-sale",
                    )}
                  >
                    {formatTaka(product.estimatedNetProfit)}
                  </td>
                  <td className="tnum py-2.5 text-right text-muted">
                    {product.marginPercent === null ? "—" : `${product.marginPercent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
    </Card>
  );
}
