ALTER TABLE "recovery_coupons" ADD COLUMN IF NOT EXISTS "discount_type" text NOT NULL DEFAULT 'free_delivery';
ALTER TABLE "recovery_coupons" ADD COLUMN IF NOT EXISTS "discount_value" integer NOT NULL DEFAULT 0;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discount" integer NOT NULL DEFAULT 0;
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_totals_consistent";
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals_consistent" CHECK ("grand_total" = "subtotal" + "delivery_charge" - "discount");
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_amounts_non_negative";
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_non_negative" CHECK ("subtotal" >= 0 AND "delivery_charge" >= 0 AND "discount" >= 0 AND "grand_total" >= 0);

ALTER TABLE "coupon_redemptions" ADD COLUMN IF NOT EXISTS "discount_saved" integer NOT NULL DEFAULT 0;
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT IF EXISTS "coupon_redemptions_saved_non_negative";
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_saved_non_negative" CHECK ("delivery_saved" >= 0 AND "discount_saved" >= 0);
