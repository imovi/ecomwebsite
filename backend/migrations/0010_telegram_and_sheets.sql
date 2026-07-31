-- Telegram order alerts and Google Sheets export, both configured from the
-- admin panel.
--
-- WHY THESE TWO
-- On a cash-on-delivery shop the gap between an order arriving and someone
-- ringing the customer is money, and there is no email or SMS delivery in this
-- system by design. A Telegram push closes that gap for the price of a bot
-- token. The Sheets export gives the owner a familiar place to filter, share and
-- reconcile — one row per order, one-way: the sheet is a report, never something
-- the database reads back.
--
-- TWO SECRETS
-- `telegram_bot_token` and `google_sheets_credentials` are credentials. The
-- second is the worse of the two — it contains a private key. Both are
-- write-only through the API: it returns whether one is set and a masked hint,
-- never the value, exactly like the Meta Conversions API token in 0006.
--
-- `telegram_chat_id` is text, not an integer. Channel ids are large negatives
-- and group ids exceed a 32-bit column, so storing what Telegram returns avoids
-- silent truncation.
--
-- Both `*_enabled` flags default to FALSE. Adding columns must never start
-- pushing a live shop's order data to an outside service.
ALTER TABLE "store_settings" ADD COLUMN "telegram_bot_token" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "telegram_chat_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "telegram_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "google_sheets_credentials" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "google_sheets_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "google_sheets_tab" text DEFAULT 'Orders' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "google_sheets_enabled" boolean DEFAULT false NOT NULL;
