import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Admin roles, ordered from least to most privileged.
 *
 * Kept as a Postgres enum rather than a free-text column so an invalid role
 * cannot be written by any path — including a manual `psql` session. Adding a
 * role later is an `ALTER TYPE ... ADD VALUE` migration.
 *
 *   manager     — day-to-day operations (future: orders, stock)
 *   admin       — full catalogue and operations control
 *   super_admin — everything, including managing other admins
 */
export const adminRoleEnum = pgEnum("admin_role", ["manager", "admin", "super_admin"]);

export type AdminRole = (typeof adminRoleEnum.enumValues)[number];

/**
 * Privilege ordering used by the role middleware.
 *
 * A route guarded with `requireRole("admin")` also admits `super_admin`,
 * because privilege is hierarchical here. Anything needing non-hierarchical
 * access control should use explicit permissions, not this.
 */
export const ROLE_RANK: Record<AdminRole, number> = {
  manager: 1,
  admin: 2,
  super_admin: 3,
};

export const ADMIN_ROLES = adminRoleEnum.enumValues;
