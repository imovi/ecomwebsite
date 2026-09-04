-- Checkout Form Customization Configuration
--
-- Allows store owners to customize checkout form field labels, placeholders,
-- headings, button texts (English / Bangla / Custom), and toggle specific optional
-- fields (like coupon input, area input, notes) on and off from the admin panel.

ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "checkout_form_config" jsonb NOT NULL DEFAULT '{}'::jsonb;
