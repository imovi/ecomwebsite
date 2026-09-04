import { eq, or } from "drizzle-orm";
import { createLogger } from "../../core/logger.js";
import { NotFoundError } from "../../core/errors.js";
import { getDb } from "../../db/client.js";
import { orders } from "../../db/schema/orders.js";
import { getSettings } from "../settings/settings.service.js";
import { cleanPhone } from "../courier/steadfast.adapter.js";
import * as repo from "./fraud.repository.js";
import {
  FraudCheckError,
  PROVIDERS,
  PROVIDER_KEYS,
  ratio,
  type CourierStat,
  type ProviderKey,
} from "./providers/index.js";

const log = createLogger("fraud");

/**
 * What the couriers know about a phone number.
 *
 * WHY A FAILED COURIER IS NOT A ZERO
 * ----------------------------------
 * Every count here comes from a merchant panel that was never meant to be
 * queried by anything but its own dashboard. They go down, they change, they
 * lock accounts that sign in too often. The one thing this must never do is
 * turn "we could not ask" into "this customer has never had a parcel
 * delivered" — that is a number the desk would act on, and it would be wrong
 * about a real person.
 *
 * So couriers that failed are listed separately with their reason, the
 * aggregate is computed only from those that answered, and it carries the
 * count of both. A screen showing 0% next to "4 of 5 couriers did not answer"
 * is honest; a screen showing 0% alone is not.
 */

/** How long a stored answer stays good enough to reuse. */
const FRESH_FOR_MS = 24 * 60 * 60 * 1000;

export interface CourierResult extends CourierStat {
  courier: ProviderKey;
  /** What the courier calls itself, for the screen. */
  label: string;
}

export interface CourierFailure {
  courier: ProviderKey;
  label: string;
  kind: "credentials" | "upstream";
  message: string;
}

export interface FraudReport {
  phone: string;
  /** Couriers that answered. */
  couriers: CourierResult[];
  /** Couriers that were asked and did not. Never silently dropped. */
  failures: CourierFailure[];
  aggregate: {
    success: number;
    cancel: number;
    total: number;
    successRatio: number;
    /** So the screen can say "from 3 of 5 couriers" rather than implying all. */
    answered: number;
    asked: number;
  };
  checkedAt: string;
}

/** Whether any courier is configured at all — the screen asks before showing anything. */
export async function isConfigured(): Promise<boolean> {
  const accounts = await repo.listAccounts();
  if (accounts.some((account) => account.enabled && account.identifier && account.secret)) {
    return true;
  }
  const settings = await getSettings().catch(() => null);
  if (
    settings &&
    settings.courierApiKey.trim() !== "" &&
    settings.courierApiSecret.trim() !== ""
  ) {
    return true;
  }
  return false;
}

/**
 * The report for one number, from cache when it is recent enough.
 *
 * `force` skips the cache. It is what the button on the order page uses:
 * the desk is looking at this customer now and wants today's answer, not
 * yesterday's.
 */
