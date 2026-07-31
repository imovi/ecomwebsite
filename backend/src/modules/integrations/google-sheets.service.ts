import { SignJWT, importPKCS8 } from "jose";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import type { StoreSettingsRow } from "../../db/schema/store-settings.js";

/**
 * Google Sheets export — one row appended per order.
 *
 * WHY A SERVICE ACCOUNT AND NOT OAUTH
 * -----------------------------------
 * OAuth would need a consent screen, a redirect URL, a Google-verified app and a
 * refresh token to babysit. A service account is a single JSON key the owner
 * pastes once; they then share the sheet with the account's email exactly as
 * they would with a colleague. Nothing to re-authorise, nothing to expire.
 *
 * WHY NO `googleapis` PACKAGE
 * ---------------------------
 * The official client is tens of megabytes and pulls in a discovery layer for
 * every Google product. All that is needed here is: sign a JWT, swap it for an
 * access token, POST one row. `jose` is already a dependency for this app's own
 * tokens, so the whole integration is two fetches.
 *
 * ONE-WAY BY DESIGN
 * -----------------
 * The sheet is a report. Nothing reads it back, so an owner editing a cell can
 * never corrupt an order — the database stays the single source of truth.
 */

const log = createLogger("google-sheets");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const TIMEOUT_MS = 8000;

export type SheetsConfig = Pick<
  StoreSettingsRow,
  "googleSheetsCredentials" | "googleSheetsId" | "googleSheetsTab" | "googleSheetsEnabled"
>;

export type SheetsProblem = "disabled" | "missing_credentials" | "missing_sheet_id";

export function configProblem(settings: SheetsConfig): SheetsProblem | null {
  if (settings.googleSheetsCredentials.trim() === "") return "missing_credentials";
  if (settings.googleSheetsId.trim() === "") return "missing_sheet_id";
  if (!settings.googleSheetsEnabled) return "disabled";
  return null;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/**
 * Reads the pasted JSON key.
 *
 * Returns a readable message rather than throwing a parse error: the operator is
 * pasting a file into a textarea, and "that does not look like the JSON key" is
 * far more useful than a stack trace about position 4.
 */
export function parseCredentials(raw: string): ServiceAccount | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "That is not valid JSON. Paste the whole downloaded key file." };
  }

  const candidate = parsed as Partial<ServiceAccount> & { type?: string };

  if (candidate.type && candidate.type !== "service_account") {
    return {
      error: `This is a "${candidate.type}" key. Create a SERVICE ACCOUNT key instead.`,
    };
  }
  if (!candidate.client_email || !candidate.private_key) {
    return { error: "The key is missing client_email or private_key." };
  }

  return { client_email: candidate.client_email, private_key: candidate.private_key };
}

/**
 * Access tokens last an hour; re-minting one per order would add a needless
 * round trip and a signing operation to every checkout. Keyed by the account
 * email so replacing the credentials cannot serve a stale token.
 */
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  /* 60s of slack, so a token that expires mid-flight is refreshed first. */
  if (tokenCache && tokenCache.key === account.client_email && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }

  /* The JSON key stores the PEM with literal "\n" sequences when it has been
     copied through an environment variable, so both forms have to work. */
  const pem = account.private_key.includes("\\n")
    ? account.private_key.replace(/\\n/g, "\n")
    : account.private_key;

  const privateKey = await importPKCS8(pem, "RS256");

  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(account.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  } | null;

  if (!response.ok || !body?.access_token) {
    throw new Error(
      body?.error_description ?? body?.error ?? `Google refused the key (${response.status}).`,
    );
  }

  tokenCache = {
    key: account.client_email,
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
  };

  return body.access_token;
}

/** Clears the cached token — called when the credentials change. */
export function resetTokenCache(): void {
  tokenCache = null;
}

export interface AppendOutcome {
  sent: boolean;
  reason?: string;
  /** The range Google reported writing to, useful for the test button. */
  updatedRange?: string;
}

