-- Indexes the reports can actually use, now that they ask in a way that lets them.
--
-- WHY THESE DID NOT HELP BEFORE
-- Every report filtered dates as `(created_at at time zone 'Asia/Dhaka')::date
-- between x and y`. A column wrapped in a conversion cannot be answered from an
-- index on the column, so the planner read every row and converted each one.
-- With two orders that costs nothing; at twenty thousand it is the whole Profit
-- page, on every click of every date chip.
--
-- The predicates now compare the raw column against two computed instants — see
-- `withinShopDays` in profit.service.ts — which is the same question asked in a
-- form a btree can answer. `orders` already had the indexes for it. These are
-- the tables that did not.
--
-- Additive only.

-- The recovery report groups every lead by the day it was recorded. There was
-- an index on (status, last_seen_at) for the call list, and none on created_at.
CREATE INDEX IF NOT EXISTS "abandoned_checkouts_created_at_idx"
  ON "abandoned_checkouts" ("created_at");

--> statement-breakpoint
-- Coupons made in a range, for the Coupons page and the recovery report. The
-- existing (status, created_at) index leads on status, so it cannot serve a
-- date range that spans every status.
CREATE INDEX IF NOT EXISTS "recovery_coupons_created_at_idx"
  ON "recovery_coupons" ("created_at");

--> statement-breakpoint
-- "Who worked the list", which counts events per staff member over a range.
CREATE INDEX IF NOT EXISTS "abandoned_checkout_events_created_at_idx"
  ON "abandoned_checkout_events" ("created_at");

/* -------------------------------------------------------------------------- */
/* Joins that had no index behind them                                        */
/* -------------------------------------------------------------------------- */

--> statement-breakpoint
-- "Which orders used coupons" joins redemptions to orders. Small today, and the
-- table only ever grows.
CREATE INDEX IF NOT EXISTS "coupon_redemptions_order_idx"
  ON "coupon_redemptions" ("order_id")
  WHERE "order_id" IS NOT NULL;

--> statement-breakpoint
-- Redemption reads a coupon by code and immediately tests whether it is still
-- live. Partial, so it indexes only the rows a checkout can actually claim —
-- which stays small no matter how many spent coupons pile up behind it.
CREATE INDEX IF NOT EXISTS "recovery_coupons_claimable_idx"
  ON "recovery_coupons" ("code")
  WHERE "status" = 'active';
