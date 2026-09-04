ALTER TABLE "store_settings" ADD COLUMN "announcement_text" text DEFAULT 'Cash on delivery all over Bangladesh' NOT NULL;
ALTER TABLE "store_settings" ADD COLUMN "announcement_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "store_settings" ADD COLUMN "announcement_link" text DEFAULT '' NOT NULL;
