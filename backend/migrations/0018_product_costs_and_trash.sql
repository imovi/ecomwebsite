-- Three things: real per-product costs, per-product ad spend, and a trash for orders.
--
-- WHY PER-PRODUCT COSTS
-- Courier and packaging were one figure for the whole shop, which is fine until
-- the catalogue holds both a phone case and a 15-inch laptop. One shop-wide
-- number then flatters the small items and hides that the big ones barely earn.
-- Null means "use the shop default", so nothing changes until a product is
-- given its own number.
--
-- HOW A PER-PRODUCT COURIER COST IS APPLIED
-- A courier bills per PARCEL, not per product, so these cannot simply be summed.
-- The rule is: a parcel costs the HIGHEST override among the products inside it,
-- falling back to the zone default. That is the honest reading of "this bulky
-- item makes the parcel cost more". In the per-product table the parcel's cost
-- is then split across its lines by revenue share, so the product rows still add
-- up to the order total rather than quietly disagreeing with it.
alter table "products" add column if not exists "courier_cost_inside_dhaka" integer;--> statement-breakpoint
alter table "products" add column if not exists "courier_cost_outside_dhaka" integer;--> statement-breakpoint
alter table "products" add column if not exists "packaging_cost" integer;--> statement-breakpoint

alter table "products" add constraint "products_courier_cost_inside_non_negative" check ("courier_cost_inside_dhaka" is null or "courier_cost_inside_dhaka" >= 0);--> statement-breakpoint
alter table "products" add constraint "products_courier_cost_outside_non_negative" check ("courier_cost_outside_dhaka" is null or "courier_cost_outside_dhaka" >= 0);--> statement-breakpoint
alter table "products" add constraint "products_packaging_cost_non_negative" check ("packaging_cost" is null or "packaging_cost" >= 0);--> statement-breakpoint

-- WHY A TABLE RATHER THAN A COLUMN
-- Boost budgets change daily and the profit report is read by date range, so
-- "৳300 a day on this product" has to be recorded per day or last week's figures
-- would silently be restated every time today's budget changed.
--
-- This is also the difference between a guess and a fact. Ad spend was inferred
-- by splitting the total across products by share of revenue, which is only ever
-- an estimate — and a bad one for a product that is selling BECAUSE it is
-- boosted. A recorded number replaces the estimate for that product; anything
-- not recorded keeps falling back to the old share-out, so the two can coexist.
create table if not exists "product_ad_spend" (
  "id" uuid primary key default gen_random_uuid(),
  "product_id" uuid not null references "products"("id") on delete cascade,
  -- A calendar day in the shop's timezone, not a timestamp: this is a budget
  -- somebody set for a day, not an event that happened at an instant.
  "spent_on" date not null,
  "amount" integer not null default 0,
  "note" text not null default '',
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  constraint "product_ad_spend_amount_non_negative" check ("amount" >= 0)
);--> statement-breakpoint

-- One figure per product per day. Entering it twice corrects it rather than
-- doubling it — the same rule the shop-wide expense ledger already follows.
create unique index if not exists "product_ad_spend_product_day_idx" on "product_ad_spend" ("product_id", "spent_on");--> statement-breakpoint
create index if not exists "product_ad_spend_day_idx" on "product_ad_spend" ("spent_on");--> statement-breakpoint

-- WHY ORDERS ARE NEVER REALLY DELETED ON THE FIRST PRESS
-- An order is the record of money owed or collected, and it carries an audit
-- trail that exists precisely so nobody can quietly rewrite history. A hard
-- delete would also silently restate every profit figure that order appeared in.
--
-- So a delete hides it and starts a clock. Thirty days later it is purged for
-- real, which is long enough to notice a mistake and short enough that a trash
-- can does not become a second database.
alter table "orders" add column if not exists "deleted_at" timestamptz;--> statement-breakpoint
alter table "orders" add column if not exists "deleted_by" uuid references "admins"("id") on delete set null;--> statement-breakpoint

-- Every list, count and report filters on `deleted_at is null`, so the index is
-- partial: it covers the live rows those queries actually read.
create index if not exists "orders_live_idx" on "orders" ("created_at" desc) where "deleted_at" is null;--> statement-breakpoint
create index if not exists "orders_trash_idx" on "orders" ("deleted_at") where "deleted_at" is not null;
