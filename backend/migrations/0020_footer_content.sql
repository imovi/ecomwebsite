-- Footer text the shop owner can edit without a deploy.
--
-- The footer already read the store name, hotline and categories from the
-- database, so it renamed itself correctly — but the line under the name and
-- anything the shop wanted to add below the copyright were compiled in. Both
-- are ordinary copy, and copy is not a deploy.
--
-- Empty means "use the built-in", consistent with seo_title and the other text
-- columns here, which keeps them NOT NULL.
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "store_tagline" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "footer_note" text NOT NULL DEFAULT '';
