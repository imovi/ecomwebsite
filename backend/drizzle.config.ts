import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * Used only by `npm run db:generate`, which diffs `src/db/schema` against the
 * existing migrations and emits a new plain-SQL migration file. Migrations are
 * *applied* by `src/db/migrate.ts`, not by drizzle-kit, so the same code path
 * runs in CI and in production.
 *
 * Generated SQL is committed and reviewed like any other code — that is the
 * main reason for choosing Drizzle over an ORM that hides its DDL.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./migrations",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/gng",
  },
});
