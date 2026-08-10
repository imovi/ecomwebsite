-- Seeing where an order came from, and refusing an address that keeps sending
-- fake ones.
--
-- `orders.customer_ip` has been collecting real shopper addresses since the
-- X-Forwarded-For fix — every order in production has one — and nothing has
-- ever displayed them. This migration is what makes them usable.
--
-- ---------------------------------------------------------------------------
-- WHY text BECOMES inet
-- ---------------------------------------------------------------------------
-- Blocking an IPv6 customer means blocking their /64: one residential
-- allocation is 2^64 addresses, so refusing a single one accomplishes nothing.
-- A text column cannot express that. IPv6 also has several valid spellings of
-- the same address (`::` compression, leading zeros, case), so text equality
-- silently misses matches — a block that never fires is worse than no block,
-- because it looks like protection.
--
-- `inet` canonicalises on input and brings the containment operators (`>>=`)
-- that make "is this address inside a blocked network" a real question.
--
-- Every existing value was checked against `^[0-9a-fA-F:.]+$` before writing
-- this; all ten distinct values in production cast cleanly. The cast is
-- all-or-nothing, so one malformed row would fail the whole statement — which
-- is the correct behaviour, and the reason it was audited first.
ALTER TABLE "orders"
  ALTER COLUMN "customer_ip" TYPE inet USING "customer_ip"::inet;
--> statement-breakpoint

-- "Every other order from this address" runs on every order the shop opens, so
-- this index is required rather than nice to have. Partial on both predicates:
-- an equality lookup can never match NULL, and every list here already excludes
-- the trash.
CREATE INDEX IF NOT EXISTS "orders_customer_ip_idx"
  ON "orders" ("customer_ip", "created_at" DESC)
  WHERE "deleted_at" IS NULL AND "customer_ip" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- THE BLOCK LIST
-- ---------------------------------------------------------------------------
-- Read the note in the schema file before changing anything here. The short
-- version: in Bangladesh an IP is not a person — the mobile carriers run
-- carrier-grade NAT, so one address fronts hundreds of real customers. This
-- table can stop a district from checking out, so it is built to heal:
-- blocks expire, lifting one keeps the record, and a hit counter shows when a
-- block is catching far more than one fraudster ever could.
--
-- `cidr` rather than `inet`: `cidr` enforces "this row is a network", which is
-- what a /64 block is. `inet` would happily hold a host address wearing a
-- netmask, which is a different thing.
CREATE TABLE IF NOT EXISTS "blocked_ips" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ip"            cidr NOT NULL,
  "reason"        text NOT NULL DEFAULT '',
  "blocked_by"    uuid,
  "expires_at"    timestamptz,
  "unblocked_by"  uuid,
  "unblocked_at"  timestamptz,
  "hit_count"     integer NOT NULL DEFAULT 0,
  "last_hit_at"   timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- `set null`, not cascade: the block outlives the admin who created it. Losing
-- the row because someone left the company would silently unblock an address.
ALTER TABLE "blocked_ips"
  ADD CONSTRAINT "blocked_ips_blocked_by_admins_id_fk"
  FOREIGN KEY ("blocked_by") REFERENCES "admins"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blocked_ips"
  ADD CONSTRAINT "blocked_ips_unblocked_by_admins_id_fk"
  FOREIGN KEY ("unblocked_by") REFERENCES "admins"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- One LIVE block per address. A duplicate could not be lifted by unblocking the
-- first, which ends with an address nobody can work out how to release.
-- Partial, because lifted blocks are kept deliberately — they are the audit
-- trail, and they are how the owner finds the entry again.
CREATE UNIQUE INDEX IF NOT EXISTS "blocked_ips_live_idx"
  ON "blocked_ips" ("ip")
  WHERE "unblocked_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "blocked_ips_created_idx"
  ON "blocked_ips" ("created_at" DESC);
