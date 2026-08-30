-- The words the shop sends its customers, in the shop's own hands.
--
-- Every WhatsApp message was a Bangla string compiled into the admin bundle.
-- Changing "আপনার অর্ডারটি" to something warmer, adding a shop's own sign-off,
-- or switching a line after a courier complaint all meant a code change and a
-- deploy — for text that belongs to whoever is talking to the customer, not to
-- whoever wrote the software.
--
-- One jsonb column rather than eleven text ones. These are a set that is read
-- and written together, they will grow as messages are added, and a column per
-- string is a migration every time somebody wants a new one.
--
-- EMPTY MEANS "USE THE BUILT-IN WORDING", not "send an empty message". A key
-- that is missing or blank falls back to the default in `whatsapp.ts`, so a
-- half-filled form and a cleared box both behave the way somebody would expect
-- rather than sending a customer a blank chat.
--
-- Additive only.
ALTER TABLE "store_settings"
  ADD COLUMN IF NOT EXISTS "whatsapp_templates" jsonb NOT NULL DEFAULT '{}'::jsonb;
