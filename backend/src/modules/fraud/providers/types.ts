/**
 * One courier's answer about one phone number.
 *
 * `total` is what the courier reports it has carried for this number, not
 * `success + cancel`: some panels count parcels still in transit in the total,
 * and quietly making the numbers add up would invent a certainty the courier
 * did not express.
 */
export interface CourierBreakdownItem {
  courier: string;
  label: string;
  success: number;
  cancel: number;
  total: number;
  successRatio: number;
}

export interface CourierMerchantReport {
  details: string;
  courierName?: string;
  createdAt?: string;
}

export interface CourierStat {
  success: number;
  cancel: number;
  total: number;
  /** Percentage, to two decimals. Zero when nothing has been carried. */
  successRatio: number;
  rating?: string;
  breakdown?: CourierBreakdownItem[];
  reports?: CourierMerchantReport[];
}

export interface FraudCredentials {
  identifier: string;
  secret: string;
}

/**
 * A courier we know how to ask.
 *
 * Each implementation signs in, asks about one number, and returns the same
 * shape. Failures throw — the service decides what a failure means, because
 * "this courier did not answer" and "this customer has no history" must never
 * become the same thing on the screen.
 */
export interface FraudProvider {
  readonly name: string;
  /** What the courier calls the thing you sign in with — shown in Settings. */
  readonly identifierLabel: string;
  readonly secretLabel?: string;
  readonly hint?: string;
  check(phone: string, credentials: FraudCredentials): Promise<CourierStat>;
}

/** Percentage of carried parcels that arrived. */
export function ratio(success: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((success / total) * 10_000) / 100;
}

/** A courier answering with nonsense should not become a negative count. */
export function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
