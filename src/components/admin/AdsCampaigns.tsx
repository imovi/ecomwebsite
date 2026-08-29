"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { cn, formatTaka } from "@/lib/utils";
import type { ApiProductListItem } from "@/lib/api/types";
import { Card, CardHeader, ErrorBanner, TableWrap } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * The campaigns the shop is running, and what each one actually returned.
 *
 * WHY THE CONNECTION SETTINGS LIVE HERE
 * Ads Manager credentials could sit under Settings with everything else. They
 * are here because this is the screen where their absence is noticed: an owner
 * looking at an empty spend column wants to fix it now, not go hunting for
 * which of nine settings tabs holds the token. Marketing keeps the Conversions
 * API token — that one writes events, this one reads spend, and they are
 * revoked separately.
 *
 * WHY THE EXCHANGE RATE IS TYPED IN
 * Meta bills in dollars; everything else in this system is taka. A live rate
 * would restate last month's ad spend every time the market moved, so the
 * report an owner read on Monday would disagree with itself on Friday. They
 * enter what they were actually charged at.
 */

interface AdsSettings {
  adAccountId: string;
  hasToken: boolean;
  tokenHint: string;
  usdRatePaisa: number;
}

interface CampaignInsights {
  spend: number;
  spendRaw: number;
  currency: string;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  purchases: number;
}

interface CampaignRow {
  campaign: {
    id: string;
    metaId: string;
    label: string;
    productId: string | null;
    productName: string | null;
    isActive: boolean;
  };
  name: string | null;
  status: string | null;
  insights: CampaignInsights | null;
  problem: string | null;
  delivered: {
    placed: number;
    delivered: number;
    settled: number;
    deliveredValue: number;
    deliveryRatePercent: number | null;
    trueRoas: number | null;
    metaRoas: number | null;
    costPerDelivered: number | null;
  } | null;
}

interface AdsOverview {
  configured: boolean;
  usdRatePaisa: number;
  campaigns: CampaignRow[];
  totals: { spend: number; deliveredValue: number; trueRoas: number | null; metaPurchases: number };
  problem: string | null;
}

/** Below this a campaign is losing money on every parcel it produces. */
const BREAK_EVEN_ROAS = 1;

