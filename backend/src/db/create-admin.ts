import { randomBytes } from "node:crypto";
import { config } from "../config/index.js";
import { closeDatabase, initDatabase } from "./client.js";
import {
  createAdmin,
  findAdminByEmail,
  resetAdminCredentials,
} from "../modules/admins/admin.repository.js";
import { hashPassword } from "../lib/security/password.js";

/**
 * Creates an admin, or resets an existing one's password.
 *
 *   node dist/db/create-admin.js you@example.com
 *   node dist/db/create-admin.js you@example.com "a password you chose"
 *
 * Exists because `db:seed` is deliberately idempotent — it refuses to touch a
 * database that already has an admin, which is right for a seeder and useless
 * when the owner has locked themselves out. This is the recovery path, and it is
 * only reachable by someone who already has shell access to the server.
 *
 * The password is generated when not supplied, and printed once either way.
 */
async function main(): Promise<void> {
  const [emailArg, passwordArg] = process.argv.slice(2);

  if (!emailArg) {
    console.error(
      "\nUsage: node dist/db/create-admin.js <email> [password]\n\n" +
        "  Creates a super admin with that email, or resets the password if one\n" +
        "  already exists. A strong password is generated when you omit it.\n",
    );
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const generated = passwordArg === undefined;
  const password = passwordArg ?? randomBytes(18).toString("base64url");

  if (password.length < 12) {
    throw new Error("The password must be at least 12 characters.");
  }

  /**
   * PGlite is an embedded, single-process database: two processes opening the
   * same data directory corrupts it, and the corruption is not recoverable —
   * the next startup aborts inside the WASM engine with no usable error.
   *
   * Production uses real Postgres, where concurrent connections are the norm and
   * this script is safe to run against a live server. The warning exists because
   * the failure mode in development is silent, total, and easy to trigger.
   */
  if (config.database.driver === "pglite") {
    console.warn(
      "\n  PGlite is embedded and single-process.\n" +
        "  STOP the API before running this, or the database will be corrupted.\n" +
        "  Continuing in 5 seconds — press Ctrl+C to abort.\n",
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  await initDatabase();

  const passwordHash = await hashPassword(password);
  const existing = await findAdminByEmail(email);

  if (existing) {
    /* Also reactivates and clears any lockout — see the repository function. */
    await resetAdminCredentials(existing.id, passwordHash);
    console.log(`\nPassword reset for the existing admin ${email}.`);
  } else {
    const admin = await createAdmin({
      email,
      name: config.seed.adminName,
      passwordHash,
      role: "super_admin",
      isActive: true,
    });
    console.log(`\nCreated super admin ${admin.email}.`);
  }

  console.log(`\n  Email:    ${email}`);
  console.log(`  Password: ${password}\n`);

  if (generated) {
    console.log("  Store it now — it is not recoverable and will not be shown again.\n");
  }
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error(
      "Could not create the admin:",
      error instanceof Error ? error.message : error,
    );
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
