-- Courier hand-off and parcel tracking.
--
-- WHY THIS IS WORTH THE COMPLEXITY
-- Until now someone types every parcel into the courier's own panel by hand,
-- then walks each order through five statuses in this one. That is not just
-- labour: the PROFIT REPORT depends on `delivered_at`, so an order that really
-- was delivered but never got clicked shows as zero revenue and sits in "on the
-- way" forever. Pulling the status from the courier fixes the accounting as
-- well as the typing.
--
-- TWO COURIERS, ONE SHAPE
-- Steadfast authenticates with a static key/secret; Pathao uses OAuth and needs
-- a token refreshed periodically, plus its own city/zone/area ids rather than a
-- written address. Both are hidden behind one `courier_shipments` row so the
-- rest of the system — the order page, the customer's tracking page, the profit
-- report — never learns which company carried a given parcel.
--
-- STATUS IS STORED TWICE, ON PURPOSE
-- `courier_status` is whatever the courier said, kept verbatim for support
-- questions and for mapping bugs. `mapped_status` is our own vocabulary, and it
-- is the only thing a customer ever sees. Couriers change their wording without
-- notice, and a shopper should never read "partial_delivered_return_pending".
ALTER TABLE "store_settings" ADD COLUMN "courier_provider" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "courier_api_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "courier_api_secret" text DEFAULT '' NOT NULL;--> statement-breakpoint
/* Pathao only: the merchant's store id, and the base url so sandbox and live
   can be swapped without a deploy. */
ALTER TABLE "store_settings" ADD COLUMN "courier_store_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "courier_base_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "courier_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_courier_provider_known"
  CHECK ("courier_provider" in ('', 'steadfast', 'pathao'));--> statement-breakpoint

CREATE TABLE "courier_shipments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  /* CASCADE: a shipment has no meaning without its order. */
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,

  "provider" text NOT NULL,

  /* The courier's own identifiers. `consignment_id` is what their API takes
     back; `tracking_code` is what a human types into their website. */
  "consignment_id" text NOT NULL,
  "tracking_code" text DEFAULT '' NOT NULL,

  /* Verbatim from the courier, for support and for diagnosing a mapping gap. */
  "courier_status" text DEFAULT '' NOT NULL,
  /* Our vocabulary. The only thing a customer is shown. */
  "mapped_status" text DEFAULT 'pending' NOT NULL,

  /* What the courier says it will collect. Compared against the order total,
     because a mismatch here is money that quietly goes missing. */
  "cod_amount" integer DEFAULT 0 NOT NULL,

  "last_synced_at" timestamp with time zone,
  /* Kept so a failing sync is visible in the panel rather than only in logs. */
  "last_error" text DEFAULT '' NOT NULL,

  "created_by" uuid REFERENCES "admins"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "courier_shipments_provider_known"
    CHECK ("provider" in ('steadfast', 'pathao')),
  CONSTRAINT "courier_shipments_mapped_status_known"
    CHECK ("mapped_status" in (
      'pending', 'picked_up', 'in_transit', 'out_for_delivery',
      'delivered', 'returned', 'cancelled', 'unknown'
    )),
  CONSTRAINT "courier_shipments_cod_non_negative" CHECK ("cod_amount" >= 0)
);--> statement-breakpoint

/* One live shipment per order. Sending the same parcel twice means two
   couriers arriving at one customer and two delivery charges billed — the
   database refuses rather than relying on the button being disabled. */
CREATE UNIQUE INDEX "courier_shipments_order_idx" ON "courier_shipments" ("order_id");--> statement-breakpoint

/* The sync job walks everything not yet in a final state. */
CREATE INDEX "courier_shipments_open_idx"
  ON "courier_shipments" ("mapped_status", "last_synced_at")
  WHERE "mapped_status" not in ('delivered', 'returned', 'cancelled');--> statement-breakpoint

CREATE INDEX "courier_shipments_consignment_idx" ON "courier_shipments" ("provider", "consignment_id");
