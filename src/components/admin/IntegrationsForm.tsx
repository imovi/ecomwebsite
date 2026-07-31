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
 * Order integrations — Telegram alerts and the Google Sheets export.
 *
 * Both follow the same shape as the tracking page: paste a credential, prove it
 * works with a test button, then switch it on. Testing before enabling is the
 * order that matters — an integration switched on but misconfigured fails
 * silently at the exact moment an order arrives.
 */

interface IntegrationStatus {
  telegram: {
    ready: boolean;
    problem: "disabled" | "missing_token" | "missing_chat" | null;
    tokenConfigured: boolean;
    chatConfigured: boolean;
    enabled: boolean;
    chatId: string;
  };
  googleSheets: {
    ready: boolean;
    problem: "disabled" | "missing_credentials" | "missing_sheet_id" | null;
    credentialsConfigured: boolean;
    sheetConfigured: boolean;
    enabled: boolean;
    tab: string;
    serviceAccountEmail: string | null;
    columns: string[];
  };
}

interface TestResult {
  sent?: boolean;
  ok?: boolean;
  reason?: string;
  updatedRange?: string;
  chats?: { id: string; title: string }[];
}

/** Which card an action belongs to. */
type Scope = "telegram" | "sheets" | "courier";

interface CourierStatus {
  ready: boolean;
  problem: string | null;
  provider: string;
  credentialsConfigured: boolean;
  storeIdConfigured: boolean;
  enabled: boolean;
  openShipments: number;
}

