-- Profit and loss: what each sale actually costs, and what the shop spends
-- outside of sales.
--
-- THE SNAPSHOT IS THE POINT
-- `order_items.unit_cost` exists for the same reason `unit_price` does. Profit
-- computed by joining an order back to the product's CURRENT buying price would
-- silently rewrite every past order the day a supplier raises his rate — last
-- month's margin would change while you were looking at it. The cost is copied
-- onto the line at placement and never touched again, so history is a record
-- rather than a live calculation.
--
-- It is NULLABLE on purpose. Orders placed before this migration have no cost,
-- and the reports show those as "cost unknown" rather than counting them as
-- pure profit. A zero default would have been a lie that looks like data.
--
-- WHY COST LIVES ON BOTH PRODUCT AND VARIANT
-- A 256 GB phone costs more to buy than the 128 GB of the same model, exactly as
-- it sells for more. The variant's cost wins when it is set; otherwise the
-- product's applies, mirroring how `price` already resolves at checkout.
--
-- THE FOUR SETTINGS
-- Costs that apply to every order rather than to a product: what the courier
-- charges the SHOP (distinct from what the customer is charged — on free
-- delivery that gap is a straight loss, currently invisible), packaging, and the
-- fee for a parcel that comes back. All default to 0, so adding them changes no
-- existing number until the owner fills them in.
ALTER TABLE "products" ADD COLUMN "cost_price" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_price" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_cost" integer;--> statement-breakpoint

ALTER TABLE "products" ADD CONSTRAINT "products_cost_price_non_negative" CHECK ("cost_price" is null or "cost_price" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_cost_price_non_negative" CHECK ("cost_price" is null or "cost_price" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_cost_non_negative" CHECK ("unit_cost" is null or "unit_cost" >= 0);--> statement-breakpoint

ALTER TABLE "store_settings" ADD COLUMN "courier_cost_inside_dhaka" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "courier_cost_outside_dhaka" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "packaging_cost_per_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_cost_per_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_costs_non_negative" CHECK (
  "courier_cost_inside_dhaka" >= 0
  and "courier_cost_outside_dhaka" >= 0
  and "packaging_cost_per_order" >= 0
  and "return_cost_per_order" >= 0
);--> statement-breakpoint

-- Money that leaves the business without passing through an order: ads, rent,
-- salaries, a bulk packaging purchase.
--
-- `incurred_on` is a DATE, not a timestamp. These are day-grained facts entered
-- by a person ("Tuesday's ad spend"), and a timestamp would invite timezone
-- arithmetic into a number that has none — a Dhaka shop owner typing 2000 for
-- the 3rd means the 3rd, whatever UTC thinks.
--
-- `period` is how the amount spreads. 'day' is spent on that date. 'month'
-- covers the calendar month `incurred_on` falls in and is divided across its
-- days, so a 7-day view carries a seventh of the rent rather than all of it if
-- the range happens to contain the 1st, or none of it if it does not.
CREATE TABLE "expenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" text NOT NULL,
  "amount" integer NOT NULL,
  "incurred_on" date NOT NULL,
  "period" text DEFAULT 'day' NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  /* Kept when the admin is deleted: an expense is a financial record, and it
     must not vanish because someone left the company. */
  "created_by" uuid REFERENCES "admins"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "expenses_category_known" CHECK (
    "category" in ('ads', 'rent', 'salary', 'packaging', 'transport', 'other')
  ),
  CONSTRAINT "expenses_period_known" CHECK ("period" in ('day', 'month'))
);--> statement-breakpoint

/* Every report reads a date range, so the range scan is the access path that
   matters; category is second because the summary groups by it. */
CREATE INDEX "expenses_incurred_on_idx" ON "expenses" ("incurred_on" DESC);--> statement-breakpoint
CREATE INDEX "expenses_category_incurred_on_idx" ON "expenses" ("category", "incurred_on" DESC);--> statement-breakpoint

/* Profit is reported on DELIVERED orders — on cash on delivery nothing is money
   until the parcel is handed over — and `orders_delivered_at_idx` already serves
   that from the orders migration. Returns had no equivalent: they are counted on
   the day the parcel came back, and they are rare, so the index is partial. */
CREATE INDEX "orders_returned_at_idx" ON "orders" ("returned_at" DESC) WHERE "status" = 'returned';
