-- Orders taken by hand, and where they came from.
--
-- Most of this shop's orders do not arrive through the checkout. A customer
-- sees an ad, messages the Facebook page or WhatsApp, and somebody at the order
-- desk agrees the sale in a conversation. Until now that order had to be typed
-- into the storefront as if the desk were the customer, which loses the one
-- fact worth keeping: it came from a message, not from the website.
--
-- ---------------------------------------------------------------------------
-- WHY `source` IS NULLABLE WITH NO DEFAULT
-- ---------------------------------------------------------------------------
-- NULL means the storefront placed it. That is not a missing value — it is the
-- answer, and it is the answer for every order already in this table.
--
-- A default of 'website' would have been worse than nothing: every historical
-- order would claim a source nobody recorded, indistinguishable from one an
-- operator actually typed. The absence carries the meaning precisely because it
-- was never written.
--
-- Free text rather than an enum, because the shop is TOLD this in a message
-- rather than choosing it from a list. "WhatsApp", "Facebook page", "phone",
-- the name of a referrer. A controlled vocabulary is the right move the day
-- somebody wants to report on it, and a premature one now would just mean
-- migrations every time a new channel appears.
--
-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------
-- Additive only. Two nullable columns and one index; nothing existing is
-- altered and no row is rewritten. Adding a nullable column without a default
-- does not touch the heap on Postgres 11+, so `orders` is not locked beyond the
-- catalogue update — which matters here, because this is the table checkout
-- writes to.

ALTER TABLE "orders" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Partial, because the interesting question is only ever asked of the orders
-- that HAVE a source: "how many came from WhatsApp this week". Indexing the
-- NULLs would be indexing the entire history of the shop to no purpose.
CREATE INDEX "orders_source_idx" ON "orders" USING btree ("source","created_at" DESC NULLS LAST) WHERE "orders"."source" is not null;
