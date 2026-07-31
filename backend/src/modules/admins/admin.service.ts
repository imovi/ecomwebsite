import { randomBytes } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { admins, type AdminRow } from "../../db/schema/admins.js";
import { ROLE_RANK, type AdminRole } from "../../db/schema/enums.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import { hashPassword } from "../../lib/security/password.js";
import { revokeAllForAdmin } from "../auth/refresh-token.repository.js";
import { createAdmin, findAdminByEmail, findAdminById } from "./admin.repository.js";

/**
 * Team management.
 *
 * Everything here is about one hazard: an owner locking themselves — or the
 * whole shop — out of its own admin panel. There is no support desk to call and
 * no password-reset email, so the guards below are the only thing standing
 * between a mis-click and a trip to the server's shell.
 *
 * Three rules, enforced on every path that could break them:
 *
 *   1. The last active super admin cannot be removed, demoted or disabled.
 *   2. Nobody can change their OWN role or disable their OWN account. Losing
 *      your own access is the one mistake you cannot undo from the UI.
 *   3. Nobody can create or promote someone above their own rank, so an `admin`
 *      cannot mint a `super_admin` and escalate through it.
 */

const log = createLogger("team");

export interface AdminDto {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  /** Present when the account is temporarily locked by failed logins. */
  lockedUntil: string | null;
  /**
   * Whether that lock is still in force.
   *
   * Computed here rather than by comparing `lockedUntil` to the clock in the
   * browser: the server's clock is the one the lock is actually enforced
   * against, and a time comparison during a render is impure — it changes on
   * re-render for no reason the UI can see.
   */
  isLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

function toDto(row: AdminRow): AdminDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    lockedUntil: row.lockedUntil ? row.lockedUntil.toISOString() : null,
    isLocked: row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now(),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function list(): Promise<AdminDto[]> {
  const rows = await getDb().select().from(admins).orderBy(asc(admins.createdAt));
  return rows.map(toDto);
}

/** How many super admins could still sign in if this one went away. */
async function otherActiveSuperAdmins(excludeId: string): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(admins)
    .where(
      and(eq(admins.role, "super_admin"), eq(admins.isActive, true), ne(admins.id, excludeId)),
    );

  return rows[0]?.count ?? 0;
}

/**
 * Refuses a change that would leave nobody able to administer the shop.
 *
 * Called before demoting, disabling or deleting — all three have the same
 * end state, so they share one guard rather than three near-copies.
 */
async function assertNotLastSuperAdmin(target: AdminRow, action: string): Promise<void> {
  if (target.role !== "super_admin" || !target.isActive) return;

  if ((await otherActiveSuperAdmins(target.id)) === 0) {
    throw new BadRequestError(
      `This is the only active owner account, so it cannot be ${action}. ` +
        "Promote another account to owner first.",
    );
  }
}

/** Nobody may grant a role they do not themselves hold. */
function assertCanAssign(actorRole: AdminRole, targetRole: AdminRole): void {
  if (ROLE_RANK[targetRole] > ROLE_RANK[actorRole]) {
    throw new ForbiddenError("You cannot give someone a role higher than your own.");
  }
}

export interface CreateTeamMemberInput {
  email: string;
  name: string;
  role: AdminRole;
  /** Omitted means "generate one and return it once". */
  password?: string | undefined;
}

export interface CreatedTeamMember {
  admin: AdminDto;
  /**
   * Returned exactly once, at creation.
   *
   * There is no invitation email in this system, so the person who creates the
   * account has to be able to read the password out and pass it on. It is never
   * retrievable afterwards.
   */
  password: string;
}

export async function create(
  input: CreateTeamMemberInput,
  actor: { id: string; role: AdminRole },
): Promise<CreatedTeamMember> {
  assertCanAssign(actor.role, input.role);

  const email = input.email.trim().toLowerCase();

  if (await findAdminByEmail(email)) {
    throw new ConflictError("An account with that email already exists.");
  }

  const password = input.password ?? randomBytes(12).toString("base64url");
  if (password.length < 12) {
    throw new BadRequestError("The password must be at least 12 characters.");
  }

  const row = await createAdmin({
    email,
    name: input.name.trim(),
    passwordHash: await hashPassword(password),
    role: input.role,
    isActive: true,
  });

  log.info({ adminId: row.id, role: row.role, by: actor.id }, "Team member created");
  return { admin: toDto(row), password };
}

