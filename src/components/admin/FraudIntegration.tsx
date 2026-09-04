"use client";

import { useCallback, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { formatDateTime } from "@/lib/utils";
import { toast } from "@/lib/stores/toast-store";
import type { ApiFraudAccount } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

/**
 * Courier sign-ins, for checking a customer's delivery record.
 *
 * ITS OWN SCREEN, NOT A SECTION OF SETTINGS
 * -----------------------------------------
 * What is typed here is not a preference. It is the shop's real merchant
 * password for each courier — the same one that creates parcels and sees
 * settlement — and five of them sit on one page with a live test beside each.
 * That deserves a page somebody arrives at deliberately rather than a panel
 * they scroll past while changing the store's phone number.
 *
 * The password is never sent back by the API. The field shows what is stored
 * only as "saved", and leaving it empty on save keeps the existing one —
 * otherwise every unrelated edit would need it retyped from a note somewhere.
 */
export function CourierAccountList() {
  const [accounts, setAccounts] = useState<ApiFraudAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ accounts: ApiFraudAccount[] }>("admin/fraud/accounts");
      setAccounts(data.accounts);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError ? caught.message : "Could not load courier credentials.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const active = accounts.filter((account) => account.enabled && account.identifier).length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Courier APIs & Delivery History Records"
          hint="Connect your courier accounts to collect customer delivery stats (fraud check) across all couriers."
        />
        <div className="flex flex-col gap-2 p-4 text-caption text-ink-soft">
          <p>
            {active === 0
              ? "No courier is switched on yet for delivery record collection."
              : `${active} courier${active === 1 ? "" : "s"} active. Customer delivery records are checked across all active couriers.`}
          </p>
          <p className="text-muted">
            Enter your API credentials for each courier you use. Each active courier helps build the delivery success % when checking customer orders.
          </p>
        </div>
      </Card>

      <AsyncState
        loading={loading}
        error={error}
        onRetry={() => {
          setLoading(true);
          void load();
        }}
      >
        <div className="grid gap-4">
          {accounts.map((account) => (
            <CourierCard key={account.provider} account={account} onSaved={setAccounts} />
          ))}
        </div>
      </AsyncState>
    </div>
  );
}

export function FraudIntegration() {
  return (
    <AdminShell title="Courier integrations">
      <PageBody columns={false}>
        <CourierAccountList />
      </PageBody>
    </AdminShell>
  );
}

function CourierCard({
  account,
  onSaved,
}: {
  account: ApiFraudAccount;
  onSaved: (accounts: ApiFraudAccount[]) => void;
}) {
  const [identifier, setIdentifier] = useState(account.identifier);
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(account.enabled);
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function save() {
    setBusy(true);
    setCardError(null);
    try {
      const data = await adminApi.put<{ accounts: ApiFraudAccount[] }>(
        `admin/fraud/accounts/${account.provider}`,
        {
          identifier: identifier.trim(),
          /* Omitted, not empty: an empty string would clear a stored password
             that the person never intended to touch. */
          ...(secret ? { secret } : {}),
          enabled,
        },
      );
      onSaved(data.accounts);
      setSecret("");
      toast(`${account.label} saved`);
    } catch (caught) {
      setCardError(caught instanceof AdminApiError ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setCardError(null);
    setTestResult(null);
    try {
      const data = await adminApi.post<{ result: { ok: boolean; message: string } }>(
        `admin/fraud/accounts/${account.provider}/test`,
        { phone: testPhone.trim() },
      );
      setTestResult(data.result);
    } catch (caught) {
      setCardError(caught instanceof AdminApiError ? caught.message : "Could not run the test.");
    } finally {
      setBusy(false);
    }
  }

  const canTest = account.hasSecret && /^01[3-9]\d{8}$/.test(testPhone.trim());

  return (
    <Card>
      <CardHeader
        title={account.label}
        hint={
          account.hasSecret
            ? account.lastOkAt
              ? `Last answered ${formatDateTime(account.lastOkAt)}`
              : "Saved, but this courier has never answered yet."
            : "Not set up."
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <ErrorBanner message={cardError} />

        {/* The courier's own words about why it last refused. Kept on screen
            rather than only in a log, because the person who can fix it is the
            person looking at this card. */}
        {account.lastError && (
          <p className="rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
            {account.lastError}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={account.identifierLabel || "API Key / Client ID"}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder={
              account.provider === "steadfast"
                ? "Steadfast API Key"
                : account.provider === "pathao"
                  ? "Pathao Client ID or Token"
                  : account.identifierLabel.includes("phone")
                    ? "01712345678"
                    : "API Key / Client ID"
            }
          />
          <Input
            label={account.secretLabel || "Secret Key / API Token"}
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={
              account.hasSecret
                ? `•••••••• (saved ${account.secretLabel || "Secret Key"})`
                : account.provider === "steadfast"
                  ? "Steadfast Secret Key"
                  : account.provider === "pathao"
                    ? "Pathao Client Secret"
                    : "Secret Key / API Token"
            }
            hint={account.hasSecret ? "Leave empty to keep the saved one." : undefined}
            autoComplete="new-password"
          />
        </div>

        <p className="rounded-xs bg-positive-soft/50 px-2.5 py-1.5 text-micro text-positive">
          ✓ <strong>API Integration:</strong> Connects to {account.label}&apos;s API for automated customer delivery history lookup.
        </p>

        <label className="flex w-fit items-center gap-2 text-caption text-ink">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Enable customer delivery record lookup for {account.label}
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={busy}
            disabled={enabled && identifier.trim().length === 0}
            onClick={() => void save()}
          >
            Save API credentials
          </Button>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-micro uppercase tracking-wide text-muted">
            Test API connection
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Any customer number"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="01712345678"
              className="min-w-[12rem]"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={busy}
              disabled={!canTest}
              onClick={() => void test()}
            >
              Test
            </Button>
          </div>

          {!account.hasSecret && (
            <p className="text-micro text-muted">
              Save {account.secretLabel || "Secret Key"} first.
            </p>
          )}

          {testResult && (
            <p
              className={
                testResult.ok
                  ? "rounded-sm bg-positive-soft px-3 py-2 text-caption text-positive"
                  : "rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale"
              }
            >
              {testResult.message}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
