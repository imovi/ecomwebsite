DROP INDEX "order_events_order_created_idx";--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "order_events_order_seq_idx" ON "order_events" USING btree ("order_id","seq");