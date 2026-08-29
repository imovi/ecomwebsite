"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import type { ApiStoreSettings } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, SuccessBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Store settings.
 *
 * Delivery charges are the commercially significant field here: they are read
 * by the checkout quote endpoint on every pricing request, so a change takes
 * effect on the next quote — including for a customer part-way through
 * checkout. That is intentional (a stale charge would be collected at the door
 * by a rider who was told a different number) but worth stating.
 *
 * The API restricts writing to `admin` and above, so a manager sees the values
 * and gets a clear 403 on save rather than a silent no-op.
 */

interface CourierStatus {
  ready: boolean;
  problem: string | null;
  provider: string;
  credentialsConfigured: boolean;
  storeIdConfigured: boolean;
  enabled: boolean;
  openShipments: number;
  webhookConfigured: boolean;
  /** Built by the API from its own public address — see the courier routes. */
  webhookUrl: string;
}

export function SettingsForm() {
  const [settings, setSettings] = useState<ApiStoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [courierStatus, setCourierStatus] = useState<CourierStatus | null>(null);
  const [courierBusy, setCourierBusy] = useState(false);
  const [courierSaveError, setCourierSaveError] = useState<string | null>(null);
  const [courierResult, setCourierResult] = useState<{ ok: boolean; detail: string } | null>(
    null,
  );

  const [form, setForm] = useState({
    insideDhaka: "",
    outsideDhaka: "",
    freeDeliveryThreshold: "",
    minimumOrderValue: "",
    maxQuantityPerItem: "",
    couponMinCartValue: "",
    couponHours: "",
    courierInsideDhaka: "",
    courierOutsideDhaka: "",
    packagingPerOrder: "",
    returnPerOrder: "",
    name: "",
    phone: "",
    email: "",
    address: "",
    invoiceFooter: "",
    whatsapp: "",
    tagline: "",
    footerNote: "",
    orderNumberPrefix: "",
    seoTitle: "",
    seoDescription: "",
  });

  const hydrate = (data: ApiStoreSettings) => {
    setSettings(data);
    setForm({
      insideDhaka: String(data.delivery.insideDhaka),
      outsideDhaka: String(data.delivery.outsideDhaka),
      freeDeliveryThreshold: String(data.delivery.freeDeliveryThreshold),
      minimumOrderValue: String(data.ordering.minimumOrderValue),
      maxQuantityPerItem: String(data.ordering.maxQuantityPerItem),
      couponMinCartValue: String(data.recovery.couponMinCartValue),
      couponHours: String(data.recovery.couponHours),
      courierInsideDhaka: String(data.costs.courierInsideDhaka),
      courierOutsideDhaka: String(data.costs.courierOutsideDhaka),
      packagingPerOrder: String(data.costs.packagingPerOrder),
      returnPerOrder: String(data.costs.returnPerOrder),
      name: data.store.name,
      phone: data.store.phone,
      email: data.store.email,
      address: data.store.address,
      invoiceFooter: data.store.invoiceFooter,
      whatsapp: data.store.whatsapp,
      tagline: data.store.tagline,
      footerNote: data.store.footerNote,
      orderNumberPrefix: data.orderNumberPrefix,
      seoTitle: data.store.seoTitle,
      seoDescription: data.store.seoDescription,
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, courierData] = await Promise.all([
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.get<{ status: CourierStatus }>("admin/courier/status"),
      ]);
      hydrate(data.settings);
      setCourierStatus(courierData.status);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  /**
   * The courier lives in its own settings group rather than under the main
   * form, so it gets its own saver rather than a field threaded through the
   * shared one — the same reasoning that keeps it off a single Save button.
   */
  async function saveCourier(patch: Record<string, unknown>, message: string) {
    setCourierBusy(true);
    setCourierSaveError(null);
    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        courier: patch,
      });
      hydrate(data.settings);
      const courierData = await adminApi.get<{ status: CourierStatus }>("admin/courier/status");
      setCourierStatus(courierData.status);
      toast(message);
    } catch (caught) {
      setCourierSaveError(
        caught instanceof AdminApiError ? caught.message : "Could not save.",
      );
    } finally {
      setCourierBusy(false);
    }
  }

  async function testCourier() {
    setCourierBusy(true);
    setCourierSaveError(null);
    setCourierResult(null);
    try {
      const data = await adminApi.post<{ result: { ok: boolean; detail: string } }>(
        "admin/courier/test",
        {},
      );
      setCourierResult(data.result);
    } catch (caught) {
      setCourierSaveError(
        caught instanceof AdminApiError ? caught.message : "Could not test.",
      );
    } finally {
      setCourierBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        delivery: {
          insideDhaka: Number(form.insideDhaka),
          outsideDhaka: Number(form.outsideDhaka),
          freeDeliveryThreshold: Number(form.freeDeliveryThreshold),
        },
        ordering: {
          minimumOrderValue: Number(form.minimumOrderValue),
          maxQuantityPerItem: Number(form.maxQuantityPerItem),
        },
        recovery: {
          couponMinCartValue: Number(form.couponMinCartValue),
          couponHours: Number(form.couponHours),
        },
        costs: {
          courierInsideDhaka: Number(form.courierInsideDhaka),
          courierOutsideDhaka: Number(form.courierOutsideDhaka),
          packagingPerOrder: Number(form.packagingPerOrder),
          returnPerOrder: Number(form.returnPerOrder),
        },
        orderNumberPrefix: form.orderNumberPrefix.trim(),
        store: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          invoiceFooter: form.invoiceFooter.trim(),
          whatsapp: form.whatsapp.trim(),
          tagline: form.tagline.trim(),
          footerNote: form.footerNote.trim(),
          seoTitle: form.seoTitle.trim(),
          seoDescription: form.seoDescription.trim(),
        },
      });
      hydrate(data.settings);
      toast("Settings saved");
    } catch (caught) {
      setSaveError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Your account can view settings but not change them. Ask an owner account."
            : caught.message
          : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell title="Settings">
      <PageBody>
        <AsyncState loading={loading} error={error} onRetry={() => void load()}>
          {settings && (
            <>
              <ErrorBanner message={saveError} />

              <Card>
                <CardHeader
                  title="Delivery charges"
                  hint="Applied at checkout based on the area the customer enters."
                />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Input
                    label="Inside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.insideDhaka}
                    onChange={(event) => set("insideDhaka", event.target.value)}
                  />
                  <Input
                    label="Outside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.outsideDhaka}
                    onChange={(event) => set("outsideDhaka", event.target.value)}
                  />
                  <Input
                    label="Free delivery above (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.freeDeliveryThreshold}
                    onChange={(event) => set("freeDeliveryThreshold", event.target.value)}
                    hint="0 turns free delivery off."
                    wrapperClassName="sm:col-span-2"
                  />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="What an order costs you"
                  hint="Used by the profit page and nowhere else. Customers never see these."
                />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Input
                    label="Courier, inside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.courierInsideDhaka}
                    onChange={(event) => set("courierInsideDhaka", event.target.value)}
                    hint="What the courier bills you — not what you charge the customer."
                  />
                  <Input
                    label="Courier, outside Dhaka (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.courierOutsideDhaka}
                    onChange={(event) => set("courierOutsideDhaka", event.target.value)}
                  />
                  <Input
                    label="Packaging per parcel (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.packagingPerOrder}
                    onChange={(event) => set("packagingPerOrder", event.target.value)}
                    hint="Box, tape, bubble wrap, printed invoice."
                  />
                  <Input
                    label="Cost of a returned parcel (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.returnPerOrder}
                    onChange={(event) => set("returnPerOrder", event.target.value)}
                    hint="What it costs you when a customer refuses delivery."
                  />
                </div>
              </Card>

              {courierStatus && (
                <CourierCard
                  settings={settings}
                  status={courierStatus}
                  busy={courierBusy}
                  saveError={courierSaveError}
                  result={courierResult}
                  onSave={saveCourier}
                  onTest={testCourier}
                />
              )}

              {/* Its own card rather than a row inside "Order rules": these two
                  govern an offer the desk hands out by hand from the incomplete
                  checkouts page, not the rules every order obeys. Filing them
                  together would have an owner adjusting a minimum here and
                  wondering why the shop still took a small order. */}
              <Card>
                <CardHeader
                  title="Abandoned checkout offers"
                  hint="The free-delivery coupon the desk can send to someone who did not finish."
                />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Input
                    label="Smallest basket worth an offer (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.couponMinCartValue}
                    onChange={(event) => set("couponMinCartValue", event.target.value)}
                    hint="0 for no floor. The offer costs one delivery charge, so on a small basket it can eat most of the margin."
                  />
                  <Input
                    label="Offer lasts (hours)"
                    type="number"
                    min={1}
                    max={720}
                    step={1}
                    value={form.couponHours}
                    onChange={(event) => set("couponHours", event.target.value)}
                    hint="The deadline is what makes it work. A code with no end is a discount, not an offer."
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Order rules" />
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <Input
                    label="Minimum order value (৳)"
                    type="number"
                    min={0}
                    step={1}
                    value={form.minimumOrderValue}
                    onChange={(event) => set("minimumOrderValue", event.target.value)}
                    hint="0 for no minimum."
                  />
                  <Input
                    label="Max quantity per item"
                    type="number"
                    min={1}
                    step={1}
                    value={form.maxQuantityPerItem}
                    onChange={(event) => set("maxQuantityPerItem", event.target.value)}
                    hint="A low cap limits fake bulk orders."
                  />
                  <Input
                    label="Order number prefix"
                    value={form.orderNumberPrefix}
                    onChange={(event) => set("orderNumberPrefix", event.target.value)}
                    placeholder="HINAR-"
                    hint={`New orders will look like ${
                      form.orderNumberPrefix.trim().toUpperCase() || ""
                    }10043. Letters, numbers and dashes only. Leave blank for just the number.`}
                    wrapperClassName="sm:col-span-2"
                  />
                  {/* Said plainly, because the natural expectation is that this
                      renames everything — and finding out otherwise while
                      searching for an old order would read as data loss. */}
                  <p className="rounded-sm bg-surface px-3 py-2.5 text-micro text-muted sm:col-span-2">
                    Only new orders. Every order already placed keeps the number on its invoice —
                    it has been read out over the phone and typed into the courier&apos;s panel,
                    so changing it now would break both. Old numbers stay searchable.
                  </p>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Store details"
                  hint="Shown on invoices and in the storefront footer."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Store name"
                    value={form.name}
                    onChange={(event) => set("name", event.target.value)}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Phone"
                      value={form.phone}
                      inputMode="tel"
                      onChange={(event) => set("phone", event.target.value)}
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={form.email}
                      onChange={(event) => set("email", event.target.value)}
                    />
                  </div>
                  <Input
                    label="WhatsApp number"
                    value={form.whatsapp}
                    inputMode="tel"
                    placeholder="8801712345678"
                    onChange={(event) => set("whatsapp", event.target.value)}
                    hint="The floating chat button on the shop. Include the country code — 880 for Bangladesh. Leave blank to hide the button."
                  />
                  <Textarea
                    label="Address"
                    value={form.address}
                    rows={2}
                    onChange={(event) => set("address", event.target.value)}
                  />
                  <Textarea
                    label="Invoice footer"
                    value={form.invoiceFooter}
                    rows={2}
                    onChange={(event) => set("invoiceFooter", event.target.value)}
                    placeholder={`Thank you for shopping with ${form.name || "us"}.`}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Shop footer"
                  hint="The text at the bottom of every page on your shop."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Tagline"
                    value={form.tagline}
                    onChange={(event) => set("tagline", event.target.value)}
                    placeholder="Gadgets, delivered."
                    hint="The short line under your shop name in the footer. Also used after your shop name in the browser tab, unless you set a page title above. Leave blank for the built-in one."
                  />
                  <Textarea
                    label="Extra line"
                    value={form.footerNote}
                    rows={2}
                    onChange={(event) => set("footerNote", event.target.value)}
                    placeholder="Trade licence: 1234567890"
                    hint="Sits under the copyright line — a trade licence number, a BIN, or anything else you want on every page. Leave blank to show nothing."
                  />
                  {/* The rest of the footer is already live data. Said here
                      because the natural next question is "where do I edit the
                      other bits", and the answer is that they follow by
                      themselves. */}
                  <p className="rounded-sm bg-surface px-3 py-2.5 text-micro text-muted">
                    The shop name, phone number and copyright line in the footer come from
                    Store details above, and the category links update themselves as you add
                    categories.
                  </p>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Search and browser tab"
                  hint="What people read in a Google result and in the browser tab before they open your shop."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Page title"
                    value={form.seoTitle}
                    onChange={(event) => set("seoTitle", event.target.value)}
                    placeholder={`${form.name || "Your shop"} — ${form.tagline || "Gadgets, delivered."}`}
                    hint="Shown in the browser tab and as the blue line in Google. Around 60 characters reads best — longer gets cut off. Leave blank to use your shop name and the built-in tagline."
                  />
                  <Textarea
                    label="Description"
                    value={form.seoDescription}
                    rows={3}
                    onChange={(event) => set("seoDescription", event.target.value)}
                    placeholder="Buy original gadgets in Bangladesh. Cash on delivery nationwide."
                    hint="The sentence under the title in a search result. Around 150 characters. Leave blank to use the built-in one."
                  />
                  {/* Only the HOME page title is replaced. Said plainly because
                      the obvious expectation is that it applies everywhere, and
                      finding out otherwise later feels like a bug. */}
                  <p className="rounded-sm bg-surface px-3 py-2.5 text-micro text-muted">
                    This is the title for your home page. Product and category pages keep their
                    own names with your shop name after them, which is what keeps each one
                    findable on its own.
                  </p>
                </div>
              </Card>

              <Button
                variant="primary"
                size="lg"
                loading={saving}
                onClick={() => void save()}
                className="self-start 2xl:col-span-2 2xl:justify-self-start"
              >
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Courier hand-off.
 *
 * Paste a credential, prove it works, then switch it on — testing before
 * enabling is the order that matters. A courier switched on but misconfigured
 * fails at the exact moment somebody is trying to dispatch a parcel.
 */
function CourierCard({
  settings,
  status,
  busy,
  saveError,
  result,
  onSave,
  onTest,
}: {
  settings: ApiStoreSettings;
  status: CourierStatus;
  busy: boolean;
  saveError: string | null;
  result: { ok: boolean; detail: string } | null;
  onSave: (patch: Record<string, unknown>, message: string) => Promise<void>;
  onTest: () => Promise<void>;
}) {
  const [provider, setProvider] = useState(settings.courier.provider);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [storeId, setStoreId] = useState(settings.courier.storeId);

  const isPathao = provider === "pathao";

  return (
    <div className="flex flex-col gap-4">
      <Verdict
        ok={status.ready}
        label={status.ready ? "Courier: parcels can be sent" : "Courier: not connected yet"}
      />

      <Card>
        <CardHeader
          title="Courier"
          hint="Send parcels straight from an order, and let the courier tell you when it was delivered."
        />

        <div className="flex flex-col gap-4 p-4">
          <Steps
            steps={
              isPathao
                ? [
                    "In Pathao Merchant, open Developer API and create credentials.",
                    "Paste the Client ID and Client Secret below, plus your Store ID.",
                    "Press Test connection — it checks the store id too.",
                    "Turn it on, then send parcels from each order page.",
                  ]
                : [
                    "In the Steadfast merchant panel, open API and copy the Api Key and Secret Key.",
                    "Paste both below and save.",
                    "Press Test connection — it reads your balance back.",
                    "Turn it on, then send parcels from each order page.",
                  ]
            }
          />

          <Select
            label="Courier"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            hint="One at a time. Changing it does not affect parcels already sent."
          >
            <option value="">Not using a courier API</option>
            <option value="steadfast">Steadfast</option>
            <option value="pathao">Pathao</option>
          </Select>

          {settings.courier.hasCredentials && (
            <p className="flex items-center gap-2 rounded-sm bg-positive-soft px-3 py-2 text-caption text-positive">
              <Icon name="check" size={15} />
              Credentials saved ({settings.courier.apiKeyHint}).
            </p>
          )}

          {provider !== "" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={isPathao ? "Client ID" : "Api Key"}
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  hint="Leave blank to keep the saved one."
                />
                <Input
                  label={isPathao ? "Client Secret" : "Secret Key"}
                  type="password"
                  autoComplete="off"
                  value={apiSecret}
                  onChange={(event) => setApiSecret(event.target.value)}
                />
              </div>

              {isPathao && (
                <Input
                  label="Store ID"
                  value={storeId}
                  inputMode="numeric"
                  onChange={(event) => setStoreId(event.target.value.trim())}
                  hint="From Pathao Merchant → Stores. Parcels are dispatched from this store."
                />
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() =>
                void onSave(
                  {
                    provider,
                    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
                    ...(apiSecret.trim() ? { apiSecret: apiSecret.trim() } : {}),
                    ...(isPathao ? { storeId } : {}),
                  },
                  "Courier saved",
                ).then(() => {
                  setApiKey("");
                  setApiSecret("");
                })
              }
            >
              Save courier
            </Button>

            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!settings.courier.hasCredentials}
              onClick={() => void onTest()}
            >
              Test connection
            </Button>
          </div>

          <ErrorBanner message={saveError} />

          {result?.ok && <SuccessBanner message={result.detail} />}
          {result && !result.ok && <ErrorBanner message={result.detail} />}

          <label className="flex items-start gap-2.5 text-caption text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings.courier.enabled}
              onChange={(event) =>
                void onSave(
                  { enabled: event.target.checked },
                  event.target.checked ? "Courier on" : "Courier off",
                )
              }
            />
            <span>
              Allow parcels to be sent to this courier
              <span className="mt-0.5 block text-micro text-muted">
                Delivery status is then checked every 10 minutes, which is what marks orders
                delivered in your profit figures.
              </span>
            </span>
          </label>

          {status.openShipments > 0 && (
            <p className="text-micro text-muted">
              {status.openShipments} parcel{status.openShipments === 1 ? "" : "s"} still on the
              way.
            </p>
          )}
        </div>
      </Card>

      <WebhookCard
        configured={settings.courier.hasWebhookToken}
        hint={settings.courier.webhookTokenHint}
        callbackUrl={status.webhookUrl}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Instant delivery updates, instead of asking every ten minutes.
 *
 * Worth the extra setup for one reason: the profit report counts revenue from
 * the moment an order is marked delivered. Polling means "what did I earn
 * today" is answered with up to ten minutes of it still missing. A push lands
 * when the rider marks the parcel.
 *
 * The poll is deliberately kept as well. A webhook is a delivery nobody retries
 * forever — if the courier gives up while this server is restarting, that parcel
 * would sit in "on the way" until somebody noticed by eye.
 */
function WebhookCard({
  configured,
  hint,
  callbackUrl,
}: {
  configured: boolean;
  hint: string;
  /* Comes from the API, which is the only party that knows its own public
     address — the browser can only see the storefront's. */
  callbackUrl: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ configured: boolean; hint: string }>({
    configured,
    hint,
  });

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi.post<{ token: string }>("admin/courier/webhook-token", {});
      setToken(data.token);
      setStatus({ configured: true, hint: `••••${data.token.slice(-4)}` });
      toast("New webhook token generated");
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner or manager account can change the webhook."
            : caught.message
          : "Could not generate a token.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (
      !window.confirm(
        "Turn the webhook off? Delivery updates fall back to the ten-minute check.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await adminApi.delete("admin/courier/webhook-token");
      setToken(null);
      setStatus({ configured: false, hint: "" });
      toast("Webhook turned off");
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not turn it off.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Instant delivery updates (webhook)"
        hint="Lets the courier tell you the moment a parcel is delivered, instead of this shop asking every ten minutes."
      />
      <div className="flex flex-col gap-4 p-4">
        <Steps
          steps={[
            "Press Generate token below and copy the token — it is shown once.",
            "In the Steadfast panel open Webhook Integration (More → Webhook).",
            "Paste the Callback Url and the Auth Token, then press Save there.",
            "That is all — the next delivery updates this shop within seconds.",
          ]}
        />

        <div className="flex flex-col gap-1.5">
          <p className="text-caption font-medium text-ink-soft">Callback Url</p>
          <p className="tnum select-all break-all rounded-sm bg-surface px-3 py-2 font-mono text-micro text-ink">
            {callbackUrl}
          </p>
          <p className="text-micro text-muted">
            Paste this into Steadfast&apos;s Callback Url box. It must be reachable from the
            internet over https — if you changed the API address, use that one instead.
          </p>
        </div>

        {token ? (
          /* Shown once, on generation. This is the only moment it exists
             anywhere readable — the same rule the team passwords follow. */
          <div className="flex flex-col gap-1.5 rounded-sm bg-positive-soft px-3 py-2.5">
            <p className="flex items-center gap-2 text-caption font-semibold text-positive">
              <Icon name="check" size={15} />
              Auth Token — copy it now
            </p>
            <p className="tnum select-all break-all rounded-sm bg-white px-3 py-2 font-mono text-caption text-ink">
              {token}
            </p>
            <p className="text-micro text-positive">
              It is not shown again. Lost it? Generate a new one and update Steadfast.
            </p>
          </div>
        ) : status.configured ? (
          <p className="flex items-center gap-2 rounded-sm bg-positive-soft px-3 py-2 text-caption text-positive">
            <Icon name="check" size={15} />
            A token is saved ({status.hint}). Delivery updates arrive instantly.
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            No token yet, so the webhook is closed and ignores every call. Delivery status is
            still checked every ten minutes.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void rotate()}>
            {status.configured ? "Generate a new token" : "Generate token"}
          </Button>
          {status.configured && (
            <Button variant="danger" size="sm" loading={busy} onClick={() => void clear()}>
              Turn off
            </Button>
          )}
        </div>

        <ErrorBanner message={error} />

        <p className="text-micro text-muted">
          The ten-minute check stays on either way. A webhook nobody retries could be missed
          while this server restarts, and a parcel silently stuck on its way would cost more
          than the extra check does.
        </p>
      </div>
    </Card>
  );
}

function Verdict({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          ok
            ? "flex size-7 items-center justify-center rounded-full bg-positive-soft text-positive"
            : "flex size-7 items-center justify-center rounded-full bg-warn-soft text-warn"
        }
      >
        <Icon name={ok ? "check" : "alert"} size={16} />
      </span>
      <p className="text-body font-semibold text-ink">{label}</p>
    </div>
  );
}

/** Numbered setup steps — both of these have a fiddly external setup. */
function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-1 rounded-sm bg-surface px-3 py-2.5 pl-7">
      {steps.map((step) => (
        <li key={step} className="text-micro text-muted">
          {step}
        </li>
      ))}
    </ol>
  );
}
