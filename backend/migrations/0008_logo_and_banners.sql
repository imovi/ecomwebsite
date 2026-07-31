-- Shop branding: a logo, and homepage banners.
--
-- Both were previously baked into the storefront — the logo was a hardcoded
-- wordmark in the header, and the banners were three committed SVG placeholders
-- in `src/data/banners.ts`. Changing either meant editing code and redeploying,
-- which is not something a shop owner can do.
--
-- WHY THE LOGO IS A COLUMN AND BANNERS ARE A TABLE
-- There is exactly one logo, so it belongs on the single settings row. Banners
-- are a list the owner adds to, reorders and switches off seasonally; numbering
-- them into settings columns would cap the count at whatever number was guessed
-- and turn reordering into a rewrite.
--
-- `store_logo_key` is nullable: NULL means "no logo uploaded, render the
-- wordmark", which is the correct state for a shop that has not made one yet.
--
-- Banner keys are storage keys rather than URLs. A stored URL breaks the day the
-- public hostname or the storage driver changes; a key is resolved at read time.
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_key" text NOT NULL,
	"image_mobile_key" text,
	"alt" text DEFAULT '' NOT NULL,
	"href" text DEFAULT '/' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "store_logo_key" text;--> statement-breakpoint
-- The storefront only ever asks for "active banners, in order"; this index
-- serves that query exactly.
CREATE INDEX "banners_active_order_idx" ON "banners" USING btree ("is_active","sort_order");
