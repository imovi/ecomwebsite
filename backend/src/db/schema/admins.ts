import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminRoleEnum } from "./enums.js";

/**
 * Administrator accounts.
 *
 * This is the only identity table in Phase 1 — customers are explicitly out of
 * scope and, when they arrive, belong in a separate table. Merging staff and
 * customer identities into one `users` table is a decision that is very hard
 * to unpick later and leads to authorisation bugs where a customer row can be
 * promoted to admin.
 */
export const admins = pgTable(
  "admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Stored lower-cased and trimmed; the unique index enforces one account
     *  per address regardless of the casing the user typed. */
    email: text("email").notNull(),
    name: text("name").notNull(),

    /** Argon2id digest. The algorithm and its parameters are encoded in the
     *  string itself, so parameters can be raised later and existing hashes
     *  still verify — see `needsRehash` in lib/security/password.ts. */
    passwordHash: text("password_hash").notNull(),

    role: adminRoleEnum("role").notNull().default("admin"),

    /** Soft disable. Preferred over deletion so order history and audit
     *  trails keep referencing a real row. */
    isActive: boolean("is_active").notNull().default(true),

    /* --- Brute-force protection ------------------------------------------
       Tracked per account rather than only per IP, because an attacker with a
       botnet trivially defeats IP-only throttling. */
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Bumped on password change; used to invalidate older access tokens. */
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    /* Case-insensitive uniqueness, enforced by the database rather than by
       application code that can be bypassed. */
    uniqueIndex("admins_email_unique_idx").on(sql`lower(${table.email})`),
    index("admins_role_idx").on(table.role),
    index("admins_is_active_idx").on(table.isActive),
  ],
);

export type AdminRow = typeof admins.$inferSelect;
export type NewAdminRow = typeof admins.$inferInsert;