export function IntegrationsForm() {
  const [settings, setSettings] = useState<ApiStoreSettings | null>(null);
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * A failed save belongs NEXT TO the button that failed.
   *
   * This page is two long cards; a single banner at the top is off-screen by
   * the time anyone presses Save, so a rejected key looks exactly like a
   * successful one. The scope comes from the patch itself, so no call site has
   * to remember to pass it.
   */
  const [saveError, setSaveError] = useState<{ scope: Scope; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [credentials, setCredentials] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [tab, setTab] = useState("Orders");

  const [telegramResult, setTelegramResult] = useState<TestResult | null>(null);
  const [sheetsResult, setSheetsResult] = useState<TestResult | null>(null);

  const [courierStatus, setCourierStatus] = useState<CourierStatus | null>(null);
  const [courierResult, setCourierResult] = useState<{ ok: boolean; detail: string } | null>(
    null,
  );

  const hydrate = (data: ApiStoreSettings) => {
    setSettings(data);
    setChatId(data.integrations.telegram.chatId);
    setSheetId(data.integrations.googleSheets.sheetId);
    setTab(data.integrations.googleSheets.tab);
    /* Secrets always start blank — the API never returns them. */
    setBotToken("");
    setCredentials("");
  };

  const load = useCallback(async () => {
    try {
      const [settingsData, statusData, courierData] = await Promise.all([
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.get<{ status: IntegrationStatus }>("admin/integrations/status"),
        adminApi.get<{ status: CourierStatus }>("admin/courier/status"),
      ]);
      hydrate(settingsData.settings);
      setStatus(statusData.status);
      setCourierStatus(courierData.status);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner account can manage integrations."
            : caught.message
          : "Could not load integrations.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  async function save(patch: Record<string, unknown>, message: string) {
    const scope: Scope = "telegram" in patch ? "telegram" : "sheets";

    setBusy(true);
    setSaveError(null);
    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        integrations: patch,
      });
      hydrate(data.settings);
      const statusData = await adminApi.get<{ status: IntegrationStatus }>(
        "admin/integrations/status",
      );
      setStatus(statusData.status);
      toast(message);
    } catch (caught) {
      setSaveError({
        scope,
        message: caught instanceof AdminApiError ? caught.message : "Could not save.",
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * The courier lives in its own settings group rather than under
   * `integrations`, so it gets its own saver rather than a flag threaded
   * through the shared one.
   */
  async function saveCourier(patch: Record<string, unknown>, message: string) {
    setBusy(true);
    setSaveError(null);
    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        courier: patch,
      });
      hydrate(data.settings);
      const courierData = await adminApi.get<{ status: CourierStatus }>("admin/courier/status");
      setCourierStatus(courierData.status);
      toast(message);
    } catch (caught) {
      setSaveError({
        scope: "courier",
        message: caught instanceof AdminApiError ? caught.message : "Could not save.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function testCourier() {
    setBusy(true);
    setSaveError(null);
    setCourierResult(null);
    try {
      const data = await adminApi.post<{ result: { ok: boolean; detail: string } }>(
        "admin/courier/test",
        {},
      );
      setCourierResult(data.result);
    } catch (caught) {
      setSaveError({
        scope: "courier",
        message: caught instanceof AdminApiError ? caught.message : "Could not test.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function runTest(path: string, scope: Scope, set: (result: TestResult) => void) {
    setBusy(true);
    setSaveError(null);
    set({});
    try {
      const data = await adminApi.post<{ result: TestResult }>(path, {});
      set(data.result);
    } catch (caught) {
      setSaveError({
        scope,
        message: caught instanceof AdminApiError ? caught.message : "Could not run the test.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Integrations">
      <PageBody>
        <AsyncState
          loading={loading}
          error={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          {settings && status && (
            <>
              {courierStatus && (
                <CourierCard
                  settings={settings}
                  status={courierStatus}
                  busy={busy}
                  saveError={saveError?.scope === "courier" ? saveError.message : null}
                  result={courierResult}
                  onSave={saveCourier}
                  onTest={testCourier}
                />
              )}

              {/* ---------------- Telegram ----------------
                  The verdict and its card are one unit: as separate grid
                  children they would land in different columns, captioning the
                  wrong integration. */}
              <div className="flex flex-col gap-4">
                <Verdict
                ok={status.telegram.ready}
                label={
                  status.telegram.ready
                    ? "Telegram: order alerts on"
                    : "Telegram: not sending yet"
                }
              />

              <Card>
                <CardHeader
                  title="Telegram order alerts"
                  hint="A message the moment an order arrives, with the customer's number ready to tap."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Steps
                    steps={[
                      "In Telegram, message @BotFather and send /newbot. Give it any name.",
                      "It replies with a token — paste it below and save.",
                      "Send any message to your new bot (or add it to a group), then press Find my chat.",
                      "Send a test message, then turn alerts on.",
                    ]}
                  />

                  {settings.integrations.telegram.hasBotToken ? (
                    <p className="flex items-center gap-2 rounded-sm bg-positive-soft px-3 py-2 text-caption text-positive">
                      <Icon name="check" size={15} />
                      Bot token saved ({settings.integrations.telegram.botTokenHint}).
                    </p>
                  ) : null}

                  <Input
                    label={
                      settings.integrations.telegram.hasBotToken
                        ? "Replace bot token"
                        : "Bot token"
                    }
                    type="password"
                    autoComplete="off"
                    value={botToken}
                    placeholder="1234567890:AAG..."
                    onChange={(event) => setBotToken(event.target.value)}
                    hint="From @BotFather. Leave blank to keep the current one."
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      disabled={botToken.trim().length < 20}
                      onClick={() =>
                        void save({ telegram: { botToken: botToken.trim() } }, "Bot token saved")
                      }
                    >
                      Save token
                    </Button>
                    {settings.integrations.telegram.hasBotToken && (
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          if (!window.confirm("Remove the bot token? Alerts will stop.")) return;
                          void save({ telegram: { botToken: null } }, "Bot token removed");
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>

                  <Input
                    label="Chat ID"
                    value={chatId}
                    inputMode="numeric"
                    placeholder="-1001234567890"
                    onChange={(event) => setChatId(event.target.value.trim())}
                    hint="Where alerts are sent. Use Find my chat below if you do not know it."
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => void save({ telegram: { chatId } }, "Chat saved")}
                    >
                      Save chat
                    </Button>
                    <Button
                      variant="soft"
                      size="sm"
                      loading={busy}
                      onClick={() =>
                        void runTest("admin/integrations/telegram/find-chats", "telegram", setTelegramResult)
                      }
                    >
                      Find my chat
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      onClick={() =>
                        void runTest("admin/integrations/telegram/test", "telegram", setTelegramResult)
                      }
                    >
                      Send test message
                    </Button>
                  </div>

                  {telegramResult?.chats && telegramResult.chats.length > 0 && (
                    <div className="flex flex-col gap-1.5 rounded-sm bg-surface p-3">
                      <p className="text-caption font-medium text-ink">
                        Chats that have messaged your bot
                      </p>
                      {telegramResult.chats.map((chat) => (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => {
                            setChatId(chat.id);
                            void save({ telegram: { chatId: chat.id } }, "Chat saved");
                          }}
                          className="flex items-center justify-between rounded-xs bg-white px-3 py-2 text-left text-caption text-ink hover:bg-line"
                        >
                          <span>{chat.title}</span>
                          <span className="tnum text-micro text-muted">{chat.id}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <ErrorBanner
                    message={saveError?.scope === "telegram" ? saveError.message : null}
                  />

                  {telegramResult?.sent && (
                    <SuccessBanner message="Sent. Check your Telegram — the message should be there." />
                  )}
                  {telegramResult && telegramResult.sent === false && telegramResult.reason && (
                    <ErrorBanner message={telegramResult.reason} />
                  )}
                  {telegramResult?.ok === false && telegramResult.reason && (
                    <ErrorBanner message={telegramResult.reason} />
                  )}
                  {telegramResult?.ok === true &&
                    (telegramResult.chats?.length ?? 0) === 0 &&
                    telegramResult.reason && <ErrorBanner message={telegramResult.reason} />}

                  <label className="flex items-start gap-2.5 text-caption text-ink">
                    <input
                      type="checkbox"
                      checked={settings.integrations.telegram.enabled}
                      onChange={(event) =>
                        void save(
                          { telegram: { enabled: event.target.checked } },
                          event.target.checked ? "Alerts on" : "Alerts off",
                        )
                      }
                      className="mt-0.5 size-4 accent-[var(--color-ink)]"
                    />
                    <span>
                      Send an alert for every new order
                      <span className="mt-0.5 block text-micro text-muted">
                        Cancellations and returns are also announced. Other status changes are
                        not — an alert per packing step trains everyone to ignore the channel.
                      </span>
                    </span>
                  </label>
                </div>
              </Card>

              </div>

              {/* ---------------- Google Sheets ---------------- */}
              <div className="flex flex-col gap-4">
                <Verdict
                ok={status.googleSheets.ready}
                label={
                  status.googleSheets.ready
                    ? "Google Sheets: orders are being saved"
                    : "Google Sheets: not saving yet"
                }
              />

              <Card>
                <CardHeader
                  title="Google Sheets export"
                  hint="One row per order, appended as it arrives. The sheet is a report — editing it never changes an order."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Steps
                    steps={[
                      "Go to console.cloud.google.com → APIs & Services → enable the Google Sheets API.",
                      "Credentials → Create credentials → Service account. Then Keys → Add key → JSON, and download it.",
                      "Paste the whole file below and save.",
                      "Create your spreadsheet, share it with the service account email shown after saving, and give it Editor access.",
                      "Paste the sheet id from its web address, send a test row, then turn the export on.",
                    ]}
                  />

                  {settings.integrations.googleSheets.hasCredentials ? (
                    <div className="flex flex-col gap-1 rounded-sm bg-positive-soft px-3 py-2">
                      <p className="flex items-center gap-2 text-caption text-positive">
                        <Icon name="check" size={15} />
                        Service account key saved.
                      </p>
                      {settings.integrations.googleSheets.serviceAccountEmail && (
                        <p className="text-micro text-positive">
                          Share your sheet with{" "}
                          <span className="select-all font-mono">
                            {settings.integrations.googleSheets.serviceAccountEmail}
                          </span>{" "}
                          as an Editor.
                        </p>
                      )}
                    </div>
                  ) : null}

                  <Textarea
                    label={
                      settings.integrations.googleSheets.hasCredentials
                        ? "Replace service account key"
                        : "Service account key (JSON)"
                    }
                    rows={4}
                    value={credentials}
                    placeholder='{"type": "service_account", "project_id": "...'
                    onChange={(event) => setCredentials(event.target.value)}
                    hint="The whole downloaded file. Leave blank to keep the current key."
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      disabled={credentials.trim().length < 50}
                      onClick={() =>
                        void save(
                          { googleSheets: { credentials: credentials.trim() } },
                          "Key saved",
                        )
                      }
                    >
                      Save key
                    </Button>
                    {settings.integrations.googleSheets.hasCredentials && (
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          if (!window.confirm("Remove the key? The export will stop.")) return;
                          void save({ googleSheets: { credentials: null } }, "Key removed");
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Spreadsheet ID"
                      value={sheetId}
                      autoComplete="off"
                      placeholder="1a2B3c4D..."
                      onChange={(event) => setSheetId(event.target.value.trim())}
                      hint="From the URL: /spreadsheets/d/THIS-PART/edit"
                    />
                    <Input
                      label="Tab name"
                      value={tab}
                      onChange={(event) => setTab(event.target.value)}
                      hint="The tab at the bottom of the sheet. Must match exactly."
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() =>
                        void save({ googleSheets: { sheetId, tab } }, "Sheet saved")
                      }
                    >
                      Save sheet
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      onClick={() => void runTest("admin/integrations/sheets/test", "sheets", setSheetsResult)}
                    >
                      Send test row
                    </Button>
                  </div>

                  <ErrorBanner
                    message={saveError?.scope === "sheets" ? saveError.message : null}
                  />

                  {sheetsResult?.sent && (
                    <SuccessBanner
                      message={`Written to ${sheetsResult.updatedRange ?? "your sheet"}. That test row is the column header — leave it as the first row.`}
                    />
                  )}
                  {sheetsResult && sheetsResult.sent === false && sheetsResult.reason && (
                    <ErrorBanner message={sheetsResult.reason} />
                  )}

                  <div className="rounded-sm bg-surface px-3 py-2.5">
                    <p className="text-caption font-medium text-ink">Columns written</p>
                    <p className="mt-1 text-micro text-muted">
                      {status.googleSheets.columns.join(" · ")}
                    </p>
                  </div>

                  <label className="flex items-start gap-2.5 text-caption text-ink">
                    <input
                      type="checkbox"
                      checked={settings.integrations.googleSheets.enabled}
                      onChange={(event) =>
                        void save(
                          { googleSheets: { enabled: event.target.checked } },
                          event.target.checked ? "Export on" : "Export off",
                        )
                      }
                      className="mt-0.5 size-4 accent-[var(--color-ink)]"
                    />
                    <span>
                      Append every new order to the sheet
                      <span className="mt-0.5 block text-micro text-muted">
                        Only new orders from this point. Existing ones are not backfilled.
                      </span>
                    </span>
                  </label>
                </div>
              </Card>
              </div>
            </>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

/* ---------------- Courier ---------------- */

/**
 * Courier hand-off.
 *
 * Same shape as the other two integrations — paste a credential, prove it
 * works, then switch it on — because testing before enabling is the order that
 * matters. A courier switched on but misconfigured fails at the exact moment
 * somebody is trying to dispatch a parcel.
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
    </div>
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
