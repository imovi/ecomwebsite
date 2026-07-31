-- Remember how big each uploaded picture actually is.
--
-- The storefront was forcing every banner into one hardcoded aspect ratio and
-- cropping whatever did not fit, so a shop that uploaded a square or a very wide
-- banner got it cut off with no way to tell why. Knowing the real dimensions lets
-- the slider take the shape of the picture instead of the other way round, and
-- lets the header reserve the right box for a logo of any proportion.
--
-- Banner width/height are NOT NULL with a 0 default so existing rows stay valid;
-- 0 reads as "unknown" and the storefront falls back to its previous fixed ratio
-- for those. Any re-upload fills them in.
--
-- The mobile and logo columns are nullable because the pictures themselves are
-- optional — a null dimension and a null key always travel together.
ALTER TABLE "banners" ADD COLUMN "image_width" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "image_height" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "image_mobile_width" integer;--> statement-breakpoint
ALTER TABLE "banners" ADD COLUMN "image_mobile_height" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "store_logo_width" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "store_logo_height" integer;
