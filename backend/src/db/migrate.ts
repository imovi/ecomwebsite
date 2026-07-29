import { config } from "../config/index.js";
import { closeDatabase, getDb, initDatabase } from "./client.js";

/**
 * Migration runner.
 *
 * Applies every pending migration in `src/db/migrations`, in filename order,
 * inside a transaction, and records what ran in Drizzle's `__drizzle_migrations`
 * table. Re-running is a no-op.
 *
 *   npm run db:migrate
 *
 * Deliberately a standalone process rather than something the server does on
 * boot: with more than one API replica, boot-time migrations race, and a
 * failed migration should stop a deploy rather than crash-loop a container.
 * Run it as a release/pre-deploy step.
 */
async function main(): Promise<void> {
  const startedAt = Date.now();

  await initDatabase();
  const db = getDb();

  const { migrate } =
    config.database.driver === "pglite"
      ? await import("drizzle-orm/pglite/migrator")
      : await import("drizzle-orm/node-postgres/migrator");

  console.log(`Applying migrations from ${config.database.migrationsDir} …`);

  // Both migrator overloads accept the same options shape; the driver-specific
  // database types differ only in their generic parameters.
  await (migrate as (db: unknown, options: { migrationsFolder: string }) => Promise<void>)(
    db,
    { migrationsFolder: config.database.migrationsDir },
  );

  console.log(`Migrations applied in ${Date.now() - startedAt}ms`);
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("Migration failed:", error);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
