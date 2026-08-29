-- Where the nightly database backup is sent.
--
-- Deliberately not the alert chat. Order alerts are read by whoever is working
-- the orders; this file is every customer's name, phone and address in one
-- place, and it belongs to the person who owns the business.
--
-- Empty means no backup is taken, which is the state this shop was already in —
-- the repository backup had never been set up and failed silently every night.
--
-- The alert chat column needs no migration: it already holds text, and it now
-- accepts several ids separated by commas so more than one admin gets the
-- order. Existing single values keep working unchanged.
--
-- Additive only.
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "telegram_backup_chat_id" text NOT NULL DEFAULT '';