async function appendRow(
  settings: SheetsConfig,
  values: (string | number)[],
  options: { skipEnabledCheck?: boolean } = {},
): Promise<AppendOutcome> {
  const problem = configProblem(settings);

  /* The test button must reach Google before the switch is on. */
  if (problem && !(options.skipEnabledCheck && problem === "disabled")) {
    return {
      sent: false,
      reason:
        problem === "disabled"
          ? "The Google Sheets export is turned off in settings."
          : problem === "missing_credentials"
            ? "No service account key is configured."
            : "No spreadsheet id is configured.",
    };
  }

  const account = parseCredentials(settings.googleSheetsCredentials);
  if ("error" in account) return { sent: false, reason: account.error };

  try {
    const token = await getAccessToken(account);

    /* The tab name goes in the range. Quoted and internally-escaped so a tab
       called `Orders 2026` or one with an apostrophe still resolves. */
    const tab = settings.googleSheetsTab.trim() || "Orders";
    const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1`);

    const response = await fetch(
      `${SHEETS_API}/${settings.googleSheetsId.trim()}/values/${range}:append` +
        `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ values: [values] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    const body = (await response.json().catch(() => null)) as {
      updates?: { updatedRange?: string };
      error?: { message?: string; status?: string };
    } | null;

    if (!response.ok) {
      const message = body?.error?.message ?? `Google returned ${response.status}.`;
      log.error({ status: response.status, message }, "Sheets append rejected");

      /* The overwhelmingly common setup mistake, worth naming explicitly. */
      const hint =
        response.status === 403
          ? ` Share the sheet with ${account.client_email} and give it Editor access.`
          : response.status === 404
            ? " Check the spreadsheet id, and that the tab name matches exactly."
            : "";

      return { sent: false, reason: message + hint };
    }

    return {
      sent: true,
      ...(body?.updates?.updatedRange ? { updatedRange: body.updates.updatedRange } : {}),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    log.error({ err: error }, "Sheets append failed");
    return { sent: false, reason };
  }
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

/** The column order, also used as the header row the test button offers. */
export const SHEET_COLUMNS = [
  "Order",
  "Placed at",
  "Customer",
  "Phone",
  "Address",
  "Area",
  "Zone",
  "Items",
  "Quantity",
  "Subtotal",
  "Delivery",
  "Total",
  "Status",
] as const;

export interface OrderRow {
  orderNumber: string;
  placedAt: Date;
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  deliveryZone: "inside_dhaka" | "outside_dhaka";
  items: { name: string; variantLabel: string | null; quantity: number }[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  status: string;
}

export async function appendOrder(
  order: OrderRow,
  settings?: SheetsConfig,
): Promise<AppendOutcome> {
  const resolved = settings ?? (await getSettings());

  const itemSummary = order.items
    .map(
      (item) =>
        `${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} x${item.quantity}`,
    )
    .join("\n");

  const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return appendRow(resolved, [
    order.orderNumber,
    /* ISO, so the sheet sorts chronologically whatever the viewer's locale. */
    order.placedAt.toISOString(),
    order.customerName,
    /* Leading apostrophe keeps Sheets from eating the leading zero on a
       Bangladeshi mobile number and rendering 1712345678. */
    `'${order.phone}`,
    order.address,
    order.areaText,
    order.deliveryZone === "inside_dhaka" ? "Inside Dhaka" : "Outside Dhaka",
    itemSummary,
    totalQuantity,
    order.subtotal,
    order.deliveryCharge,
    order.grandTotal,
    order.status,
  ]);
}

/**
 * Writes a header row plus one sample line, so the owner can confirm the
 * connection AND see the column layout before real orders arrive.
 */
export async function sendTestRow(settings?: SheetsConfig): Promise<AppendOutcome> {
  const resolved = settings ?? (await getSettings());

  return appendRow(
    resolved,
    [...SHEET_COLUMNS.map((column) => column)],
    { skipEnabledCheck: true },
  );
}
