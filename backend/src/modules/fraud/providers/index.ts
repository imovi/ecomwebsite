import { carrybee } from "./carrybee.js";
import { paperfly } from "./paperfly.js";
import { pathao } from "./pathao.js";
import { redx } from "./redx.js";
import { steadfast } from "./steadfast.js";
import type { FraudProvider } from "./types.js";

/**
 * Every courier we know how to ask, keyed the way the database stores it.
 *
 * The keys here and the CHECK constraint on `courier_fraud_accounts.provider`
 * are the same list written twice, in two languages. Adding a courier means
 * both — the constraint turns a typo into an error at the point of saving
 * rather than a row that silently never runs.
 */
export const PROVIDERS = {
  steadfast,
  pathao,
  redx,
  paperfly,
  carrybee,
} as const satisfies Record<string, FraudProvider>;

export type ProviderKey = keyof typeof PROVIDERS | "store";

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as ProviderKey[];

export function isProviderKey(value: string): value is ProviderKey {
  return Object.hasOwn(PROVIDERS, value);
}

export * from "./types.js";
export * from "./errors.js";
