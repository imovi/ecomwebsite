import { eq, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { storeSettings, type StoreSettingsRow } from "../../db/schema/store-settings.js";
import { BadRequestError, NotFoundError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import { getStorage } from "../../lib/storage/index.js";
import { optimizeImage } from "../../lib/images/optimizer.js";
import { parseCredentials, resetTokenCache } from "../integrations/google-sheets.service.js";
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
  /**
   * What an order costs the shop, as opposed to what it charges for.
   *
   * `courier` is deliberately separate from `delivery` above: one is what the
   * customer pays, the other what the courier bills. They are rarely equal, and
   * on free delivery the gap is a loss that is otherwise invisible.
   */
  costs: {
    courierInsideDhaka: number;
    courierOutsideDhaka: number;
    packagingPerOrder: number;
    returnPerOrder: number;
  };
  store: {
    name: string;
    phone: string;
    email: string;
    address: string;
    invoiceFooter: string;
    /**
     * Resolved URL of the uploaded logo, or null to use the wordmark.
     *
     * A URL rather than the stored key: clients never see storage keys, so the
     * bucket layout stays an implementation detail.
     */
    logoUrl: string | null;
    /** Real size of the logo, so the header can reserve the right box. */
    logoWidth: number | null;
    logoHeight: number | null;
  };
  /**
   * Meta / Facebook tracking.
   *
   * Note what is NOT here: the Conversions API token. It is write-only by
   * design. `hasCapiToken` and `capiTokenHint` are enough for the dashboard to
   * show whether one is configured and which one, without ever putting a live
   * credential back on the wire.
   */
  tracking: {
    pixelId: string;
    testEventCode: string;
    domainVerification: string;
    enabled: boolean;
    hasCapiToken: boolean;
    /** Last four characters, e.g. `••••4f2a`. Empty when unset. */
    capiTokenHint: string;
    /** Google Tag Manager container id, e.g. `GTM-ABC1234`. */
    gtmContainerId: string;
    gtmEnabled: boolean;
  };
  /**
   * Courier hand-off.
   *
   * The key and secret are absent by design, like every other credential here.
   * `provider` and the `has…` flags are all the dashboard needs.
   */
  courier: {
    provider: string;
    hasCredentials: boolean;
    apiKeyHint: string;
    storeId: string;
    baseUrl: string;
    enabled: boolean;
  };
  /**
   * Order integrations.
   *
   * The two credentials are absent by design — write-only, like the Meta token.
   * `has…` plus a masked hint is all a dashboard needs to show state.
   */
  integrations: {
    telegram: {
      hasBotToken: boolean;
      botTokenHint: string;
      chatId: string;
      enabled: boolean;
    };
    googleSheets: {
      hasCredentials: boolean;
      /** The service account's email — public, and needed to share the sheet. */
      serviceAccountEmail: string | null;
      sheetId: string;
      tab: string;
      enabled: boolean;
    };
  };
  updatedAt: string;
}

/**
 * Pulls the account email out of a service-account key.
 *
 * Safe to expose while the key itself is not: the email is what the owner must
 * share the spreadsheet with, and forgetting to do that is the most common
 * reason the export fails. Reading it back saves them re-opening the key file.
 */
function serviceAccountEmailOf(credentials: string): string | null {
  if (credentials.trim() === "") return null;
  try {
    const parsed = JSON.parse(credentials) as { client_email?: string };
    return parsed.client_email ?? null;
  } catch {
    /* A corrupt key is reported by the integration's own status, not here. */
    return null;
  }
}

/** Shows enough of a token to tell two apart, never enough to use one. */
function tokenHint(token: string): string {
  if (token === "") return "";
  return `••••${token.slice(-4)}`;
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
    costs: {
      courierInsideDhaka: row.courierCostInsideDhaka,
      courierOutsideDhaka: row.courierCostOutsideDhaka,
      packagingPerOrder: row.packagingCostPerOrder,
      returnPerOrder: row.returnCostPerOrder,
    },
    store: {
      name: row.storeName,
      phone: row.storePhone,
      email: row.storeEmail,
      address: row.storeAddress,
      invoiceFooter: row.invoiceFooter,
      logoUrl: row.storeLogoKey ? getStorage().url(row.storeLogoKey) : null,
      logoWidth: row.storeLogoWidth,
      logoHeight: row.storeLogoHeight,
    },
    tracking: {
      pixelId: row.metaPixelId,
      testEventCode: row.metaTestEventCode,
      domainVerification: row.metaDomainVerification,
      enabled: row.metaTrackingEnabled,
      hasCapiToken: row.metaCapiToken !== "",
      capiTokenHint: tokenHint(row.metaCapiToken),
      gtmContainerId: row.googleGtmContainerId,
      gtmEnabled: row.googleGtmEnabled,
    },
    courier: {
      provider: row.courierProvider,
      hasCredentials: row.courierApiKey !== "" && row.courierApiSecret !== "",
      apiKeyHint: tokenHint(row.courierApiKey),
      storeId: row.courierStoreId,
      baseUrl: row.courierBaseUrl,
      enabled: row.courierEnabled,
    },
    integrations: {
      telegram: {
        hasBotToken: row.telegramBotToken !== "",
        botTokenHint: tokenHint(row.telegramBotToken),
        chatId: row.telegramChatId,
        enabled: row.telegramEnabled,
      },
      googleSheets: {
        hasCredentials: row.googleSheetsCredentials !== "",
        serviceAccountEmail: serviceAccountEmailOf(row.googleSheetsCredentials),
        sheetId: row.googleSheetsId,
        tab: row.googleSheetsTab,
        enabled: row.googleSheetsEnabled,
      },
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
  courier?: {
    provider?: string;
    /** Omitted keeps the stored key; `null` clears it. */
    apiKey?: string | null;
    apiSecret?: string | null;
    storeId?: string;
    baseUrl?: string;
    enabled?: boolean;
  };
  costs?: {
    courierInsideDhaka?: number;
    courierOutsideDhaka?: number;
    packagingPerOrder?: number;
    returnPerOrder?: number;
  };
  store?: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    invoiceFooter?: string;
  };
  tracking?: {
    pixelId?: string;
    testEventCode?: string;
    domainVerification?: string;
    enabled?: boolean;
    /**
     * Omitted leaves the stored token alone; `null` clears it; a string replaces
     * it. Without the three-way distinction the dashboard could not save any
     * other tracking field without either wiping the token or re-sending it,
     * and it never has the value to re-send.
     */
    capiToken?: string | null;

    /** Google Tag Manager. Nothing secret, so no write-only handling needed. */
    gtmContainerId?: string;
    gtmEnabled?: boolean;
  };
  integrations?: {
    telegram?: {
      /** Omitted keeps the stored token; `null` clears it. */
      botToken?: string | null;
      chatId?: string;
      enabled?: boolean;
    };
    googleSheets?: {
      /** Omitted keeps the stored key; `null` clears it. */
      credentials?: string | null;
      sheetId?: string;
      tab?: string;
      enabled?: boolean;
    };
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

  if (input.tracking?.pixelId !== undefined) patch.metaPixelId = input.tracking.pixelId;
  if (input.tracking?.testEventCode !== undefined) {
    patch.metaTestEventCode = input.tracking.testEventCode;
  }
  if (input.tracking?.domainVerification !== undefined) {
    patch.metaDomainVerification = input.tracking.domainVerification;
  }
  if (input.tracking?.enabled !== undefined) patch.metaTrackingEnabled = input.tracking.enabled;
  if (input.tracking?.capiToken !== undefined) {
    /* `null` means clear. The column is NOT NULL, so "cleared" is the empty
       string — the same "not configured" representation used everywhere here. */
    patch.metaCapiToken = input.tracking.capiToken ?? "";
  }
  if (input.tracking?.gtmContainerId !== undefined) {
    patch.googleGtmContainerId = input.tracking.gtmContainerId;
  }
  if (input.tracking?.gtmEnabled !== undefined) {
    patch.googleGtmEnabled = input.tracking.gtmEnabled;
  }

  const courier = input.courier;
  if (courier?.provider !== undefined) patch.courierProvider = courier.provider;
  if (courier?.apiKey !== undefined) patch.courierApiKey = courier.apiKey ?? "";
  if (courier?.apiSecret !== undefined) patch.courierApiSecret = courier.apiSecret ?? "";
  if (courier?.storeId !== undefined) patch.courierStoreId = courier.storeId;
  if (courier?.baseUrl !== undefined) patch.courierBaseUrl = courier.baseUrl;
  if (courier?.enabled !== undefined) patch.courierEnabled = courier.enabled;

  const costs = input.costs;
  if (costs?.courierInsideDhaka !== undefined) {
    patch.courierCostInsideDhaka = costs.courierInsideDhaka;
  }
  if (costs?.courierOutsideDhaka !== undefined) {
    patch.courierCostOutsideDhaka = costs.courierOutsideDhaka;
  }
  if (costs?.packagingPerOrder !== undefined) {
    patch.packagingCostPerOrder = costs.packagingPerOrder;
  }
  if (costs?.returnPerOrder !== undefined) {
    patch.returnCostPerOrder = costs.returnPerOrder;
  }

  const telegram = input.integrations?.telegram;
  if (telegram?.botToken !== undefined) patch.telegramBotToken = telegram.botToken ?? "";
  if (telegram?.chatId !== undefined) patch.telegramChatId = telegram.chatId;
  if (telegram?.enabled !== undefined) patch.telegramEnabled = telegram.enabled;

  const gsheets = input.integrations?.googleSheets;
  if (gsheets?.credentials !== undefined) {
    /* Checked on the way IN, not on the way out.
       A schema can only say "a long string"; whether this is a service account
       key — rather than the OAuth client key sitting next to it in the Google
       console, which is the easy one to download by mistake — needs the parser.
       Storing an unusable key would look like success and fail silently on the
       first real order, hours later and with no one watching. */
    if (gsheets.credentials !== null) {
      const parsed = parseCredentials(gsheets.credentials);
      if ("error" in parsed) throw new BadRequestError(parsed.error);
    }

    patch.googleSheetsCredentials = gsheets.credentials ?? "";
    /* A new key means the cached access token belongs to the old account. */
    resetTokenCache();
  }
  if (gsheets?.sheetId !== undefined) patch.googleSheetsId = gsheets.sheetId;
  if (gsheets?.tab !== undefined) patch.googleSheetsTab = gsheets.tab;
  if (gsheets?.enabled !== undefined) patch.googleSheetsEnabled = gsheets.enabled;

  const rows = await getDb()
    .update(storeSettings)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(storeSettings.id, 1))
    .returning();

  const updated = rows[0];
  if (!updated) throw new NotFoundError("Store settings row is missing.");

  /* Field NAMES only. Logging the patch itself would put a live Conversions API
     token into the log stream, where it outlives any rotation. */
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

/* -------------------------------------------------------------------------- */
/* Logo                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A wordmark is often 400×80, well under the 200px floor that is right for
 * product photography. Enforcing that here would make the feature unusable for
 * exactly the shops most likely to have a simple logo.
 */
const MIN_LOGO_DIMENSION = 48;

export async function setLogo(file: {
  buffer: Buffer;
  originalname: string;
}): Promise<SettingsDto> {
  const existing = await getSettings();

  const optimized = await optimizeImage(file.buffer, {
    label: file.originalname,
    minDimension: MIN_LOGO_DIMENSION,
    kind: "Logos",
  });

  const stored = await getStorage().put({
    folder: "branding",
    buffer: optimized.buffer,
    mimeType: optimized.mimeType,
    originalName: file.originalname,
  });

  const rows = await getDb()
    .update(storeSettings)
    .set({
      storeLogoKey: stored.key,
      storeLogoWidth: optimized.width,
      storeLogoHeight: optimized.height,
      updatedAt: sql`now()`,
    })
    .where(eq(storeSettings.id, 1))
    .returning();

  const updated = rows[0];
  if (!updated) {
    /* Nothing points at the new file, so leave no orphan behind. */
    await getStorage().delete(stored.key).catch(() => undefined);
    throw new NotFoundError("Store settings row is missing.");
  }

  /* Only once the new key is committed. Deleting first would leave the shop with
     no logo at all if the update then failed. */
  if (existing.storeLogoKey && existing.storeLogoKey !== stored.key) {
    await getStorage()
      .delete(existing.storeLogoKey)
      .catch((error: unknown) => {
        log.error({ err: error, key: existing.storeLogoKey }, "Failed to delete replaced logo");
      });
  }

  log.info({ key: stored.key }, "Store logo updated");
  return toSettingsDto(updated);
}

export async function removeLogo(): Promise<SettingsDto> {
  const existing = await getSettings();

  const rows = await getDb()
    .update(storeSettings)
    .set({
      storeLogoKey: null,
      storeLogoWidth: null,
      storeLogoHeight: null,
      updatedAt: sql`now()`,
    })
    .where(eq(storeSettings.id, 1))
    .returning();

  const updated = rows[0];
  if (!updated) throw new NotFoundError("Store settings row is missing.");

  if (existing.storeLogoKey) {
    await getStorage()
      .delete(existing.storeLogoKey)
      .catch((error: unknown) => {
        log.error({ err: error, key: existing.storeLogoKey }, "Failed to delete logo");
      });
  }

  log.info("Store logo removed");
  return toSettingsDto(updated);
}
