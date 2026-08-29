-- Reading ad spend back out of Meta.
--
-- Two parts. The campaigns a shop is actually running, registered by hand so
-- the report is not filled with every paused experiment the ad account
-- remembers; and the three settings needed to ask Meta about them.
--
-- WHY THE EXCHANGE RATE IS A COLUMN AND NOT A LOOKUP
-- Meta bills in the ad account's currency, which for a shop here is dollars,
-- while every other figure in this system is taka. A rate fetched live would
-- silently restate last month's ad spend every time the market moved — the
-- report an owner read on Monday would disagree with itself on Friday. The
-- shop records what it was actually charged at.
--
-- Additive only. Nothing existing is touched.
CREATE TABLE IF NOT EXISTS "ad_campaigns" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The id as Meta knows it. Text, not a number: Meta's ids run past what a
  -- 32-bit integer holds and nothing here does arithmetic on them.
  "meta_id"    text NOT NULL,
  -- What the shop calls it. Meta's own name is fetched and shown beside this.
  "label"      text NOT NULL DEFAULT '',
  -- The product being sold, when the campaign sells one. Nullable: a campaign
  -- can promote a category or the shop itself.
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  -- Paused campaigns stay registered but stop being fetched, so switching one
  -- off for a month does not mean re-pasting its id from Ads Manager later.
  "is_active"  boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Digits only, and long enough to be a real id. A pasted URL or a campaign
-- NAME fails here rather than becoming a row that quietly returns nothing.
ALTER TABLE "ad_campaigns"
  DROP CONSTRAINT IF EXISTS "ad_campaigns_meta_id_digits";
--> statement-breakpoint
ALTER TABLE "ad_campaigns"
  ADD CONSTRAINT "ad_campaigns_meta_id_digits"
  CHECK ("meta_id" ~ '^[0-9]{5,32}$');
--> statement-breakpoint
-- One row per Meta id. The same campaign pasted twice is a mistake, not a
-- second campaign, and two rows would double its spend in every total.
CREATE UNIQUE INDEX IF NOT EXISTS "ad_campaigns_meta_id_key"
  ON "ad_campaigns" ("meta_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_campaigns_active_idx"
  ON "ad_campaigns" ("is_active");
--> statement-breakpoint
-- The ad account, as `act_<digits>`, so it can be pasted straight from Ads
-- Manager without the shop having to know which half to keep.
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "meta_ad_account_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
-- An `ads_read` token. A SECRET, and a more dangerous one than the Conversions
-- API token beside it: that one only writes events, this one can read every
-- campaign's spend and results the account has ever run. Returned to the panel
-- only as a masked hint, never in full.
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "meta_ads_token" text NOT NULL DEFAULT '';
--> statement-breakpoint
-- Taka per US dollar, in paisa: 12250 is ৳122.50. Zero means "not set", and
-- the reports say so rather than converting at a rate nobody chose.
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "usd_rate_paisa" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "store_settings"
  DROP CONSTRAINT IF EXISTS "store_settings_usd_rate_non_negative";
--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD CONSTRAINT "store_settings_usd_rate_non_negative"
  CHECK ("usd_rate_paisa" >= 0);
