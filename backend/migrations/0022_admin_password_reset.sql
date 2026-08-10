-- "I forgot my password" for the admin panel.
--
-- Until now there was exactly one way into this panel: remember the password.
-- There is no second owner to ask, no support desk, and the digest in `admins`
-- is Argon2 — so a forgotten password meant SSH access to the server and a
-- hand-written UPDATE, or nothing. That is a single point of failure on the
-- only door to a live shop.
--
-- A six-digit code, not a signed link. The code is delivered over two channels
-- at once — email and Telegram — and a link sent into a Telegram chat is one
-- tap from being opened on the wrong device, forwarded, or silently fetched by
-- a link-preview crawler, which spends a single-use token before the owner has
-- read the message. A code is read by a person and typed into the page already
-- open in front of them.
--
-- `code_hash` is Argon2, never the code itself. Six digits is a million
-- possibilities; a table of plaintext codes would hand over every reset in
-- flight. The hash also makes each guess cost real time, underneath the
-- `attempts` ceiling.
--
-- Rows survive their use rather than being deleted: `consumed_at` is the record
-- that a reset actually happened, and a run of unconsumed rows against one
-- account is what an attack looks like from the outside.
CREATE TABLE IF NOT EXISTS "admin_password_resets" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_id"     uuid NOT NULL,
  "code_hash"    text NOT NULL,
  "expires_at"   timestamptz NOT NULL,
  "attempts"     integer NOT NULL DEFAULT 0,
  "consumed_at"  timestamptz,
  "requested_ip" text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Cascade: a deleted account has no password left to reset.
ALTER TABLE "admin_password_resets"
  ADD CONSTRAINT "admin_password_resets_admin_id_admins_id_fk"
  FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Serves both hot reads: the newest live code for an account when verifying,
-- and "how recently did this account ask" for the resend cooldown.
CREATE INDEX IF NOT EXISTS "admin_password_resets_admin_idx"
  ON "admin_password_resets" ("admin_id", "created_at" DESC);
