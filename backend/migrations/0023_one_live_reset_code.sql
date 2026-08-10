-- At most one live password-reset code per admin, enforced by the database.
--
-- The application already tried to guarantee this: request a code, invalidate
-- whatever was outstanding, insert the new one. But those were three separate
-- round trips with nothing holding them together — no transaction, no lock, no
-- constraint. Two requests landing inside that window (a double-tapped button,
-- a client retrying after a timeout, two tabs) could both pass the cooldown
-- check before either had inserted, and both would insert.
--
-- Two live codes is not a cosmetic problem. Each carries its own five-attempt
-- ceiling, so the budget an attacker gets against a six-digit secret quietly
-- doubles. And "the newest code supersedes the older one" stops being true when
-- `created_at` — which is transaction-start time, and can collide — no longer
-- picks a single winner.
--
-- A partial unique index makes the race impossible rather than unlikely. The
-- loser's INSERT fails, the service reads that as "someone else just issued
-- one", and answers exactly as it would have anyway.
--
-- Partial on `consumed_at IS NULL` because spent codes are deliberately kept:
-- `consumed_at` is the record that a reset happened, and a run of unconsumed
-- rows is what an attack looks like from the outside. Only LIVE codes are
-- constrained to one.
--
-- Safe to apply on a live database: the table was created one migration ago and
-- holds at most a handful of rows, so building this takes no meaningful lock.
CREATE UNIQUE INDEX IF NOT EXISTS "admin_password_resets_one_live_idx"
  ON "admin_password_resets" ("admin_id")
  WHERE "consumed_at" IS NULL;
