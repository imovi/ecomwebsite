-- Recovering incomplete checkouts: a message, and an offer worth acting on.
--
-- The shop already records who abandoned a checkout and rings them. This adds
-- the two things that turn that list into recovered sales: a WhatsApp message
-- with the cart in it, and a 24-hour free-delivery coupon the desk can hand out
-- one lead at a time.
--
-- WHY FREE DELIVERY AND NOT A DISCOUNT
-- The loss is bounded and known — one delivery charge, roughly 80 taka. A
-- percentage off the goods is unbounded on a cart nobody has seen yet, and on
-- cash on delivery the shop pays the courier whether the customer accepts the
-- parcel or not. Free delivery is the offer whose worst case an owner can state
-- out loud before agreeing to it.
--
-- WHY THE DESK COULD NOT ALREADY DO THIS BY HAND
-- `orders` deliberately refuses admin edits to price, subtotal, delivery charge
-- and grand total — see the note in order.validation.ts. So "I will just make
-- delivery free for them" was never something anyone could actually do, and a
-- promise made on WhatsApp had nowhere to land. This gives it somewhere.
--
-- Additive only. Nothing existing is altered or dropped.

/* -------------------------------------------------------------------------- */
/* 1. Coupons                                                                 */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "recovery_coupons" (
  "id"   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Six characters, read aloud down a phone as often as they are typed. O/0,
  -- I/1 and S/5 are left out of the alphabet that generates these so nobody has
  -- to ask which one it was.
  "code" text NOT NULL,

  -- The lead this was created for. Nullable, and ON DELETE SET NULL: deleting a
  -- lead must not take a live coupon down with it, because the customer may
  -- already be holding the code.
  "abandoned_checkout_id" uuid REFERENCES "abandoned_checkouts"("id") ON DELETE SET NULL,

  -- What the abandoned cart was worth when the offer was made. Frozen here for
  -- the report, because the lead's own value keeps moving if the customer comes
  -- back and edits the basket.
  "cart_value" integer NOT NULL DEFAULT 0,

  -- active | used | cancelled | expired
  --
  -- `expires_at` is the authority on expiry, NOT this column. Redemption checks
  -- the timestamp, so a sweep that never runs cannot cost the shop money — it
  -- can only leave the word here stale. That split is deliberate: this shop has
  -- already lost a database to a nightly job that failed silently for days, and
  -- nothing involving money may depend on one again.
  "status" text NOT NULL DEFAULT 'active',

  "expires_at"    timestamptz NOT NULL,

  "used_order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "used_at"       timestamptz,
  "cancelled_at"  timestamptz,

  "created_by" uuid REFERENCES "admins"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "recovery_coupons_status_known"
    CHECK ("status" IN ('active', 'used', 'cancelled', 'expired')),
  CONSTRAINT "recovery_coupons_cart_value_non_negative"
    CHECK ("cart_value" >= 0)
);

--> statement-breakpoint
-- The code IS the credential. Folded to upper case before storing, so hn7k2p
-- and HN7K2P cannot become two different coupons.
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_coupons_code_key"
  ON "recovery_coupons" ("code");

--> statement-breakpoint
-- One live offer per lead, enforced here and not only in the service, so a
-- double-tapped Generate button cannot mint two. Partial, so a lead whose
-- coupon expired or was cancelled can be given another one.
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_coupons_one_active_per_lead_idx"
  ON "recovery_coupons" ("abandoned_checkout_id")
  WHERE "status" = 'active' AND "abandoned_checkout_id" IS NOT NULL;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_coupons_status_created_idx"
  ON "recovery_coupons" ("status", "created_at" DESC);

/* -------------------------------------------------------------------------- */
/* 2. What has been done to a lead                                            */
/* -------------------------------------------------------------------------- */

--> statement-breakpoint
-- Modelled on `order_events`, for the same reason: "did anyone message this
-- customer, and what did we offer them?" must be a fact rather than somebody's
-- recollection — especially once more than one person is working the list.
CREATE TABLE IF NOT EXISTS "abandoned_checkout_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE, unlike the coupon link above. The history of a deleted lead is
  -- about that lead; keeping the rows would leave the report counting messages
  -- sent to somebody nobody can name any more.
  "checkout_id" uuid NOT NULL REFERENCES "abandoned_checkouts"("id") ON DELETE CASCADE,

  "type"   text NOT NULL,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The name as well as the id: an id alone leaves the record reading "admin"
  -- once that account is deleted, which is exactly when somebody is asking who
  -- did this.
  "actor_admin_id" uuid REFERENCES "admins"("id") ON DELETE SET NULL,
  "actor_name"     text NOT NULL DEFAULT '',

  "created_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "abandoned_checkout_events_type_known" CHECK ("type" IN (
    'help_message_sent',
    'coupon_generated',
    'coupon_offer_sent',
    'coupon_used',
    'coupon_cancelled',
    'called',
    'note_added',
    'dismissed',
    'recovered'
  ))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "abandoned_checkout_events_checkout_idx"
  ON "abandoned_checkout_events" ("checkout_id", "created_at");

/* -------------------------------------------------------------------------- */
/* 3. What the lead itself now remembers                                      */
/* -------------------------------------------------------------------------- */

--> statement-breakpoint
ALTER TABLE "abandoned_checkouts"
  -- Set when the desk confirms it sent the message — not when the WhatsApp link
  -- was opened. Opening a chat is not sending, and a status that lies the
  -- moment somebody changes their mind is worse than no status at all.
  ADD COLUMN IF NOT EXISTS "help_message_sent_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "coupon_offer_sent_at" timestamptz,
  -- Why this checkout died, chosen from a short list. Free text already exists
  -- in `note`; this is the part a report can count.
  ADD COLUMN IF NOT EXISTS "reason" text NOT NULL DEFAULT '';

/* -------------------------------------------------------------------------- */
/* 4. When an offer may be made                                               */
/* -------------------------------------------------------------------------- */

--> statement-breakpoint
ALTER TABLE "store_settings"
  -- Below this cart value the Generate button refuses. Zero means no floor,
  -- which is where a shop starts; the owner raises it once the report shows
  -- what a recovered order is worth against a delivery charge.
  ADD COLUMN IF NOT EXISTS "recovery_coupon_min_cart_value" integer NOT NULL DEFAULT 0,
  -- How long an offer lives. A column rather than a constant because "24 hours"
  -- is a business decision — shorter for urgency, longer over a holiday — and
  -- neither should need a deploy.
  ADD COLUMN IF NOT EXISTS "recovery_coupon_hours" integer NOT NULL DEFAULT 24;

--> statement-breakpoint
ALTER TABLE "store_settings"
  DROP CONSTRAINT IF EXISTS "store_settings_recovery_coupon_sane";

--> statement-breakpoint
ALTER TABLE "store_settings"
  ADD CONSTRAINT "store_settings_recovery_coupon_sane"
    CHECK ("recovery_coupon_min_cart_value" >= 0
       AND "recovery_coupon_hours" BETWEEN 1 AND 720);
