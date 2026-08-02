-- An interactive Telegram bot: buttons and commands, not just alerts.
--
-- WHY THE BOT WAS SEND-ONLY UNTIL NOW
-- Accepting input means a public webhook that can change orders, which needs a
-- secret on every update and an authorisation model of its own. That was not
-- worth building for alerts alone. It is worth it now: the courier webhook
-- already established the pattern, and the single most valuable thing this shop
-- can do is shorten the gap between an order arriving and someone confirming it
-- by phone. A Confirm button on the alert removes the trip to the panel.
--
-- WHY TWO COLUMNS
-- `telegram_webhook_secret` is what Telegram echoes back in
-- `X-Telegram-Bot-Api-Secret-Token`. The webhook URL is public and guessable;
-- this header is the only thing separating a real update from anyone who found
-- the address. Empty means interactive mode is OFF and the endpoint refuses
-- everything — blank must never read as "no check required".
--
-- `telegram_allowed_user_ids` narrows who may press the buttons. Empty means
-- anyone in the configured chat, which is right for a private staff group where
-- membership already is the access list. It earns its keep when the chat is a
-- large group and "in the group" should not mean "can cancel orders".
alter table "store_settings" add column if not exists "telegram_webhook_secret" text not null default '';--> statement-breakpoint
alter table "store_settings" add column if not exists "telegram_allowed_user_ids" text not null default '';--> statement-breakpoint

-- When the "someone left without finishing" alert was sent for a lead.
--
-- NOT fired on insert. The row is created the moment a phone number is typed
-- into the checkout, so alerting there announces that someone left while they
-- are still entering their address. And the row is rewritten on every keystroke
-- batch, so anything derived from `updated_at` would ring the same customer
-- again and again. A sweep alerts leads that have gone quiet for a few minutes
-- and stamps this column, which is also what makes the sweep idempotent across
-- restarts.
alter table "abandoned_checkouts" add column if not exists "alerted_at" timestamptz;--> statement-breakpoint

-- Finds the handful of leads still owed an alert without scanning the table.
create index if not exists "abandoned_checkouts_unalerted_idx" on "abandoned_checkouts" ("last_seen_at") where "alerted_at" is null and "recovered_order_id" is null;
