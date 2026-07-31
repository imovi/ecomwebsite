-- Meta / Facebook tracking configuration moves into the database.
--
-- Previously the pixel id and Conversions API token were environment variables.
-- The pixel id is inlined into the storefront's client bundle at build time,
-- which made "connect your pixel" a code deploy instead of a form — unusable for
-- a shop owner who just created their ad account.
--
-- `meta_tracking_enabled` defaults to FALSE on purpose. Adding columns must not
-- silently start sending conversion events to whatever pixel happens to be
-- configured; the owner turns it on once they have verified events arriving in
-- the Test Events console.
--
-- Every column is NOT NULL with an empty default, so the single settings row
-- stays fully populated and no consumer has to handle NULL.
ALTER TABLE "store_settings" ADD COLUMN "meta_pixel_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "meta_capi_token" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "meta_test_event_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "meta_domain_verification" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "meta_tracking_enabled" boolean DEFAULT false NOT NULL;
