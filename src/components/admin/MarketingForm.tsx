"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import type { ApiStoreSettings } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody, SuccessBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Tracking — Facebook and Google, in one screen.
 *
 * Everything needed to connect the shop to Ads Manager and to Google, because the
 * alternative was editing environment variables and redeploying.
 *
 * The Conversions API token is write-only: the API returns only a masked hint,
 * never the value. So the token field starts empty and a blank field means
 * "leave the stored token alone" — which is why there is an explicit Remove
 * action rather than relying on clearing the box.
 */

interface MarketingStatus {
  ready: boolean;
  problem: "disabled" | "missing_pixel_id" | "missing_token" | null;
  pixelConfigured: boolean;
  tokenConfigured: boolean;
  trackingEnabled: boolean;
  domainVerified: boolean;
  testMode: boolean;
  testEventCode: string;
  eventSourceUrl: string;
  google: {
    gtmConfigured: boolean;
    gtmEnabled: boolean;
    gtmContainerId: string;
    gtmReady: boolean;
  };
}

interface TestResult {
  sent: boolean;
  reason?: string;
  eventsReceived?: number;
  fbTraceId?: string;
  destination: "test_events" | "live";
}

export function MarketingForm() {
  const [settings, setSettings] = useState<ApiStoreSettings | null>(null);
  const [status, setStatus] = useState<MarketingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const [pixelId, setPixelId] = useState("");
  const [testEventCode, setTestEventCode] = useState("");
  const [domainVerification, setDomainVerification] = useState("");
  const [enabled, setEnabled] = useState(false);
  /* Always starts blank — the stored value is never sent back to the browser. */
  const [newToken, setNewToken] = useState("");
  const [gtmContainerId, setGtmContainerId] = useState("");

  const hydrate = (data: ApiStoreSettings) => {
    setSettings(data);
    setPixelId(data.tracking.pixelId);
    setTestEventCode(data.tracking.testEventCode);
    setDomainVerification(data.tracking.domainVerification);
    setEnabled(data.tracking.enabled);
    setNewToken("");
    setGtmContainerId(data.tracking.gtmContainerId);
  };

  const load = useCallback(async () => {
    try {
      const [settingsData, statusData] = await Promise.all([
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.get<{ status: MarketingStatus }>("admin/marketing/status"),
      ]);
      hydrate(settingsData.settings);
      setStatus(statusData.status);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner account can manage tracking settings."
            : caught.message
          : "Could not load tracking settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  async function save(patch: Record<string, unknown>, message: string) {
    setSaving(true);
    setSaveError(null);
    setTestResult(null);
    try {
      const data = await adminApi.patch<{ settings: ApiStoreSettings }>("admin/settings", {
        tracking: patch,
      });
      hydrate(data.settings);
      /* Status is derived server-side, so re-read it rather than guessing. */
      const statusData = await adminApi.get<{ status: MarketingStatus }>(
        "admin/marketing/status",
      );
      setStatus(statusData.status);
      toast(message);
    } catch (caught) {
      setSaveError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner account can change tracking settings."
            : caught.message
          : "Could not save.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    setSaveError(null);
    try {
      const data = await adminApi.post<{ result: TestResult }>(
        "admin/marketing/test-event",
        {},
      );
      setTestResult(data.result);
    } catch (caught) {
      setSaveError(caught instanceof AdminApiError ? caught.message : "Could not send a test.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <AdminShell title="Tracking">
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
              <ErrorBanner message={saveError} className="2xl:col-span-2" />

              <div className="2xl:col-span-2">
                <ConnectionStatus status={status} tokenHint={settings.tracking.capiTokenHint} />
              </div>

              <SectionTitle>Facebook</SectionTitle>

              {/* --- Pixel ------------------------------------------------- */}
              <Card>
                <CardHeader
                  title="Pixel"
                  hint="Events Manager → Data sources → your pixel. The id is the long number under its name."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Pixel ID"
                    value={pixelId}
                    inputMode="numeric"
                    placeholder="1234567890123456"
                    onChange={(event) => setPixelId(event.target.value.replace(/\D/g, ""))}
                    hint="Used for both browser events and server events — Meta calls it the dataset id in some screens."
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={saving}
                    className="self-start"
                    onClick={() => void save({ pixelId }, "Pixel id saved")}
                  >
                    Save pixel id
                  </Button>
                </div>
              </Card>

              {/* --- CAPI token -------------------------------------------- */}
              <Card>
                <CardHeader
                  title="Conversions API token"
                  hint="Events Manager → Settings → Generate access token. Treat it like a password: it is never shown again after saving, and never sent back to this page."
                />
                <div className="flex flex-col gap-4 p-4">
                  {settings.tracking.hasCapiToken ? (
                    <p className="flex items-center gap-2 rounded-sm bg-positive-soft px-3 py-2 text-caption text-positive">
                      <Icon name="check" size={15} />
                      A token is saved ({settings.tracking.capiTokenHint}).
                    </p>
                  ) : (
                    <p className="flex items-start gap-2 rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
                      <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                      No token yet. Without one, purchases are only reported from the
                      customer&apos;s browser — which loses a large share of conversions in
                      Bangladesh.
                    </p>
                  )}

                  <Input
                    label={settings.tracking.hasCapiToken ? "Replace token" : "Access token"}
                    type="password"
                    autoComplete="off"
                    value={newToken}
                    onChange={(event) => setNewToken(event.target.value)}
                    hint="Leave blank to keep the current token."
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={saving}
                      disabled={newToken.trim().length < 20}
                      onClick={() =>
                        void save({ capiToken: newToken.trim() }, "Token saved")
                      }
                    >
                      {settings.tracking.hasCapiToken ? "Replace token" : "Save token"}
                    </Button>

                    {settings.tracking.hasCapiToken && (
                      <Button
                        variant="danger"
                        size="sm"
                        loading={saving}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Remove the token? Server-side purchase tracking will stop until you add a new one.",
                            )
                          ) {
                            return;
                          }
                          void save({ capiToken: null }, "Token removed");
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              {/* --- Domain verification ----------------------------------- */}
              <Card>
                <CardHeader
                  title="Domain verification"
                  hint="Business Settings → Brand Safety → Domains. Choose the meta-tag method and paste the content value here."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Verification code"
                    value={domainVerification}
                    autoComplete="off"
                    placeholder="a1b2c3d4e5f6g7h8i9j0"
                    onChange={(event) => setDomainVerification(event.target.value.trim())}
                    hint="Added to every storefront page as a meta tag. Required before iOS traffic reports properly."
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={saving}
                    className="self-start"
                    onClick={() =>
                      void save({ domainVerification }, "Verification code saved")
                    }
                  >
                    Save verification code
                  </Button>
                </div>
              </Card>

              {/* --- Test mode and master switch --------------------------- */}
              <Card>
                <CardHeader
                  title="Test mode"
                  hint="Events Manager → Test Events. While a test code is set, events go to that console and do NOT train your campaign."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Test event code"
                    value={testEventCode}
                    autoComplete="off"
                    placeholder="TEST12345"
                    onChange={(event) => setTestEventCode(event.target.value.trim())}
                    hint="Clear this before you start spending, or your ads get no optimisation signal."
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={saving}
                    className="self-start"
                    onClick={() => void save({ testEventCode }, "Test event code saved")}
                  >
                    Save test code
                  </Button>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Tracking"
                  hint="The master switch. Off means no pixel loads and no server events are sent, without losing your configuration."
                />
                <div className="flex flex-col gap-4 p-4">
                  <label className="flex items-start gap-2.5 text-caption text-ink">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => {
                        setEnabled(event.target.checked);
                        void save(
                          { enabled: event.target.checked },
                          event.target.checked ? "Tracking is on" : "Tracking is off",
                        );
                      }}
                      className="mt-0.5 size-4 accent-[var(--color-ink)]"
                    />
                    <span>
                      Send events to Facebook
                      <span className="mt-0.5 block text-micro text-muted">
                        Turn this on only once you have verified a test event arriving.
                      </span>
                    </span>
                  </label>
                </div>
              </Card>

              <SectionTitle>Google</SectionTitle>

              {/* --- Google Tag Manager ------------------------------------ */}
              <Card>
                <CardHeader
                  title="Tag Manager container"
                  hint="tagmanager.google.com → your container. The id is shown top-right and looks like GTM-ABC1234."
                />
                <div className="flex flex-col gap-4 p-4">
                  <Input
                    label="Container ID"
                    value={gtmContainerId}
                    autoComplete="off"
                    placeholder="GTM-ABC1234"
                    /* Upper-cased as you type: the snippet is case-sensitive, and
                       a lower-cased id silently loads nothing. */
                    onChange={(event) =>
                      setGtmContainerId(event.target.value.trim().toUpperCase())
                    }
                    hint="Put GA4, Google Ads conversions and remarketing inside this container — one id covers all of them."
                  />

                  <label className="flex items-start gap-2.5 text-caption text-ink">
                    <input
                      type="checkbox"
                      checked={settings.tracking.gtmEnabled}
                      onChange={(event) =>
                        void save(
                          { gtmEnabled: event.target.checked },
                          event.target.checked
                            ? "Tag Manager is on"
                            : "Tag Manager is off",
                        )
                      }
                      className="mt-0.5 size-4 accent-[var(--color-ink)]"
                    />
                    <span>
                      Load Tag Manager on the storefront
                      <span className="mt-0.5 block text-micro text-muted">
                        Independent of the Facebook switch above.
                      </span>
                    </span>
                  </label>

                  <Button
                    variant="secondary"
                    size="sm"
                    loading={saving}
                    className="self-start"
                    onClick={() => void save({ gtmContainerId }, "Container id saved")}
                  >
                    Save container id
                  </Button>

                  <div className="rounded-sm bg-surface px-3 py-2.5">
                    <p className="text-caption font-medium text-ink">
                      What the shop already sends to the data layer
                    </p>
                    <p className="mt-1 text-micro text-muted">
                      <code className="text-ink-soft">view_item</code>,{" "}
                      <code className="text-ink-soft">add_to_cart</code>,{" "}
                      <code className="text-ink-soft">begin_checkout</code>,{" "}
                      <code className="text-ink-soft">search</code> and{" "}
                      <code className="text-ink-soft">purchase</code> — GA4&apos;s standard
                      ecommerce names, with items and BDT values. A GA4 tag in your container
                      picks them up with no custom mapping.
                    </p>
                  </div>

                  {status.google.gtmReady && status.trackingEnabled && (
                    <p className="flex items-start gap-2 rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
                      <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                      Both are on. If your container also contains a{" "}
                      <strong>Meta pixel tag</strong>, remove it — the pixel is already loaded
                      directly above, and running both counts every event twice.
                    </p>
                  )}
                </div>
              </Card>

              {/* --- Diagnostic ------------------------------------------- */}
              <Card>
                <CardHeader
                  title="Check the connection"
                  hint="Sends a diagnostic event from this server to Facebook and reports exactly what came back."
                />
                <div className="flex flex-col gap-3 p-4">
                  <p className="text-caption text-muted">
                    Sends <code className="text-ink">TestEvent</code>, never a fake purchase — a
                    fake purchase on a live pixel corrupts the conversion data your campaign
                    optimises against, and cannot be retracted.
                  </p>

                  <Button
                    variant="primary"
                    size="md"
                    loading={testing}
                    className="self-start"
                    onClick={() => void runTest()}
                  >
                    {testing ? "Sending…" : "Send test event"}
                  </Button>

                  {testResult?.sent && (
                    <SuccessBanner
                      message={
                        `Facebook accepted the event${
                          testResult.eventsReceived !== undefined
                            ? ` (${testResult.eventsReceived} received)`
                            : ""
                        }. Look in ${
                          testResult.destination === "test_events"
                            ? "Events Manager → Test Events"
                            : "Events Manager → Overview"
                        }.`
                      }
                    />
                  )}

                  {testResult && !testResult.sent && (
                    <ErrorBanner message={testResult.reason ?? "The event was not sent."} />
                  )}
                </div>
              </Card>
            </>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */

/** One platform's headline verdict. */
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

function CheckList({ items }: { items: { label: string; ok: boolean }[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-caption">
          <Icon
            name={item.ok ? "check" : "close"}
            size={14}
            className={item.ok ? "text-positive" : "text-muted"}
          />
          <span className={item.ok ? "text-ink-soft" : "text-muted"}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Separates the two platforms, which share a screen but nothing else. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-2 px-1 text-caption font-semibold uppercase tracking-wide text-muted 2xl:col-span-2">
      {children}
    </h2>
  );
}

/**
 * A checklist rather than a green light.
 *
 * "Why is Ads Manager not receiving anything" has four different answers, and
 * the shop owner cannot read the server logs to tell them apart.
 */
function ConnectionStatus({
  status,
  tokenHint,
}: {
  status: MarketingStatus;
  tokenHint: string;
}) {
  const checks = [
    { label: "Pixel ID set", ok: status.pixelConfigured },
    {
      label: tokenHint ? `Server token set (${tokenHint})` : "Server token set",
      ok: status.tokenConfigured,
    },
    { label: "Domain verification code set", ok: status.domainVerified },
    { label: "Tracking switched on", ok: status.trackingEnabled },
  ];

  const googleChecks = [
    {
      label: status.google.gtmContainerId
        ? `Container ID set (${status.google.gtmContainerId})`
        : "Container ID set",
      ok: status.google.gtmConfigured,
    },
    { label: "Tag Manager switched on", ok: status.google.gtmEnabled },
  ];

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <Verdict
          ok={status.ready}
          label={status.ready ? "Facebook: connected and sending" : "Facebook: not sending yet"}
        />
        <CheckList items={checks} />

        <Verdict
          ok={status.google.gtmReady}
          label={
            status.google.gtmReady
              ? "Google: Tag Manager loading"
              : "Google: Tag Manager not loading"
          }
        />
        <CheckList items={googleChecks} />

        {status.testMode && (
          <p className="flex items-start gap-2 rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            Test mode is on ({status.testEventCode}). Events go to the Test Events console and
            do <strong>not</strong> optimise your ads. Clear the test code before you start
            spending.
          </p>
        )}

        <p className="text-micro text-muted">
          Conversions are reported as coming from{" "}
          <code className="text-ink-soft">{status.eventSourceUrl}</code>. This must be on the
          domain you verified with Facebook, or attribution degrades.
        </p>
      </div>
    </Card>
  );
}
