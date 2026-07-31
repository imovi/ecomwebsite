import "server-only";

import { apiRequestSafe } from "@/lib/api/client";
import { CACHE_TAGS } from "@/lib/data/catalog";

/**
 * Browser-side tracking configuration, read at runtime.
 *
 * WHY NOT AN ENVIRONMENT VARIABLE
 * -------------------------------
 * A `NEXT_PUBLIC_*` value is inlined into the client bundle at build time, which
 * makes "paste your pixel id" a code deploy. For a shop owner who just created
 * an ad account that is not a workable answer, so both values live in the
 * database and are edited from the admin dashboard.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * The Conversions API token. Server-side Purchase events are sent by the API
 * itself, from the process that already holds the token, so the storefront never
 * needs it and there is no second copy to leak or rotate. See
 * `backend/src/modules/marketing/meta-capi.service.ts`.
 *
 * A failed read yields empty values — no pixel, no verification tag. Tracking
 * silently off is strictly better than a page that fails to render because an
 * analytics lookup timed out.
 */

export interface TrackingConfig {
  /** Empty when unset, or when tracking is switched off in the dashboard. */
  pixelId: string;
  /** Content of the `facebook-domain-verification` meta tag. Empty when unset. */
  domainVerification: string;
  /**
   * Google Tag Manager container id, e.g. `GTM-ABC1234`.
   *
   * Empty when unset or switched off. Gated on its own switch rather than the
   * Meta one — an owner running GA4 through GTM should not have to enable
   * Facebook tracking to get it.
   */
  gtmContainerId: string;
}

interface ApiPublicSettings {
  settings: {
    tracking?: {
      pixelId: string;
      domainVerification: string;
      gtmContainerId?: string;
    };
  };
}

const EMPTY: TrackingConfig = {
  pixelId: "",
  domainVerification: "",
  gtmContainerId: "",
};

export async function getTrackingConfig(): Promise<TrackingConfig> {
  const data = await apiRequestSafe<ApiPublicSettings>(
    "/api/v1/storefront/settings",
    { settings: {} },
    /* Same endpoint and tag as the public settings read, so both are one cached
       fetch and an admin change invalidates them together. */
    { revalidate: 300, tags: [CACHE_TAGS.settings] },
  );

  /* Optional in the type because an older API build will not send these. Treated
     as "not configured" rather than crashing the layout. */
  const tracking = data.settings.tracking;
  if (!tracking) return EMPTY;

  return {
    pixelId: tracking.pixelId,
    domainVerification: tracking.domainVerification,
    gtmContainerId: tracking.gtmContainerId ?? "",
  };
}
