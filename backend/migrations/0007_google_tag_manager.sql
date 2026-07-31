-- Google Tag Manager, configured from the dashboard.
--
-- A GTM container id rather than a GA4 measurement id, deliberately. GTM is the
-- container the shop owner then puts GA4, Google Ads conversion tracking and
-- remarketing tags inside, so this one column stands in for a growing list of
-- per-vendor id columns — adding a new vendor becomes a change in Google's own UI
-- instead of a migration here.
--
-- Nothing about GTM is secret: the container id is visible in the page source of
-- every site that uses one, and there is no server-side API to hold a token for.
-- That is the whole difference from the Meta columns added in 0006, and the
-- reason nothing here needs masking.
--
-- `google_gtm_enabled` defaults to FALSE for the same reason `meta_tracking_enabled`
-- does: a migration must never silently start loading a third-party script on a
-- live storefront.
ALTER TABLE "store_settings" ADD COLUMN "google_gtm_container_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "google_gtm_enabled" boolean DEFAULT false NOT NULL;
