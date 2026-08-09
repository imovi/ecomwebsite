-- Where the customer came from, kept with the order.
--
-- The conversion sent to Meta could only say "an order happened, and here is a
-- hashed phone number". In Bangladesh a phone number is frequently not on the
-- Facebook account at all, so a large share of real sales could not be matched
-- to the person who made them — which means they could not be matched to the ad
-- that paid for them either. Meta scored the match quality 2.5 out of 10, and a
-- conversion nobody can attribute cannot teach a campaign anything.
--
-- `fbc` is the click. Facebook appends `fbclid` to the landing URL of an ad
-- click and the pixel stores it in the `_fbc` cookie; it names the exact ad and
-- the exact click, so sending it turns attribution from a guess into a lookup.
-- `fbp` identifies the browser the pixel already knows.
--
-- Stored rather than passed straight through to the report: the conversion is
-- sent from the order event bus AFTER the transaction commits, and a value held
-- only in the request would be lost to precisely the retries and replays where
-- reporting matters most.
--
-- Nullable with no default, and no backfill. Most orders have neither — a
-- customer who found the shop without clicking an ad has no click to record —
-- and past orders were placed before anything captured these. Two nullable
-- columns on a live table is a catalogue update, not a rewrite: it does not
-- touch the existing rows and does not hold a lock worth the name.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "fbc" text;
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "fbp" text;
