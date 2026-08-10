import { sql } from "drizzle-orm";
import {
  cidr,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { admins } from "./admins.js";

/**
 * Addresses refused at checkout.
 *
 * THE THING TO UNDERSTAND BEFORE READING ANY OF THIS
 * --------------------------------------------------
 * In Bangladesh an IP address is not a person. Grameenphone, Robi and
 * Banglalink run carrier-grade NAT, so hundreds of real customers arrive from
 * one public address — the same fact that forced the rate limits UP rather than
 * down (see `config/env.ts`). Blocking an address here can therefore stop a
 * district's worth of honest shoppers from checking out, during a campaign,
 * with no error anyone would ever see.
 *
 * Everything below is shaped by that:
 *
 *   - `expires_at` defaults to a week rather than never, so a bad block heals
 *     itself instead of quietly costing sales forever.
 *   - `unblocked_at` rather than DELETE, so a lifted block is still findable
 *     with who lifted it — which is exactly what someone disputing a wrongful
 *     block needs, and what the owner needs to find the entry again.
 *   - `hit_count` and `last_hit_at`, so a block that is catching far more
 *     traffic than one fraudster could produce says so out loud.
 *
 * `cidr`, not text and not `inet`. Blocking IPv6 means blocking a /64 — one
 * residential allocation is 2^64 addresses, so blocking a single one
 * accomplishes nothing — and `cidr` is the type that enforces "this row is a
 * network, not a host". Matching is by containment (`>>=`), never string
 * equality, so `2400:1234:5:6::/64` covers every host inside it.
 */
export const blockedIps = pgTable(
  "blocked_ips",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** IPv4 is stored as a /32, IPv6 collapsed to its /64. See `normalizeIp`. */
    ip: cidr("ip").notNull(),

    /** Free text from whoever blocked it. Shown in the list; never parsed. */
    reason: text("reason").notNull().default(""),

    /** Null once the admin who did it is deleted — the block itself stands. */
    blockedBy: uuid("blocked_by").references(() => admins.id, { onDelete: "set null" }),

    /**
     * When it stops applying. Null means never.
     *
     * The panel offers a week by default. Permanent is available and is meant
     * to be a decision somebody makes, not the path of least resistance.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    /* --- Lifting it ------------------------------------------------------ */
    unblockedBy: uuid("unblocked_by").references(() => admins.id, { onDelete: "set null" }),
    unblockedAt: timestamp("unblocked_at", { withTimezone: true }),

    /**
     * How many checkouts this block has refused.
     *
     * The number that tells you whether it is working or overreaching. Written
     * on a debounce, never in the request path — see the guard.
     */
    hitCount: integer("hit_count").notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* One live block per address. A second one would be a duplicate row that
       cannot be lifted by unblocking the first — the sort of thing that ends
       with an address nobody can work out how to release. Partial, because
       lifted blocks are kept on purpose. */
    uniqueIndex("blocked_ips_live_idx")
      .on(table.ip)
      .where(sql`${table.unblockedAt} is null`),

    /* The list page, newest first. */
    index("blocked_ips_created_idx").on(table.createdAt.desc()),
  ],
);

export type BlockedIpRow = typeof blockedIps.$inferSelect;
export type NewBlockedIpRow = typeof blockedIps.$inferInsert;
