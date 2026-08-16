-- A photo of the lamp switched off, to sit behind the one of it switched on.
--
-- Every product photo in this shop is a photo of the thing working: the lamp
-- lit, the shelf glowing. That is the right photograph to sell with and the
-- wrong one to explain with, because a shopper cannot see what the product
-- looks like when it is off — which, for a lamp, is most of the day.
--
-- This adds the other half of the pair so the product page can offer a toggle.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE AND NOT AN `off_image_key` COLUMN
-- ---------------------------------------------------------------------------
-- A column answers exactly one question. This lamp already advertises three
-- colour temperatures on its own packaging — Natural, Warm, White — and the
-- same mechanism is what a sofa bed (folded, unfolded) or any before/after
-- product needs. Each of those is one more row here, and none of them is
-- another migration.
--
-- The ON state is deliberately absent from this table: it IS the gallery
-- image, in `product_images`, unchanged. So there is one copy of it, it cannot
-- drift from what the thumbnails show, and a product with the feature off is
-- untouched rather than merely unaffected.
--
-- ---------------------------------------------------------------------------
-- WHY IT HANGS OFF THE IMAGE, NOT THE PRODUCT
-- ---------------------------------------------------------------------------
-- The pairing is per photograph: the unlit kitchen shot belongs to the lit
-- kitchen shot and to nothing else. Keying on the image id rather than on a
-- position means the first admin to drag a gallery into a new order does not
-- silently attach the wrong picture to the wrong frame — and deleting a photo
-- takes its states with it, in the database rather than in code that has to
-- remember to.
--
-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------
-- Additive only. One CREATE TABLE, one ADD COLUMN with a default of false, and
-- three indexes on a table that is empty when they are built. Nothing existing
-- is altered, nothing is rewritten, and no lock is held on `products` beyond
-- the catalogue-wide instant that adding a defaulted boolean takes on
-- Postgres 11+. Every product in the catalogue keeps behaving exactly as it
-- does today until somebody switches one on by hand.

CREATE TABLE "product_image_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_image_id" uuid NOT NULL,
	"state_key" text NOT NULL,
	"label" text,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"checksum" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_image_states" ADD CONSTRAINT "product_image_states_product_image_id_product_images_id_fk" FOREIGN KEY ("product_image_id") REFERENCES "public"."product_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Uploading the same state twice replaces it, rather than leaving two rows for
-- the storefront to pick between.
CREATE UNIQUE INDEX "product_image_states_image_key_unique_idx" ON "product_image_states" USING btree ("product_image_id","state_key");--> statement-breakpoint
-- Reads are always "every state for this photo, in display order".
CREATE INDEX "product_image_states_image_sort_idx" ON "product_image_states" USING btree ("product_image_id","sort_order");--> statement-breakpoint
-- Lets an orphan sweep find rows by key when reconciling storage, matching the
-- index `product_images` carries for the same reason.
CREATE INDEX "product_image_states_storage_key_idx" ON "product_image_states" USING btree ("storage_key");--> statement-breakpoint
-- Off for every product that exists and every product created after this. The
-- shop turns it on one product at a time.
ALTER TABLE "products" ADD COLUMN "interactive_enabled" boolean DEFAULT false NOT NULL;