export interface UpdateTeamMemberInput {
  name?: string | undefined;
  role?: AdminRole | undefined;
  isActive?: boolean | undefined;
}

export async function update(
  id: string,
  input: UpdateTeamMemberInput,
  actor: { id: string; role: AdminRole },
): Promise<AdminDto> {
  const target = await findAdminById(id);
  if (!target) throw new NotFoundError("Account not found.");

  const isSelf = target.id === actor.id;

  if (input.role !== undefined && input.role !== target.role) {
    if (isSelf) {
      /* Demoting yourself is the single fastest way to lose access, and the UI
         cannot undo it afterwards. */
      throw new BadRequestError("You cannot change your own role.");
    }
    assertCanAssign(actor.role, input.role);
    /* Acting ON someone senior is also barred — otherwise an `admin` could
       demote the owner and take over. */
    assertCanAssign(actor.role, target.role);
    if (ROLE_RANK[input.role] < ROLE_RANK[target.role]) {
      await assertNotLastSuperAdmin(target, "demoted");
    }
  }

  if (input.isActive === false) {
    if (isSelf) throw new BadRequestError("You cannot deactivate your own account.");
    assertCanAssign(actor.role, target.role);
    await assertNotLastSuperAdmin(target, "deactivated");
  }

  const patch: Partial<AdminRow> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.role !== undefined) patch.role = input.role;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  if (Object.keys(patch).length === 0) {
    throw new BadRequestError("Provide at least one field to update.");
  }

  const rows = await getDb()
    .update(admins)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(admins.id, id))
    .returning();

  const updated = rows[0];
  if (!updated) throw new NotFoundError("Account not found.");

  /* A demotion or a deactivation has to take effect NOW, not when the access
     token happens to expire. `requireRole` re-reads the role on every request,
     so privileges are already current — this closes the refresh token, which
     would otherwise keep minting new access tokens for a disabled account. */
  if (input.isActive === false || (input.role !== undefined && input.role !== target.role)) {
    await revokeAllForAdmin(id, "role or status changed by an administrator");
  }

  log.info({ adminId: id, fields: Object.keys(patch), by: actor.id }, "Team member updated");
  return toDto(updated);
}

/**
 * Sets a new password for someone else.
 *
 * Deliberately does NOT require the old password: the whole point is that a
 * colleague has forgotten theirs. It does revoke their sessions, so a password
 * reset genuinely ends access from wherever they were signed in.
 */
export async function resetPassword(
  id: string,
  actor: { id: string; role: AdminRole },
  password?: string,
): Promise<{ admin: AdminDto; password: string }> {
  const target = await findAdminById(id);
  if (!target) throw new NotFoundError("Account not found.");

  if (target.id !== actor.id) assertCanAssign(actor.role, target.role);

  const next = password ?? randomBytes(12).toString("base64url");
  if (next.length < 12) {
    throw new BadRequestError("The password must be at least 12 characters.");
  }

  const rows = await getDb()
    .update(admins)
    .set({
      passwordHash: await hashPassword(next),
      passwordChangedAt: sql`now()`,
      /* A reset is also the way out of a brute-force lockout. */
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: sql`now()`,
    })
    .where(eq(admins.id, id))
    .returning();

  const updated = rows[0];
  if (!updated) throw new NotFoundError("Account not found.");

  await revokeAllForAdmin(id, "password reset by an administrator");

  log.info({ adminId: id, by: actor.id }, "Team member password reset");
  return { admin: toDto(updated), password: next };
}

export async function remove(
  id: string,
  actor: { id: string; role: AdminRole },
): Promise<void> {
  const target = await findAdminById(id);
  if (!target) throw new NotFoundError("Account not found.");

  if (target.id === actor.id) {
    throw new BadRequestError("You cannot delete your own account.");
  }

  assertCanAssign(actor.role, target.role);
  await assertNotLastSuperAdmin(target, "deleted");

  await revokeAllForAdmin(id, "account deleted");
  await getDb().delete(admins).where(eq(admins.id, id));

  log.info({ adminId: id, by: actor.id }, "Team member deleted");
}
