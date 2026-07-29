import type { AdminRow } from "../../db/schema/admins.js";
import type { AdminRole } from "../../db/schema/enums.js";

/**
 * The public shape of an admin.
 *
 * Note what is absent: `passwordHash`, `failedLoginAttempts`, `lockedUntil`.
 * Serialising the row type directly is how password digests end up in API
 * responses, so the mapper below is the only sanctioned way to put an admin on
 * the wire.
 */
export interface AdminDto {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toAdminDto(row: AdminRow): AdminDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Normalised form used for storage and lookup — one account per address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
