-- Incomplete checkouts: people who reached the form, gave a phone number, and
-- did not finish.
--
-- WHY THIS EXISTS
-- On a cash-on-delivery shop these are the cheapest sales available. The
-- customer has already chosen a product and typed their number; they were lost
-- to a distraction, a bad connection, or hesitation over the delivery charge.
-- A phone call recovers a meaningful share of them, but only if the shop knows
-- they happened — and today that information is thrown away the moment the tab
-- closes.
--
-- KEYED BY PHONE, NOT BY SESSION
-- One open record per number, updated as the customer types. A session key
-- would create a new row every time someone reloaded, and the shop would ring
-- the same person four times. The phone is also the only field that matters:
-- without it there is nobody to call, so it is the trigger for recording at all.
--
-- IT DELETES ITSELF WHEN THE ORDER ARRIVES
-- `recovered_order_id` is set when an order is later placed from the same
-- number, which takes the row out of the call list. Without that the list fills
-- with people who already bought, the shop rings a paying customer to ask why
-- they did not order, and the feature is switched off within a week.
--
-- CART CONTENTS ARE A SNAPSHOT
-- Stored as jsonb rather than joined to products, for the same reason order
-- lines are: the caller needs to know what the customer was looking at when
-- they left, at the price shown then — not what that product costs today.
CREATE TABLE "abandoned_checkouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  /* The only required field. Normalised to 11 digits before storing so
     `01712-345678` and `01712345678` are the same person. */
  "phone" text NOT NULL,

  /* Everything else is whatever they had typed when they stopped. */
  "customer_name" text,
  "address" text,
  "area_text" text,
  "delivery_zone" delivery_zone,

  "contents" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "item_count" integer DEFAULT 0 NOT NULL,
  /* Goods only. The delivery charge is not settled until a zone is picked. */
  "estimated_value" integer DEFAULT 0 NOT NULL,

  /* 'open' → nobody has dealt with it. 'contacted' → someone rang.
     'dismissed' → a wrong number, a test, or a repeat time-waster. */
  "status" text DEFAULT 'open' NOT NULL,
  "note" text DEFAULT '' NOT NULL,

  "contacted_by" uuid REFERENCES "admins"("id") ON DELETE SET NULL,
  "contacted_at" timestamp with time zone,

  /* Set when an order turns up from this number. Also the flag that hides the
     row from the call list. */
  "recovered_order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "recovered_at" timestamp with time zone,

  /* Updated on every keystroke batch, so the list can be ordered by who left
     most recently — the warmest lead is the one who just closed the tab. */
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "abandoned_checkouts_status_known"
    CHECK ("status" in ('open', 'contacted', 'dismissed')),
  CONSTRAINT "abandoned_checkouts_value_non_negative"
    CHECK ("estimated_value" >= 0 and "item_count" >= 0)
);--> statement-breakpoint

/* One live record per number. Partial, so a recovered checkout does not block
   the same customer from being recorded again on a later visit — a repeat
   buyer who abandons a second time is a second opportunity. */
CREATE UNIQUE INDEX "abandoned_checkouts_open_phone_idx"
  ON "abandoned_checkouts" ("phone")
  WHERE "recovered_order_id" is null;--> statement-breakpoint

/* The call list: still open, most recently abandoned first. */
CREATE INDEX "abandoned_checkouts_status_seen_idx"
  ON "abandoned_checkouts" ("status", "last_seen_at" DESC);--> statement-breakpoint

/* Matching an incoming order back to its abandoned row. */
CREATE INDEX "abandoned_checkouts_phone_idx" ON "abandoned_checkouts" ("phone");
