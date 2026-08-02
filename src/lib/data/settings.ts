import "server-only";

import { apiRequestSafe } from "@/lib/api/client";
import { CACHE_TAGS } from "@/lib/data/catalog";
import type { StoreSettings } from "@/types";

/**
 * Public store settings, backed by the API.
 *
 * Delivery charges are read from the database rather than hardcoded, so the
 * shop owner can change what they charge without a deploy.
 *
 * WHY THE FALLBACK IS NOT AN ERROR PATH
 * -------------------------------------
 * These values appear in the footer and as a hint on product pages. If the
 * settings read fails, showing the last known-good defaults is better than
 * failing the page — nobody pays money based on this call.
 *
 * The checkout path deliberately does NOT use it. There, the delivery charge
 * comes from the API's own quote endpoint and is recomputed server-side again
 * at order placement, so the figure a customer agrees to can never come from a
 * client-side default.
 */

interface ApiPublicSettings {
  settings: {
    delivery: {
      insideDhaka: number;
      outsideDhaka: number;
      freeDeliveryThreshold: number;
    };
    store: {
      name: string;
      phone: string;
      email: string;
      logoUrl?: string | null;
      logoWidth?: number | null;
      logoHeight?: number | null;
      faviconUrl?: string | null;
      whatsapp?: string | null;
      seoTitle?: string | null;
      seoDescription?: string | null;
    };
  };
}

/** Last-resort display values, used only if the API is unreachable. */
const FALLBACK: StoreSettings = {
  deliveryInsideDhaka: 80,
  deliveryOutsideDhaka: 130,
  freeDeliveryThreshold: 0,
  whatsappNumber: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "",
  hotline: process.env.NEXT_PUBLIC_HOTLINE ?? "",
};

export async function getSettings(): Promise<StoreSettings> {
  const data = await apiRequestSafe<ApiPublicSettings>(
    "/api/v1/storefront/settings",
    { settings: { delivery: { insideDhaka: FALLBACK.deliveryInsideDhaka, outsideDhaka: FALLBACK.deliveryOutsideDhaka, freeDeliveryThreshold: 0 }, store: { name: "", phone: "", email: "" } } },
    { revalidate: 300, tags: [CACHE_TAGS.settings] },
  );

  return {
    deliveryInsideDhaka: data.settings.delivery.insideDhaka,
    deliveryOutsideDhaka: data.settings.delivery.outsideDhaka,
    freeDeliveryThreshold: data.settings.delivery.freeDeliveryThreshold,
    /* Settings first, the build-time env only as a fallback. It used to be the
       other way round, which made changing the shop's WhatsApp number a rebuild:
       `NEXT_PUBLIC_*` is inlined into the client bundle, so a restart would not
       pick up a new value. The env var stays as the fallback so an existing
       deployment keeps working until the number is entered in the panel. */
    whatsappNumber: data.settings.store.whatsapp || FALLBACK.whatsappNumber,
    hotline: data.settings.store.phone || FALLBACK.hotline,
    ...(data.settings.store.logoUrl ? { logoUrl: data.settings.store.logoUrl } : {}),
    ...(data.settings.store.logoWidth ? { logoWidth: data.settings.store.logoWidth } : {}),
    ...(data.settings.store.logoHeight ? { logoHeight: data.settings.store.logoHeight } : {}),
    ...(data.settings.store.name ? { storeName: data.settings.store.name } : {}),
    ...(data.settings.store.faviconUrl
      ? { faviconUrl: data.settings.store.faviconUrl }
      : {}),
    ...(data.settings.store.seoTitle ? { seoTitle: data.settings.store.seoTitle } : {}),
    ...(data.settings.store.seoDescription
      ? { seoDescription: data.settings.store.seoDescription }
      : {}),
  };
}
