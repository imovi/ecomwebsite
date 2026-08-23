-- Checking a phone number's delivery record with the couriers.
--
-- Two tables rather than columns on store_settings: the credentials are one
-- row per courier so a courier can be switched off without losing what was
-- typed, and the cached results are keyed by phone so the same customer
-- ordering twice does not mean signing into five merchant panels twice.
--
-- Additive only. Nothing existing is touched.
CREATE TABLE IF NOT EXISTS "courier_fraud_accounts" (
  "provider"   text PRIMARY KEY,
  "identifier" text NOT NULL DEFAULT '',
  -- The merchant password. Write-only through the API; never returned.
  "secret"     text NOT NULL DEFAULT '',
  "enabled"    boolean NOT NULL DEFAULT false,
  "last_ok_at" timestamptz,
  "last_error" text NOT NULL DEFAULT '',
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Only the couriers we have a recipe for. A typo becomes an error here rather
-- than a row that silently never runs.
ALTER TABLE "courier_fraud_accounts"
  DROP CONSTRAINT IF EXISTS "courier_fraud_accounts_provider_known";
--> statement-breakpoint
ALTER TABLE "courier_fraud_accounts"
  ADD CONSTRAINT "courier_fraud_accounts_provider_known"
  CHECK ("provider" IN ('steadfast', 'pathao', 'redx', 'paperfly', 'carrybee'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "courier_fraud_checks" (
  -- Normalised to 01XXXXXXXXX, the form orders store.
  "phone"      text PRIMARY KEY,
  "result"     jsonb NOT NULL,
  "checked_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courier_fraud_checks_checked_at_idx"
  ON "courier_fraud_checks" ("checked_at" DESC);
