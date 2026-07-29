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

  const generated = !config.seed.adminPassword;
  const password = config.seed.adminPassword ?? randomBytes(18).toString("base64url");

  if (!generated && password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
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
