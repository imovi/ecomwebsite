-- Narrow IMMUTABLE wrapper over array_to_string.
--
-- The built-in array_to_string(anyarray, text) is only STABLE: for a generic
-- array its result depends on the element type output function, which may in
-- turn depend on runtime settings. Postgres therefore refuses it inside a
-- generated column.
--
-- Restricted to text[] with a caller-supplied delimiter there is no such
-- dependency: the input is already text and the output is a pure function of
-- it. Declaring THIS signature immutable is accurate, not a workaround for a
-- check we are trying to dodge.
--
-- Used by products.search_vector.
CREATE OR REPLACE FUNCTION catalog_tags_to_text(tags text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$ SELECT array_to_string(tags, chr(32)) $$;
--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."stock_status" AS ENUM('in_stock', 'out_of_stock', 'pre_order', 'discontinued');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image_key" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sku" text NOT NULL,
	"brand" text NOT NULL,
	"category_id" uuid NOT NULL,
	"short_description" text,
	"description" text,
	"specifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"whats_included" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variant_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"warranty" text,
	"price" integer NOT NULL,
	"old_price" integer,
	"discount_percent" integer GENERATED ALWAYS AS (
        case
          when old_price is not null and old_price > price
          then round(((old_price - price)::numeric * 100) / old_price)::int
          else 0
        end
      ) STORED,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"stock_status" "stock_status" DEFAULT 'out_of_stock' NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(sku, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(brand, '')), 'B') ||
        setweight(to_tsvector('simple', catalog_tags_to_text(tags)), 'B') ||
        setweight(to_tsvector('english', coalesce(short_description, '')), 'C')
      ) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"alt" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"checksum" text NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price" integer NOT NULL,
	"old_price" integer,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"image_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_metrics" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"units_sold" integer DEFAULT 0 NOT NULL,
	"units_sold_recent" integer DEFAULT 0 NOT NULL,
	"last_sold_at" timestamp with time zone,
	"trending_score" double precision DEFAULT 0 NOT NULL,
	"score_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_image_id_product_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."product_images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_metrics" ADD CONSTRAINT "product_metrics_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_unique_idx" ON "categories" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_unique_idx" ON "categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "categories_active_sort_idx" ON "categories" USING btree ("is_active","sort_order","name");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_unique_idx" ON "products" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_unique_idx" ON "products" USING btree (lower("sku"));--> statement-breakpoint
CREATE INDEX "products_visibility_created_idx" ON "products" USING btree ("status","is_visible","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_visibility_price_idx" ON "products" USING btree ("status","is_visible","price");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id","status","is_visible");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree (lower("brand"));--> statement-breakpoint
CREATE INDEX "products_stock_status_idx" ON "products" USING btree ("stock_status");--> statement-breakpoint
CREATE INDEX "products_discount_idx" ON "products" USING btree ("discount_percent");--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "products_tags_idx" ON "products" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_featured_unique_idx" ON "product_images" USING btree ("product_id") WHERE "product_images"."is_featured";--> statement-breakpoint
CREATE INDEX "product_images_product_sort_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_images_storage_key_idx" ON "product_images" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_unique_idx" ON "product_variants" USING btree (lower("sku"));--> statement-breakpoint
CREATE INDEX "product_variants_product_sort_idx" ON "product_variants" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_variants_product_price_idx" ON "product_variants" USING btree ("product_id","price");--> statement-breakpoint
CREATE INDEX "product_metrics_trending_idx" ON "product_metrics" USING btree ("trending_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_metrics_units_sold_idx" ON "product_metrics" USING btree ("units_sold" DESC NULLS LAST);