import { randomBytes } from "node:crypto";
import { config } from "../config/index.js";
import { closeDatabase, initDatabase } from "./client.js";
import { countAdmins, createAdmin, findAdminByEmail } from "../modules/admins/admin.repository.js";
import { hashPassword } from "../lib/security/password.js";

/**
 * Seeds the first super admin.
 *
 *   npm run db:seed
 *
 * Idempotent: re-running against a database that already has admins does
 * nothing. There is no hardcoded default password — if SEED_ADMIN_PASSWORD is
 * unset, a strong one is generated and printed once. A committed default
 * credential is how staging environments end up compromised.
 */
async function main(): Promise<void> {
  await initDatabase();

  const existing = await countAdmins();
  if (existing > 0) {
    console.log(`Skipped: ${existing} admin account(s) already exist.`);
    return;
  }

  const email = config.seed.adminEmail;
  if (!email) {
    throw new Error(
      "SEED_ADMIN_EMAIL is required to seed the first administrator. " +
        "Set it in .env and re-run.",
    );
  }

  if (await findAdminByEmail(email)) {
    console.log(`Skipped: an admin with the email ${email} already exists.`);
    return;
  }

  /* Read once. Deriving `generated` from a truthiness check while resolving the
     password with `??` is how this previously created an admin whose password was
     the empty string: `""` is falsy but not nullish, so it reported a generated
     password and stored a blank one. Env parsing now normalises blank to
     undefined, and both values come from the same binding so they cannot
     disagree again. */
  const configured = config.seed.adminPassword;
  const generated = configured === undefined;
  const password = configured ?? randomBytes(18).toString("base64url");

  if (password.length < 12) {
    throw new Error(
      generated
        ? "Failed to generate a password. This is a bug; do not seed with a weak credential."
        : "SEED_ADMIN_PASSWORD must be at least 12 characters.",
    );
  }

  const admin = await createAdmin({
    email,
    name: config.seed.adminName,
    passwordHash: await hashPassword(password),
    role: "super_admin",
    isActive: true,
  });

  console.log("\nCreated the first super admin:\n");
  console.log(`  id:    ${admin.id}`);
  console.log(`  email: ${admin.email}`);
  console.log(`  role:  ${admin.role}`);

  if (generated) {
    console.log(`\n  Generated password: ${password}`);
    console.log("  Store it now — it is not recoverable and will not be shown again.\n");
  } else {
    console.log("\n  Password: taken from SEED_ADMIN_PASSWORD.\n");
  }
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
