-- Coupons that can be used more than once, and a record of each use.
--
-- Until now every coupon was spent exactly once and lived for whatever the
-- shop's default was. That is the right shape for the thing it was built for —
-- one offer, to one abandoned checkout. It is the wrong shape for the thing the
-- owner now wants: a code handed to twenty people at once, or one that lasts a
-- week, or one that is used five times and then stops.
--
-- WHY A SEPARATE TABLE RATHER THAN A COUNTER ALONE
-- A counter answers "how many times" and nothing else. The question actually
-- being asked is "which orders" — a coupon used five times is five orders whose
-- delivery the shop paid for, and the owner wants to look at them. One column
-- cannot hold five order numbers.
--
-- `used_order_id` and `used_at` on the coupon stay, and keep meaning what they
-- already meant: the FIRST time it was spent. For a single-use coupon — still
-- the default, and still what every lead offer is — that is the only time, so
-- nothing about the existing behaviour changes.
--
-- Additive only. Every existing coupon becomes a one-use coupon, which is what
-- it already was.

ALTER TABLE "recovery_coupons"
  -- How many times it may be spent. NULL means no limit.
  --
  -- Nullable rather than a magic 0, because "unlimited" and "zero uses allowed"
  -- are different things and a shop that typed 0 by accident should not get an
  -- unlimited coupon out of it. The default of 1 is what every row already is.
  ADD COLUMN IF NOT EXISTS "max_uses" integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "used_count" integer NOT NULL DEFAULT 0;

--> statement-breakpoint
-- Every coupon already marked used was used exactly once.
UPDATE "recovery_coupons"
   SET "used_count" = 1
 WHERE "status" = 'used' AND "used_count" = 0;

--> statement-breakpoint
ALTER TABLE "recovery_coupons"
  DROP CONSTRAINT IF EXISTS "recovery_coupons_uses_sane";

--> statement-breakpoint
ALTER TABLE "recovery_coupons"
  ADD CONSTRAINT "recovery_coupons_uses_sane"
    CHECK ("used_count" >= 0 AND ("max_uses" IS NULL OR "max_uses" >= 1));

/* -------------------------------------------------------------------------- */

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: these rows are the coupon's own history and mean nothing without
  -- it. The order they point at is a different matter — see below.
  "coupon_id" uuid NOT NULL REFERENCES "recovery_coupons"("id") ON DELETE CASCADE,

  -- SET NULL, and the number is snapshotted beside it. An order moved to trash
  -- and purged must not erase the fact that this coupon cost the shop a
  -- delivery, and the number is what an owner recognises anyway.
  "order_id"     uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "order_number" text NOT NULL DEFAULT '',

  -- What this particular use cost, in taka. Frozen: the delivery charge is a
  -- setting and settings change, so reading today's rate would silently restate
  -- what last month's offers cost.
  "delivery_saved" integer NOT NULL DEFAULT 0,

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "coupon_redemptions_saved_non_negative" CHECK ("delivery_saved" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coupon_redemptions_coupon_idx"
  ON "coupon_redemptions" ("coupon_id", "created_at");

--> statement-breakpoint
-- Bring the coupons that were already spent into the new table, so the history
-- does not start empty for a shop that has been using this for a week.
INSERT INTO "coupon_redemptions" ("coupon_id", "order_id", "order_number", "delivery_saved", "created_at")
SELECT c."id",
       c."used_order_id",
       coalesce(o."order_number", ''),
       CASE WHEN o."delivery_zone" = 'inside_dhaka'
            THEN (SELECT "delivery_charge_inside_dhaka"  FROM "store_settings" LIMIT 1)
            ELSE (SELECT "delivery_charge_outside_dhaka" FROM "store_settings" LIMIT 1)
       END,
       coalesce(c."used_at", c."updated_at")
  FROM "recovery_coupons" c
  LEFT JOIN "orders" o ON o."id" = c."used_order_id"
 WHERE c."used_order_id" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "coupon_redemptions" r WHERE r."coupon_id" = c."id"
   );
