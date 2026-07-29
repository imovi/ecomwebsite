import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { admins } from "./admins.js";

/**
 * Refresh token store.
 *
 * Three deliberate properties:
 *
 * 1. **The token is never stored.** Only its SHA-256 digest. A dump of this
 *    table yields nothing an attacker can present to the API. (SHA-256 rather
 *    than Argon2 is correct here — the token is 256 bits of CSPRNG output, so
 *    there is no low-entropy input to protect against brute force, and refresh
 *    is a hot path that must not cost 50ms of hashing.)
 *
 * 2. **Rotation.** Every use issues a new token and marks the old one used,
 *    linking to its replacement via `replacedByTokenId`.
 *
 * 3. **Reuse detection via `familyId`.** All tokens descended from one login
 *    share a family. Presenting an already-rotated token means it leaked, so
 *    the whole family is revoked at once and the session dies. Without this,
 *    a stolen refresh token grants indefinite access.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),

    /** SHA-256 of the opaque token, hex encoded. Unique: a collision would
     *  mean two sessions share a credential. */
    tokenHash: text("token_hash").notNull().unique(),

    /** Groups every token rotated from a single login. */
    familyId: uuid("family_id").notNull(),

    /** Set when this token is exchanged. A second exchange attempt is a reuse
     *  and revokes the family. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    replacedByTokenId: uuid("replaced_by_token_id"),

    /** Set on logout or on family revocation. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /* Captured for the session list and for forensics after a compromise. */
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("refresh_tokens_admin_id_idx").on(table.adminId),
    index("refresh_tokens_family_id_idx").on(table.familyId),
    /* Supports the periodic purge of dead rows. */
    index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenRow = typeof refreshTokens.$inferInsert;
