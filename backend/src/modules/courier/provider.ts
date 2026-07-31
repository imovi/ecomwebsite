import type { ShipmentStatus } from "../../db/schema/courier-shipments.js";

/**
 * What every courier has to be able to do, and nothing more.
 *
 * Two providers sit behind this today — Steadfast and Pathao — and they are
 * genuinely different animals: one authenticates with a static key pair and
 * takes a written address, the other needs an OAuth token refreshed on a timer
 * and numeric city/zone ids looked up from its own API. Keeping the difference
 * inside an adapter means the order page, the sync and the customer's tracking
 * page never learn which company carried a parcel.
 */

export interface ParcelRequest {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  /** Taka to collect at the door. Zero for an already-paid order. */
  codAmount: number;
  /** For the courier's own manifest, and for weight-based pricing. */
  itemDescription: string;
  totalQuantity: number;
  note?: string | undefined;
}

export interface ParcelCreated {
  consignmentId: string;
  trackingCode: string;
  /** What the courier says it will collect, for reconciliation. */
  codAmount: number;
}

export interface ParcelStatus {
  /** Verbatim, kept for support questions and for spotting a mapping gap. */
  raw: string;
  mapped: ShipmentStatus;
}

/**
 * A failure the operator can act on.
 *
 * Courier APIs answer with HTTP 200 and an error body about as often as they
 * use a status code, so every adapter normalises both into this. The message
 * is shown in the admin panel, so it has to read as an instruction rather than
 * a stack trace.
 */
export class CourierError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CourierError";
  }
}

export interface CourierProviderAdapter {
  readonly name: string;
  createParcel(parcel: ParcelRequest): Promise<ParcelCreated>;
  fetchStatus(consignmentId: string): Promise<ParcelStatus>;
  /** Proves the credentials work before an order depends on them. */
  verifyCredentials(): Promise<{ ok: boolean; detail: string }>;
}

/**
 * Bounded, because a courier that hangs must not hold an admin request open.
 * These are called from a button press and from a background sync, never from
 * a customer's checkout.
 */
export const COURIER_TIMEOUT_MS = 12_000;

/**
 * Maps a courier's wording onto ours.
 *
 * Deliberately generous with synonyms: couriers use `in_review`, `pending`,
 * `hold` and `partial_delivered` interchangeably across providers and change
 * them without notice. Anything unrecognised becomes `unknown` — which the
 * panel shows as "check with the courier" rather than guessing, and which never
 * silently marks an order delivered.
 */
export function mapStatus(raw: string): ShipmentStatus {
  const value = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");

  if (/(^|_)delivered/.test(value) && !value.includes("partial")) return "delivered";
  if (value.includes("partial_delivered")) return "delivered";

  if (
    value.includes("return") ||
    value.includes("cancelled_return") ||
    value.includes("delivery_failed")
  ) {
    return "returned";
  }

  if (value.includes("cancel")) return "cancelled";

  if (
    value.includes("out_for_delivery") ||
    value.includes("on_the_way") ||
    value.includes("assigned_for_delivery")
  ) {
    return "out_for_delivery";
  }

  if (
    value.includes("in_transit") ||
    value.includes("transit") ||
    value.includes("at_sorting") ||
    value.includes("received_at") ||
    value.includes("on_hold") ||
    value.includes("hold")
  ) {
    return "in_transit";
  }

  if (value.includes("picked") || value.includes("pickup_done")) return "picked_up";

  if (
    value === "pending" ||
    value.includes("in_review") ||
    value.includes("pickup_requested") ||
    value.includes("assigned_for_pickup")
  ) {
    return "pending";
  }

  return "unknown";
}