export function AdsCampaigns({ query }: { query: string }) {
  const [overview, setOverview] = useState<AdsOverview | null>(null);
  const [settings, setSettings] = useState<AdsSettings | null>(null);
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, stored, catalogue] = await Promise.all([
        adminApi.get<{ overview: AdsOverview }>(`admin/ads/overview${query}`),
        adminApi.get<{ settings: { ads: AdsSettings } }>("admin/settings"),
        adminApi.list<ApiProductListItem>("admin/products?perPage=100"),
      ]);
      setOverview(data.overview);
      setSettings(stored.settings.ads);
      setProducts(catalogue.items);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not load the campaigns.",
      );
    } finally {
      setLoading(false);
    }
  }, [query]);

  useLoad(load);

  const run = useCallback(
    async (action: () => Promise<unknown>, message: string) => {
      setBusy(true);
      try {
        await action();
        await load();
        toast(message, { tone: "positive" });
        return true;
      } catch (caught) {
        toast(
          caught instanceof AdminApiError ? caught.message : "That did not work.",
          { tone: "error" },
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (loading) return <div className="h-40 animate-pulse rounded-md bg-surface" />;

  return (
    <Card>
      <CardHeader
        title="Campaigns"
        hint="What Meta charged, against what the shop actually delivered"
      />

      <div className="flex flex-col gap-4 p-4 pt-0">
        {error && <ErrorBanner message={error} />}

        {overview && !overview.configured && (
          <Notice
            tone="warn"
            title="Meta is not connected yet."
            body="Add the ad account and an ads_read token below and the spend column fills in. Everything else on this page works without it."
          />
        )}

        {overview?.configured && overview.problem && (
          <Notice tone="warn" title="Meta could not be read." body={overview.problem} />
        )}

        {overview?.configured && overview.usdRatePaisa === 0 && (
          <Notice
            tone="warn"
            title="No dollar rate set."
            body="Meta bills in dollars. Until a rate is entered, spend cannot be shown in taka and every return below stays blank."
          />
        )}

        {overview && overview.campaigns.length > 0 && (
          <Totals overview={overview} />
        )}

        {overview && overview.campaigns.length === 0 ? (
          <p className="text-caption text-muted">
            No campaigns yet. Paste a Campaign ID from Ads Manager below — one per campaign you
            are running.
          </p>
        ) : (
          <TableWrap>
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 text-right font-medium">Spent</th>
                  <th className="px-3 py-2 text-right font-medium">Delivered</th>
                  <th className="px-3 py-2 text-right font-medium">Earned</th>
                  <th className="px-3 py-2 text-right font-medium">Return</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {overview?.campaigns.map((row) => (
                  <CampaignRowView
                    key={row.campaign.id}
                    row={row}
                    expanded={open === row.campaign.id}
                    busy={busy}
                    onToggle={() =>
                      setOpen((current) => (current === row.campaign.id ? null : row.campaign.id))
                    }
                    onPause={() =>
                      void run(
                        () =>
                          adminApi.patch(`admin/ads/campaigns/${row.campaign.id}`, {
                            isActive: !row.campaign.isActive,
                          }),
                        row.campaign.isActive ? "Campaign paused" : "Campaign resumed",
                      )
                    }
                    onDelete={() => {
                      if (
                        !window.confirm(
                          `Remove ${row.campaign.label || row.campaign.metaId} from this list? The campaign itself is not touched.`,
                        )
                      ) {
                        return;
                      }
                      void run(
                        () => adminApi.delete(`admin/ads/campaigns/${row.campaign.id}`),
                        "Campaign removed",
                      );
                    }}
                  />
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}

        <AddCampaign
          products={products}
          busy={busy}
          onAdd={(input) =>
            run(() => adminApi.post("admin/ads/campaigns", input), "Campaign added")
          }
        />

        <div className="border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setSetupOpen((value) => !value)}
            className="flex items-center gap-1.5 text-caption font-medium text-muted transition-colors hover:text-ink"
          >
            <Icon name={setupOpen ? "chevronDown" : "chevronRight"} size={14} />
            Meta connection
            {settings?.hasToken && (
              <span className="text-micro text-muted">· token {settings.tokenHint}</span>
            )}
          </button>

          {setupOpen && settings && (
            <Connection
              settings={settings}
              busy={busy}
              onSave={(ads) =>
                run(() => adminApi.patch("admin/settings", { ads }), "Meta connection saved")
              }
              onTest={async () => {
                try {
                  const result = await adminApi.post<{
                    account: { name: string; currency: string; timezone: string };
                  }>("admin/ads/test", {});
                  toast(
                    `Connected to ${result.account.name || "the ad account"} (${result.account.currency})`,
                    { tone: "positive" },
                  );
                } catch (caught) {
                  toast(
                    caught instanceof AdminApiError ? caught.message : "Could not reach Meta.",
                    { tone: "error" },
                  );
                }
              }}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function Totals({ overview }: { overview: AdsOverview }) {
  const profitable = overview.totals.trueRoas !== null && overview.totals.trueRoas >= BREAK_EVEN_ROAS;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Figure label="Spent on ads" value={formatTaka(overview.totals.spend)} />
      <Figure label="Delivered from those products" value={formatTaka(overview.totals.deliveredValue)} />
      <Figure
        label="Return"
        value={overview.totals.trueRoas === null ? "—" : `${overview.totals.trueRoas.toFixed(2)}×`}
        tone={overview.totals.trueRoas === null ? "plain" : profitable ? "good" : "bad"}
      />
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "good" | "bad";
}) {
  return (
    <div className="rounded-sm border border-line px-3 py-2">
      <p className="text-micro text-muted">{label}</p>
      <p
        className={cn(
          "tnum text-body font-semibold",
          tone === "good" && "text-positive",
          tone === "bad" && "text-sale",
          tone === "plain" && "text-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function CampaignRowView({
  row,
  expanded,
  busy,
  onToggle,
  onPause,
  onDelete,
}: {
  row: CampaignRow;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const { campaign, insights, delivered } = row;
  const losing = delivered?.trueRoas !== null && (delivered?.trueRoas ?? 0) < BREAK_EVEN_ROAS;

  return (
    <>
      <tr
        className={cn(
          "border-b border-line last:border-0",
          !campaign.isActive && "opacity-55",
          expanded && "bg-surface",
        )}
      >
        <td className="px-3 py-2.5">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-start gap-1.5 text-left"
            aria-expanded={expanded}
          >
            <Icon
              name={expanded ? "chevronDown" : "chevronRight"}
              size={14}
              className="mt-0.5 shrink-0 text-muted"
            />
            <span className="flex flex-col">
              <span className="font-medium text-ink">
                {campaign.label || row.name || campaign.metaId}
              </span>
              <span className="tnum text-micro text-muted">
                {campaign.metaId}
                {campaign.productName && ` · ${campaign.productName}`}
                {!campaign.isActive && " · paused"}
              </span>
            </span>
          </button>
        </td>
        <td className="tnum px-3 py-2.5 text-right">
          {insights ? formatTaka(insights.spend) : "—"}
        </td>
        <td className="tnum px-3 py-2.5 text-right">{delivered ? delivered.delivered : "—"}</td>
        <td className="tnum px-3 py-2.5 text-right">
          {delivered ? formatTaka(delivered.deliveredValue) : "—"}
        </td>
        <td
          className={cn(
            "tnum px-3 py-2.5 text-right font-semibold",
            delivered?.trueRoas == null ? "text-muted" : losing ? "text-sale" : "text-ink",
          )}
        >
          {delivered?.trueRoas == null ? "—" : `${delivered.trueRoas.toFixed(2)}×`}
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" disabled={busy} onClick={onPause}>
              {campaign.isActive ? "Pause" : "Resume"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
              <Icon name="trash" size={15} />
            </Button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-line bg-surface last:border-0">
          <td colSpan={6} className="px-3 pb-4">
            <CampaignDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * One campaign in full: what Meta measured, and what the shop's own orders say.
 *
 * The two halves are kept visibly apart. Meta's purchases and the shop's
 * deliveries are different counts of different things, and a table that mixed
 * them into one row would invite the reader to treat the larger one as the
 * truth.
 */
function CampaignDetail({ row }: { row: CampaignRow }) {
  const { insights, delivered, campaign, problem } = row;

  if (problem) {
    return <Notice tone="warn" title="Meta could not be read for this campaign." body={problem} />;
  }

  return (
    <div className="grid gap-4 pt-1 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted">
          What Meta measured
        </p>
        {insights ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-caption sm:grid-cols-3">
            <Stat label="Spent" value={formatTaka(insights.spend)} />
            <Stat
              label="In dollars"
              value={insights.spendRaw > 0 ? `${insights.spendRaw.toFixed(2)} ${insights.currency}` : "—"}
            />
            <Stat label="Reach" value={insights.reach.toLocaleString()} />
            <Stat label="Impressions" value={insights.impressions.toLocaleString()} />
            <Stat label="Link clicks" value={insights.linkClicks.toLocaleString()} />
            <Stat label="CTR" value={insights.ctr === null ? "—" : `${insights.ctr}%`} />
            <Stat label="Cost per click" value={insights.cpc === null ? "—" : formatTaka(insights.cpc)} />
            <Stat
              label="Per 1,000 views"
              value={insights.cpm === null ? "—" : formatTaka(insights.cpm)}
            />
            <Stat
              label="Frequency"
              value={insights.frequency === null ? "—" : `${insights.frequency}×`}
            />
            <Stat label="Purchases Meta counted" value={String(insights.purchases)} />
          </dl>
        ) : (
          <p className="text-caption text-muted">Not connected to Meta yet.</p>
        )}
      </div>

      <div>
        <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted">
          What actually happened
        </p>
        {delivered ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-caption sm:grid-cols-3">
              <Stat label="Orders placed" value={String(delivered.placed)} />
              <Stat label="Delivered" value={String(delivered.delivered)} />
              <Stat
                label="Delivery rate"
                value={
                  delivered.deliveryRatePercent === null
                    ? "—"
                    : `${delivered.deliveryRatePercent}%`
                }
              />
              <Stat label="Earned" value={formatTaka(delivered.deliveredValue)} />
              <Stat
                label="Cost per delivered"
                value={
                  delivered.costPerDelivered === null
                    ? "—"
                    : formatTaka(delivered.costPerDelivered)
                }
              />
              <Stat
                label="Meta would say"
                value={delivered.metaRoas === null ? "—" : `${delivered.metaRoas.toFixed(2)}×`}
              />
            </dl>
            <p className="mt-2 text-micro text-muted">
              Counted from {campaign.productName}&apos;s own orders in this range. Meta cannot see
              which of its purchases were refused at the door; this can.
            </p>
          </>
        ) : (
          <p className="text-caption text-muted">
            No product linked, so there is nothing to compare Meta&apos;s numbers against. Add one
            below and this fills in.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-micro text-muted">{label}</dt>
      <dd className="tnum font-medium text-ink">{value}</dd>
    </div>
  );
}

function AddCampaign({
  products,
  busy,
  onAdd,
}: {
  products: ApiProductListItem[];
  busy: boolean;
  onAdd: (input: { metaId: string; label?: string; productId?: string | null }) => Promise<boolean>;
}) {
  const [metaId, setMetaId] = useState("");
  const [label, setLabel] = useState("");
  const [productId, setProductId] = useState("");

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-sm border border-line p-3">
      <Input
        label="Campaign ID"
        placeholder="120210000000123456"
        value={metaId}
        onChange={(event) => setMetaId(event.target.value)}
        wrapperClassName="w-[210px]"
      />
      <Input
        label="Name it"
        placeholder="Lamp — cold traffic"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        wrapperClassName="w-[190px]"
      />
      <Select
        label="Selling which product"
        value={productId}
        onChange={(event) => setProductId(event.target.value)}
        wrapperClassName="w-[210px]"
      >
        <option value="">Not one product</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </Select>
      <Button
        variant="primary"
        size="sm"
        disabled={busy || metaId.trim() === ""}
        onClick={async () => {
          const added = await onAdd({
            metaId: metaId.trim(),
            ...(label.trim() ? { label: label.trim() } : {}),
            ...(productId ? { productId } : {}),
          });
          if (added) {
            setMetaId("");
            setLabel("");
            setProductId("");
          }
        }}
      >
        Add
      </Button>
      <p className="w-full text-micro text-muted">
        Ads Manager → the campaign → the ID under its name. Pasting the whole URL works too. Link
        a product and this page can tell you what the campaign actually earned.
      </p>
    </div>
  );
}

function Connection({
  settings,
  busy,
  onSave,
  onTest,
}: {
  settings: AdsSettings;
  busy: boolean;
  onSave: (ads: { adAccountId?: string; token?: string | null; usdRate?: number }) => Promise<boolean>;
  onTest: () => Promise<void>;
}) {
  const [adAccountId, setAdAccountId] = useState(settings.adAccountId);
  const [token, setToken] = useState("");
  const [rate, setRate] = useState(
    settings.usdRatePaisa > 0 ? (settings.usdRatePaisa / 100).toFixed(2) : "",
  );

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Ad account ID"
          placeholder="act_1234567890"
          value={adAccountId}
          onChange={(event) => setAdAccountId(event.target.value)}
          wrapperClassName="w-[200px]"
        />
        <Input
          label={settings.hasToken ? "Replace token" : "Access token"}
          type="password"
          placeholder={settings.hasToken ? settings.tokenHint : "EAA…"}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          wrapperClassName="w-[240px]"
        />
        <Input
          label="Taka per dollar"
          type="number"
          step="0.01"
          placeholder="122.50"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          wrapperClassName="w-[150px]"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={async () => {
            const saved = await onSave({
              adAccountId: adAccountId.trim(),
              ...(token.trim() ? { token: token.trim() } : {}),
              ...(rate.trim() ? { usdRate: Number(rate) } : {}),
            });
            if (saved) setToken("");
          }}
        >
          Save
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void onTest()}>
          Test
        </Button>
      </div>

      <p className="text-micro text-muted">
        The token needs <strong>ads_read</strong>, and it is a more powerful credential than the
        Conversions API one under Marketing — it can see every campaign this account has ever run.
        It is stored on the server and never sent back to this screen; only the last four
        characters are shown. The rate is what your card was actually charged at, not today&apos;s
        market rate.
      </p>
    </div>
  );
}

function Notice({
  tone,
  title,
  body,
}: {
  tone: "warn" | "plain";
  title: string;
  body: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-sm border p-3 text-caption",
        tone === "warn" ? "border-warn/30 bg-warn/5" : "border-line bg-surface",
      )}
    >
      <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-warn" />
      <span>
        <strong className="text-ink">{title}</strong> <span className="text-muted">{body}</span>
      </span>
    </div>
  );
}
