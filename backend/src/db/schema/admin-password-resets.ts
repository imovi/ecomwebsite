import { sql } from "drizzle-orm";
import {
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
 * One-time codes for "I forgot my password".
 *
 * WHY A CODE AND NOT A LINK
 * -------------------------
 * The usual design is a signed link in an email. A six-digit code is used here
 * instead because the code has to work over TWO channels — email and Telegram —
 * and a link pasted into a Telegram message is one tap away from being opened
 * on a phone that is not the one holding the admin session, forwarded to
 * someone else, or eaten by a link preview fetcher that "visits" it and burns a
 * single-use token before the owner ever taps it. A code is read by a human and
 * typed into the page they are already looking at.
 *
 * WHAT IS STORED
 * --------------
 * The Argon2 digest of the code, never the code. A six-digit code is only a
 * million possibilities, so a leaked table full of plaintext codes would be an
 * account takeover for every reset in flight. Argon2 also makes each guess
 * cost real time, which is a second brake underneath `attempts`.
 *
 * Rows are kept after use rather than deleted — `consumed_at` records that a
 * reset actually happened, and a burst of unconsumed rows for one account is
 * what an attack looks like from the outside.
 */
export const adminPasswordResets = pgTable(
  "admin_password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Cascade: a deleted account has no password left to reset. */
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),

    /** Argon2id digest of the six-digit code. */
    codeHash: text("code_hash").notNull(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /**
     * Wrong guesses against this code.
     *
     * Bounded, because rate limiting alone is not enough here: the limiter keys
     * on an address, and a million-possibility secret plus a botnet is a real
     * attack. Past the limit the code is dead and a new one must be requested,
     * which puts the attacker back through the send channel.
     */
    attempts: integer("attempts").notNull().default(0),

    /** Set the moment the code is spent. A code works exactly once. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),

    /** Who asked. Not used for any decision — it is here so an attack can be
     *  read out of the table afterwards. */
    requestedIp: text("requested_ip"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* Serves both hot reads: "the newest live code for this account" on verify,
       and "how recently did this account ask" for the resend cooldown. */
    index("admin_password_resets_admin_idx").on(table.adminId, table.createdAt.desc()),

    /**
     * At most one LIVE code per admin — the invariant the service depends on,
     * enforced where it cannot be raced.
     *
     * Two live codes would mean two independent five-attempt budgets against a
     * six-digit secret, and would make "the newest code wins" ambiguous. The
     * application's invalidate-then-insert sequence is not atomic on its own;
     * this is what makes it safe. Partial, because spent codes are kept
     * deliberately — only unconsumed ones are constrained.
     */
    uniqueIndex("admin_password_resets_one_live_idx")
      .on(table.adminId)
      .where(sql`${table.consumedAt} is null`),
  ],
);

export type AdminPasswordResetRow = typeof adminPasswordResets.$inferSelect;
export type NewAdminPasswordResetRow = typeof adminPasswordResets.$inferInsert;
