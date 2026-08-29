"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import type { ApiStoreSettings } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, SuccessBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
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
    backupChatId: string;
    /** Buttons and commands — fails independently of the alerts themselves. */
    botEnabled: boolean;
    allowedUserIds: string;
    webhook: { url: string; pendingUpdates: number; lastError: string } | null;
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
  database: {
    driver: string;
    pool: { total: number; idle: number; waiting: number } | null;
    healthy: boolean;
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
type Scope = "telegram" | "sheets";

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
  const [backupChatId, setBackupChatId] = useState("");
  const [credentials, setCredentials] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [tab, setTab] = useState("Orders");

  const [telegramResult, setTelegramResult] = useState<TestResult | null>(null);
  const [sheetsResult, setSheetsResult] = useState<TestResult | null>(null);

  const hydrate = (data: ApiStoreSettings) => {
    setSettings(data);
    setChatId(data.integrations.telegram.chatId);
    setBackupChatId(data.integrations.telegram.backupChatId);
    setSheetId(data.integrations.googleSheets.sheetId);
    setTab(data.integrations.googleSheets.tab);
    /* Secrets always start blank — the API never returns them. */
    setBotToken("");
    setCredentials("");
  };

  const load = useCallback(async () => {
    try {
      const [settingsData, statusData] = await Promise.all([
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.get<{ status: IntegrationStatus }>("admin/integrations/status"),
      ]);
      hydrate(settingsData.settings);
      setStatus(statusData.status);
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

              <DatabaseCard database={status.database} />

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
                    placeholder="-1001234567890, 852271924"
                    onChange={(event) => setChatId(event.target.value)}
                    hint="Where order alerts go. Separate several with commas and every admin gets their own copy, with their own Confirm buttons. Use Find my chat below if you do not know an id."
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

                  {/* The backup, kept visually apart from the alerts above.
                      They use the same bot and nothing else: the alerts are
                      read by whoever is working the orders, and this file is
                      every customer's name, phone and address. */}
                  <div className="flex flex-col gap-3 rounded-sm border border-line p-3">
                    <div>
                      <p className="text-caption font-semibold text-ink">Database backup</p>
                      <p className="text-micro text-muted">
                        A copy of the whole database, sent here every night at 3:30am. Product
                        photos are not included — they are already public on the shop.
                      </p>
                    </div>

                    <Input
                      label="Backup chat ID"
                      value={backupChatId}
                      inputMode="numeric"
                      placeholder="852271924"
                      onChange={(event) => setBackupChatId(event.target.value.trim())}
                      hint="Your own chat, not the staff group. The file is not encrypted, so whoever can read this chat can read every customer's address."
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void save({ telegram: { backupChatId } }, "Backup chat saved")
                        }
                      >
                        Save backup chat
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        disabled={backupChatId.trim() === ""}
                        onClick={() =>
                          void runTest(
                            "admin/integrations/telegram/backup-now",
                            "telegram",
                            setTelegramResult,
                          )
                        }
                      >
                        Send a backup now
                      </Button>
                    </div>

                    {settings.integrations.telegram.backupChatId.trim() === "" && (
                      <p className="flex items-start gap-1.5 text-micro text-warn">
                        <span aria-hidden="true">⚠</span>
                        <span>
                          No backup is being taken. This shop has lost its database once
                          already.
                        </span>
                      </p>
                    )}
                  </div>

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
                        Also: cancellations, returns, delivered parcels, and customers who left
                        without finishing. Packing steps are deliberately silent — an alert for
                        each one trains everyone to ignore the channel.
                      </span>
                    </span>
                  </label>
                </div>
              </Card>

              <BotCard
                status={status.telegram}
                allowedUserIds={settings.integrations.telegram.allowedUserIds ?? ""}
                busy={busy}
                onReload={load}
                onSaveAllowed={(ids) =>
                  save({ telegram: { allowedUserIds: ids } }, "Saved")
                }
              />

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

/**
 * Buttons and commands.
 *
 * Its own card rather than another checkbox on the Telegram one, because it is a
 * different kind of thing: alerts are one-way and carry no risk, whereas this
 * lets anyone in the chat confirm and cancel orders. Presenting them as one
 * switch would hide that.
 */
function BotCard({
  status,
  allowedUserIds,
  busy,
  onReload,
  onSaveAllowed,
}: {
  status: IntegrationStatus["telegram"];
  allowedUserIds: string;
  busy: boolean;
  onReload: () => Promise<void>;
  onSaveAllowed: (ids: string) => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [ids, setIds] = useState(allowedUserIds);

  async function toggle(on: boolean) {
    setWorking(true);
    setResult(null);
    try {
      const data = await adminApi.post<{ result: { ok: boolean; detail: string } }>(
        on ? "admin/integrations/telegram/bot/enable" : "admin/integrations/telegram/bot/disable",
        {},
      );
      setResult(data.result);
      if (data.result.ok) {
        toast(on ? "Bot on" : "Bot off");
        await onReload();
      }
    } catch (caught) {
      setResult({
        ok: false,
        detail: caught instanceof AdminApiError ? caught.message : "Could not change it.",
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Verdict
        ok={status.botEnabled}
        label={status.botEnabled ? "Bot: buttons and commands on" : "Bot: alerts only"}
      />

      <Card>
        <CardHeader
          title="Bot buttons and commands"
          hint="Confirm or cancel an order straight from the alert, and ask the bot questions."
        />
        <div className="flex flex-col gap-4 p-4">
          <div className="rounded-sm bg-surface px-3 py-2.5">
            <p className="text-caption font-medium text-ink">What you get</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
              <li className="text-micro text-muted">
                <b>Confirm</b> and <b>Cancel</b> buttons on every new-order alert. Cancel asks
                twice — it sits right beside Confirm on a phone.
              </li>
              <li className="text-micro text-muted">
                <code>/today</code> — today&apos;s orders and takings
              </li>
              <li className="text-micro text-muted">
                <code>/pending</code> — orders still waiting for a call
              </li>
              <li className="text-micro text-muted">
                <code>/order HINAR-10001</code> — look up one order
              </li>
              <li className="text-micro text-muted">
                <code>/stock</code> — products low or out of stock
              </li>
              <li className="text-micro text-muted">
                A summary each night, and a nudge when someone leaves without finishing.
              </li>
            </ul>
          </div>

          {/* Stated plainly rather than buried: this is the one thing about the
              feature that could surprise someone later. */}
          <p className="flex items-start gap-2 rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <span>
              Anyone in that Telegram chat can confirm and cancel orders. Fine for your own
              staff group — add user ids below if it is a wider one.
            </span>
          </p>

          {status.webhook?.lastError ? (
            <ErrorBanner
              message={`Telegram cannot reach this shop: ${status.webhook.lastError}`}
            />
          ) : null}

          {status.botEnabled && (status.webhook?.pendingUpdates ?? 0) > 0 && (
            <p className="rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
              {status.webhook?.pendingUpdates} update(s) waiting — Telegram is holding them
              because it could not deliver.
            </p>
          )}

          <Input
            label="Who may press the buttons (optional)"
            value={ids}
            onChange={(event) => setIds(event.target.value)}
            placeholder="852271924, 123456789"
            hint="Telegram user ids, comma separated. Leave blank to allow everyone in the chat."
          />

          <div className="flex flex-wrap gap-2">
            {status.botEnabled ? (
              <Button
                variant="danger"
                size="sm"
                loading={working || busy}
                onClick={() => void toggle(false)}
              >
                Turn buttons off
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                loading={working || busy}
                disabled={!status.tokenConfigured || !status.chatConfigured}
                onClick={() => void toggle(true)}
              >
                Turn buttons on
              </Button>
            )}

            {ids !== allowedUserIds && (
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() => void onSaveAllowed(ids)}
              >
                Save who
              </Button>
            )}
          </div>

          {result?.ok && <SuccessBanner message={result.detail} />}
          {result && !result.ok && <ErrorBanner message={result.detail} />}

          {!status.tokenConfigured || !status.chatConfigured ? (
            <p className="text-micro text-muted">
              Add the bot token and choose the chat above first — the bot only answers there.
            </p>
          ) : (
            <p className="text-micro text-muted">
              Turning this on registers a webhook with Telegram. Your API address must be
              reachable over https, and <code>/api/v1/webhooks/*</code> must be open in the
              reverse proxy.
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

/* -------------------------------------------------------------------------- */

/**
 * How busy the database is, in words rather than numbers.
 *
 * The figures were always available on `/health/ready` — an endpoint for
 * machines, which nobody reads and nothing was watching. What was missing was
 * anywhere a person could look, and anything that says something when it goes
 * wrong. The scheduler now warns on Telegram when a queue will not clear; this
 * is the on-demand answer to "is the database why the site feels slow".
 *
 * `waiting` is the only number that matters. Connections in use is the pool
 * working; requests QUEUED for a connection is the shop waiting on itself.
 */
function DatabaseCard({
  database,
}: {
  database: {
    driver: string;
    pool: { total: number; idle: number; waiting: number } | null;
    healthy: boolean;
  };
}) {
  const { pool } = database;

  return (
    <Card>
      <CardHeader
        title="Database"
        hint="Shared connections, like counters at a bank — customers queue for a free one rather than each opening their own."
      />
      <div className="flex flex-col gap-3 p-4">
        {pool === null ? (
          <p className="text-caption text-muted">
            Running on the embedded development database, which has no pool to report.
          </p>
        ) : (
          <>
            <p
              className={cn(
                "rounded-sm px-3 py-2 text-caption",
                database.healthy
                  ? "bg-positive-soft text-positive"
                  : "bg-warn-soft text-warn",
              )}
            >
              {database.healthy
                ? pool.total === 0
                  ? "Idle — no connections open, which is normal when the shop is quiet."
                  : `${pool.total - pool.idle} of ${pool.total} connections busy, nobody queued.`
                : `${pool.waiting} request${pool.waiting === 1 ? "" : "s"} waiting for a free connection.`}
            </p>

            <dl className="grid grid-cols-3 gap-2 text-caption">
              <Figure label="Open" value={pool.total} />
              <Figure label="Free" value={pool.idle} />
              {/* The one worth watching, and coloured only when it is not zero
                  — a permanently red number teaches people to ignore it. */}
              <Figure label="Queued" value={pool.waiting} warn={pool.waiting > 0} />
            </dl>

            <p className="text-micro text-muted">
              A short queue during a burst is the pool doing its job. One that does not clear
              means the server is short of CPU, not of settings — you will get a Telegram
              message if that happens.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function Figure({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-sm border border-line p-3">
      <dt className="text-micro text-muted">{label}</dt>
      <dd
        className={cn(
          "tnum text-title font-semibold",
          warn ? "text-warn" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
