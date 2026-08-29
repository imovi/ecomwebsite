-- Remembering that a low-stock warning already went out.
--
-- The scheduler wakes every five minutes. Without somewhere to record that a
-- product has already been reported, it would send the same warning twelve
-- times an hour until somebody restocked — and an alert that arrives twelve
-- times an hour is an alert people mute, including on the night it matters.
--
-- Cleared when the stock climbs back above the threshold, so the NEXT time it
-- runs down the shop is told again. The column is therefore "have we mentioned
-- this dip", not "has this ever been low".
--
-- WHY ON THE VARIANT TOO
-- A product's stock is the sum of its variants, so a shirt with twenty in stock
-- looks healthy while size M is gone. That is the case that quietly wastes ad
-- money: the campaign keeps running, the customer who wanted M leaves, and the
-- total never dips far enough to warn anybody.
--
-- Additive only.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "low_stock_alerted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "low_stock_alerted_at" timestamptz;
