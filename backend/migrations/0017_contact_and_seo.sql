-- The WhatsApp number and the page title, moved out of the build.
--
-- WHY THIS IS NOT COSMETIC
-- `NEXT_PUBLIC_WHATSAPP_NUMBER` is inlined into the client bundle at build time.
-- Changing the shop's contact number therefore meant a rebuild and a redeploy —
-- a restart would not pick it up, which is the kind of thing that gets
-- discovered at the worst moment. A phone number is not a deploy.
--
-- The title was half-configurable already: the shop name came from settings but
-- the tagline beside it was hardcoded, so the words a search result leads with
-- were not the shop's to choose.
--
-- Both default to empty, and empty means "use what was shown before". Adding
-- these columns changes nothing on screen until somebody fills them in.
alter table "store_settings" add column if not exists "store_whatsapp" text not null default '';--> statement-breakpoint
alter table "store_settings" add column if not exists "seo_title" text not null default '';--> statement-breakpoint
alter table "store_settings" add column if not exists "seo_description" text not null default '';