export async function report(
  phone: string,
  options: { force?: boolean } = {},
): Promise<FraudReport | null> {
  const cleaned = cleanPhone(phone);

  if (!options.force) {
    const cached = await repo.findCheck(phone);
    if (cached && Date.now() - cached.checkedAt.getTime() < FRESH_FOR_MS) {
      return { ...(cached.result as FraudReport), checkedAt: cached.checkedAt.toISOString() };
    }
  }

  const storedAccounts = await repo.listAccounts();
  const accounts = storedAccounts.filter(
    (account) => account.enabled && account.identifier && account.secret,
  );

  // Auto-include Steadfast from store settings if credentials exist and not in accounts
  const settings = await getSettings().catch(() => null);
  if (
    settings &&
    settings.courierApiKey.trim() !== "" &&
    settings.courierApiSecret.trim() !== "" &&
    !accounts.some((a) => a.provider === "steadfast")
  ) {
    accounts.push({
      provider: "steadfast",
      identifier: settings.courierApiKey.trim(),
      secret: settings.courierApiSecret.trim(),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastOkAt: null,
      lastError: "",
    });
  }

  // Also query local store order history for this customer phone
  let localDelivered = 0;
  let localCancelled = 0;
  let hasLocalOrders = false;
  try {
    const localOrders = await getDb()
      .select({ status: orders.status })
      .from(orders)
      .where(or(eq(orders.phone, cleaned), eq(orders.phone, phone)));

    if (localOrders.length > 0) {
      hasLocalOrders = true;
      localDelivered = localOrders.filter((r) => r.status === "delivered").length;
      localCancelled = localOrders.filter(
        (r) => r.status === "cancelled" || r.status === "returned",
      ).length;
    }
  } catch (err) {
    log.warn({ err }, "Could not check local order history for customer");
  }

  if (accounts.length === 0 && !hasLocalOrders) {
    return {
      phone,
      couriers: [],
      failures: [],
      aggregate: {
        success: 0,
        cancel: 0,
        total: 0,
        successRatio: 0,
        answered: 0,
        asked: 0,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  /* Every courier is a separate sign-in to a separate company; none of them
     waits on another. One slow panel should not hold up the four that
     answered. */
  type Settled =
    | { ok: true; key: ProviderKey; label: string; stat: CourierStat }
    | {
        ok: false;
        key: ProviderKey;
        label: string;
        kind: "credentials" | "upstream";
        message: string;
      };

  const settled = await Promise.all(
    accounts.map(async (account): Promise<Settled> => {
      const key = account.provider as ProviderKey;
      const provider = PROVIDERS[key as keyof typeof PROVIDERS];

      if (!provider) {
        return {
          ok: false,
          key,
          label: key,
          kind: "upstream",
          message: "Unknown provider",
        };
      }

      try {
        const stat = await provider.check(cleaned, {
          identifier: account.identifier,
          secret: account.secret,
        });
        await repo.recordAttempt(key as keyof typeof PROVIDERS, { ok: true }).catch(() => null);
        return { ok: true, key, label: provider.name, stat };
      } catch (caught) {
        const failure =
          caught instanceof FraudCheckError
            ? { kind: caught.kind, message: caught.message }
            : { kind: "upstream" as const, message: `${provider.name} check failed unexpectedly.` };

        await repo.recordAttempt(key as keyof typeof PROVIDERS, { ok: false, error: failure.message }).catch(() => null);
        /* Logged with the courier but WITHOUT the phone number: this is a
           customer's number and a log is the easiest place for it to leak. */
        log.warn({ courier: key, kind: failure.kind }, "Courier fraud check failed");
        return { ok: false, key, label: provider.name, ...failure };
      }
    }),
  );

  const couriers: CourierResult[] = [];
  const failures: CourierFailure[] = [];

  for (const entry of settled) {
    if (entry.ok) {
      couriers.push({ courier: entry.key, label: entry.label, ...entry.stat });
    } else {
      failures.push({
        courier: entry.key,
        label: entry.label,
        kind: entry.kind,
        message: entry.message,
      });
    }
  }

  if (hasLocalOrders) {
    const localTotal = localDelivered + localCancelled;
    couriers.push({
      courier: "store" as ProviderKey,
      label: "This Store",
      success: localDelivered,
      cancel: localCancelled,
      total: localTotal,
      successRatio: localTotal > 0 ? ratio(localDelivered, localTotal) : 0,
    });
  }

  const success = couriers.reduce((sum, row) => sum + row.success, 0);
  const cancel = couriers.reduce((sum, row) => sum + row.cancel, 0);
  const total = couriers.reduce((sum, row) => sum + row.total, 0);

  const result: FraudReport = {
    phone,
    couriers,
    failures,
    aggregate: {
      success,
      cancel,
      total,
      successRatio: total > 0 ? ratio(success, total) : 0,
      answered: couriers.length,
      asked: accounts.length + (hasLocalOrders ? 1 : 0),
    },
    checkedAt: new Date().toISOString(),
  };

  /* Cached even when some couriers failed — the ones that answered are worth
     keeping, and the failures are part of the record the screen shows. A
     result where NOTHING answered is not stored, so the next look tries again
     instead of serving a wall of errors for a day. */
  if (couriers.length > 0) await repo.saveCheck(phone, result);

  return result;
}

/**
 * What is already known about a list of numbers. Never asks a courier.
 *
 * This is what the order list reads. Fifty rows must cost one database query,
 * not fifty sign-ins across five merchant panels — so a number nobody has
 * looked up yet is simply absent from the answer, and the row shows nothing
 * rather than a guess.
 */
export async function cachedFor(phones: string[]): Promise<Record<string, FraudReport>> {
  const unique = [...new Set(phones)];
  if (unique.length === 0) return {};

  const rows = await repo.findChecks(unique);
  const found: Record<string, FraudReport> = {};

  for (const row of rows) {
    found[row.phone] = {
      ...(row.result as FraudReport),
      checkedAt: row.checkedAt.toISOString(),
    };
  }

  return found;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface AccountDto {
  provider: ProviderKey;
  label: string;
  identifierLabel: string;
  identifier: string;
  /** Never the password itself. Only whether one is stored. */
  hasSecret: boolean;
  enabled: boolean;
  lastOkAt: string | null;
  lastError: string;
}

/** Every courier we can ask, configured or not, so Settings can list them all. */
export async function listAccounts(): Promise<AccountDto[]> {
  const stored = new Map(
    (await repo.listAccounts()).map((account) => [account.provider, account]),
  );

  return PROVIDER_KEYS.map((key) => {
    const account = stored.get(key);
    return {
      provider: key,
      label: PROVIDERS[key].name,
      identifierLabel: PROVIDERS[key].identifierLabel,
      identifier: account?.identifier ?? "",
      hasSecret: Boolean(account?.secret),
      enabled: account?.enabled ?? false,
      lastOkAt: account?.lastOkAt?.toISOString() ?? null,
      lastError: account?.lastError ?? "",
    };
  });
}

export interface SaveAccountInput {
  identifier: string;
  /** Absent means "leave the stored password alone". */
  secret?: string | undefined;
  enabled: boolean;
}

export async function saveAccount(
  provider: ProviderKey,
  input: SaveAccountInput,
): Promise<AccountDto[]> {
  await repo.saveAccount(provider, input);
  log.info({ courier: provider, enabled: input.enabled }, "Courier fraud credentials saved");
  return listAccounts();
}

export interface TestResult {
  ok: boolean;
  message: string;
  stat?: CourierStat;
}

/**
 * Signs in to one courier and asks about one number, so the shop can prove the
 * credentials work.
 *
 * This exists because nobody here can test these logins — they need the shop's
 * own merchant accounts. Without a button that says plainly whether a password
 * was accepted, a wrong one would show up later as a customer who mysteriously
 * has no history.
 */
export async function testAccount(provider: ProviderKey, phone: string): Promise<TestResult> {
  const account = await repo.findAccount(provider);

  if (!account || !account.identifier || !account.secret) {
    throw new NotFoundError(`${PROVIDERS[provider].name} has no sign-in details saved yet.`);
  }

  try {
    const stat = await PROVIDERS[provider].check(phone, {
      identifier: account.identifier,
      secret: account.secret,
    });

    await repo.recordAttempt(provider, { ok: true });
    return {
      ok: true,
      message: `${PROVIDERS[provider].name} answered: ${stat.success} delivered, ${stat.cancel} returned.`,
      stat,
    };
  } catch (caught) {
    const message =
      caught instanceof FraudCheckError
        ? caught.message
        : `${PROVIDERS[provider].name} check failed unexpectedly.`;

    await repo.recordAttempt(provider, { ok: false, error: message });
    return { ok: false, message };
  }
}
