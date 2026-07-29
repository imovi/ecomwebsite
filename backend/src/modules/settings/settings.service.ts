import { eq, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { storeSettings, type StoreSettingsRow } from "../../db/schema/store-settings.js";
import { NotFoundError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import type { DeliveryZone } from "../../db/schema/order-enums.js";

/**
 * Store settings.
 *
 * A single row, seeded by the migration, so no consumer ever has to handle a
 * missing configuration.
 *
 * Delivery charges are read from here on every quote and every recalculation
 * rather than captured once at boot: an operator changing the outside-Dhaka
 * charge must affect the next order immediately, not after a deploy.
 */

const log = createLogger("settings");

export interface SettingsDto {
  delivery: {
    insideDhaka: number;
    outsideDhaka: number;
    freeDeliveryThreshold: number;
  };
  ordering: {
    minimumOrderValue: number;
    maxQuantityPerItem: number;
  };
  store: {
    name: string;
    phone: string;
    email: string;
    address: string;
    invoiceFooter: string;
  };
  updatedAt: string;
}

export function toSettingsDto(row: StoreSettingsRow): SettingsDto {
  return {
    delivery: {
      insideDhaka: row.deliveryChargeInsideDhaka,
      outsideDhaka: row.deliveryChargeOutsideDhaka,
      freeDeliveryThreshold: row.freeDeliveryThreshold,
    },
    ordering: {
      minimumOrderValue: row.minimumOrderValue,
      maxQuantityPerItem: row.maxQuantityPerItem,
    },
    store: {
      name: row.storeName,
      phone: row.storePhone,
      email: row.storeEmail,
      address: row.storeAddress,
      invoiceFooter: row.invoiceFooter,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Loads the settings row.
 *
 * Takes an executor so it can be read inside the same transaction that is
 * pricing an order — using a different connection could read a charge that a
 * concurrent settings update is halfway through changing.
 */
export async function getSettings(
  executor: DatabaseExecutor = getDb(),
): Promise<StoreSettingsRow> {
  const rows = await executor.select().from(storeSettings).where(eq(storeSettings.id, 1)).limit(1);
  const row = rows[0];

  if (!row) {
    /* The migration seeds this row and a CHECK constraint keeps it singular,
       so its absence means the database was tampered with. */
    throw new NotFoundError("Store settings row is missing. Re-run migrations.");
  }

  return row;
}

export async function getSettingsDto(): Promise<SettingsDto> {
  return toSettingsDto(await getSettings());
}

export interface UpdateSettingsInput {
  delivery?: {
    insideDhaka?: number;
    outsideDhaka?: number;
    freeDeliveryThreshold?: number;
  };
  ordering?: {
    minimumOrderValue?: number;
    maxQuantityPerItem?: number;
  };
  store?: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    invoiceFooter?: string;
  };
}

export async function updateSettings(input: UpdateSettingsInput): Promise<SettingsDto> {
  const patch: Partial<StoreSettingsRow> = {};

  if (input.delivery?.insideDhaka !== undefined) {
    patch.deliveryChargeInsideDhaka = input.delivery.insideDhaka;
  }
  if (input.delivery?.outsideDhaka !== undefined) {
    patch.deliveryChargeOutsideDhaka = input.delivery.outsideDhaka;
  }
  if (input.delivery?.freeDeliveryThreshold !== undefined) {
    patch.freeDeliveryThreshold = input.delivery.freeDeliveryThreshold;
  }
  if (input.ordering?.minimumOrderValue !== undefined) {
    patch.minimumOrderValue = input.ordering.minimumOrderValue;
  }
  if (input.ordering?.maxQuantityPerItem !== undefined) {
    patch.maxQuantityPerItem = input.ordering.maxQuantityPerItem;
  }
  if (input.store?.name !== undefined) patch.storeName = input.store.name;
  if (input.store?.phone !== undefined) patch.storePhone = input.store.phone;
  if (input.store?.email !== undefined) patch.storeEmail = input.store.email;
  if (input.store?.address !== undefined) patch.storeAddress = input.store.address;
  if (input.store?.invoiceFooter !== undefined) patch.invoiceFooter = input.store.invoiceFooter;

  const rows = await getDb()
    .update(storeSettings)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(storeSettings.id, 1))
    .returning();

  const updated = rows[0];
  if (!updated) throw new NotFoundError("Store settings row is missing.");

  log.info({ fields: Object.keys(patch) }, "Store settings updated");
  return toSettingsDto(updated);
}

/* -------------------------------------------------------------------------- */
/* Delivery pricing                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The delivery charge for a zone.
 *
 * The free-delivery threshold is evaluated against the goods subtotal. Kept
 * here rather than inlined at call sites so the quote endpoint, order
 * placement and every admin recalculation cannot drift apart — the number a
 * customer was quoted must be the number they are charged.
 */
export function calculateDeliveryCharge(
  settings: StoreSettingsRow,
  zone: DeliveryZone,
  subtotal: number,
): number {
  if (settings.freeDeliveryThreshold > 0 && subtotal >= settings.freeDeliveryThreshold) {
    return 0;
  }

  return zone === "inside_dhaka"
    ? settings.deliveryChargeInsideDhaka
    : settings.deliveryChargeOutsideDhaka;
}

export interface OrderTotals {
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
}

export function calculateTotals(
  settings: StoreSettingsRow,
  zone: DeliveryZone,
  subtotal: number,
): OrderTotals {
  const deliveryCharge = calculateDeliveryCharge(settings, zone, subtotal);
  return { subtotal, deliveryCharge, grandTotal: subtotal + deliveryCharge };
}
