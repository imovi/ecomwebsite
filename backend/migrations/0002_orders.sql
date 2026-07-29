-- Order number sequence.
--
-- Order numbers must be unique and human-readable ("GNG-10042"). A sequence is
-- the only concurrency-safe source: computing max(order_number) + 1 races the
-- moment two checkouts land in the same instant, which on a store running a
-- Facebook campaign is constant.
--
-- Sequences are not transactional, so a rolled-back order burns a number. That
-- is the correct trade: a gap in the sequence is cosmetic, a duplicate order
-- number is a support incident.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 10001 INCREMENT BY 1;
--> statement-breakpoint
CREATE TYPE "public"."delivery_zone" AS ENUM('inside_dhaka', 'outside_dhaka');--> statement-breakpoint
CREATE TYPE "public"."order_event_type" AS ENUM('order_created', 'status_changed', 'customer_updated', 'address_updated', 'phone_updated', 'quantity_updated', 'variant_updated', 'item_removed', 'delivery_charge_updated', 'totals_recalculated', 'note_added', 'order_cancelled', 'order_delivered', 'order_returned');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cod');--> statement-breakpoint
CREATE TABLE "store_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"delivery_charge_inside_dhaka" integer DEFAULT 80 NOT NULL,
	"delivery_charge_outside_dhaka" integer DEFAULT 130 NOT NULL,
	"free_delivery_threshold" integer DEFAULT 0 NOT NULL,
	"minimum_order_value" integer DEFAULT 0 NOT NULL,
	"max_quantity_per_item" integer DEFAULT 10 NOT NULL,
	"store_name" text DEFAULT 'gng' NOT NULL,
	"store_phone" text DEFAULT '' NOT NULL,
	"store_email" text DEFAULT '' NOT NULL,
	"store_address" text DEFAULT '' NOT NULL,
	"invoice_footer" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_single_row" CHECK ("store_settings"."id" = 1),
	CONSTRAINT "store_settings_non_negative" CHECK ("store_settings"."delivery_charge_inside_dhaka" >= 0
          and "store_settings"."delivery_charge_outside_dhaka" >= 0
          and "store_settings"."free_delivery_threshold" >= 0
          and "store_settings"."minimum_order_value" >= 0
          and "store_settings"."max_quantity_per_item" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"area_text" text NOT NULL,
	"delivery_zone" "delivery_zone" NOT NULL,
	"subtotal" integer NOT NULL,
	"delivery_charge" integer NOT NULL,
	"grand_total" integer NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"payment_method" "payment_method" DEFAULT 'cod' NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"internal_notes" text,
	"cancellation_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"customer_ip" text,
	"user_agent" text,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_totals_consistent" CHECK ("orders"."grand_total" = "orders"."subtotal" + "orders"."delivery_charge"),
	CONSTRAINT "orders_amounts_non_negative" CHECK ("orders"."subtotal" >= 0 and "orders"."delivery_charge" >= 0 and "orders"."grand_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"product_name" text NOT NULL,
	"product_slug" text NOT NULL,
	"sku" text NOT NULL,
	"variant_label" text,
	"image_key" text,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_price_non_negative" CHECK ("order_items"."unit_price" >= 0),
	CONSTRAINT "order_items_line_total_consistent" CHECK ("order_items"."line_total" = "order_items"."unit_price" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" "order_event_type" NOT NULL,
	"field" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"admin_id" uuid,
	"actor_name" text DEFAULT 'System' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_unique_idx" ON "orders" USING btree (upper("order_number"));--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_unique_idx" ON "orders" USING btree ("idempotency_key") WHERE "orders"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "orders" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "orders_customer_name_idx" ON "orders" USING btree (lower("customer_name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "orders_delivery_zone_idx" ON "orders" USING btree ("delivery_zone","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_payment_method_idx" ON "orders" USING btree ("payment_method");--> statement-breakpoint
CREATE INDEX "orders_delivered_at_idx" ON "orders" USING btree ("delivered_at" DESC NULLS LAST) WHERE "orders"."status" = 'delivered';--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_id_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_events_order_created_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_events_type_idx" ON "order_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "order_events_admin_idx" ON "order_events" USING btree ("admin_id");
--> statement-breakpoint
-- Settings singleton. The CHECK (id = 1) constraint guarantees one row; this
-- seeds it with the column defaults so the application never has to handle a
-- missing configuration.
INSERT INTO "store_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
