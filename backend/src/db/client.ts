import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { config } from "../config/index.js";
import { createLogger } from "../core/logger.js";
import { DatabaseError } from "../core/errors.js";
import * as schema from "./schema/index.js";

/**
 * Database connection management.
 *
 * Two drivers behind one type:
 *
 *   postgres — `pg.Pool`. The production driver, and the default.
 *   pglite   — Postgres compiled to WebAssembly, running in-process. For local
 *              development and integration tests on machines with no Postgres
 *              or Docker. It is the *real* Postgres engine, so migrations and
 *              SQL behave identically. Config validation rejects it whenever
 *              NODE_ENV=production.
 *
 * Nothing above this file knows which driver is active.
 */

const log = createLogger("database");

/**
 * The shared database type.
 *
 * `NodePgDatabase` is the canonical shape; the PGlite instance is structurally
 * identical across the query builder surface, so it is cast once here rather
 * than forcing every repository to handle a union of two driver types.
 */
export type Database = NodePgDatabase<typeof schema>;

/** Transaction handle, as passed to `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type DatabaseExecutor = Database | Transaction;

interface Connection {
  db: Database;
  close: () => Promise<void>;
  /** Pool statistics; undefined for the embedded driver, which has no pool. */
  stats: () => { total: number; idle: number; waiting: number } | undefined;
}

let connection: Connection | undefined;

/* -------------------------------------------------------------------------- */
/* Drivers                                                                    */
/* -------------------------------------------------------------------------- */

function createPostgresConnection(): Connection {
  /* Postgres returns BIGINT (int8) as a string by default to avoid silent
     precision loss beyond 2^53. Money in this system is integer taka and will
     never approach that, and reading counts as strings is a recurring source
     of bugs, so int8 is parsed as a number deliberately. */
  pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

  const pool = new pg.Pool({
    connectionString: config.database.url,
    max: config.database.pool.max,
    idleTimeoutMillis: config.database.pool.idleTimeoutMillis,
    connectionTimeoutMillis: config.database.pool.connectionTimeoutMillis,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
    application_name: "gng-api",
  });

  /* An idle client erroring (network blip, server restart) emits on the pool.
     Without a listener Node treats it as an unhandled 'error' event and kills
     the process — pg removes the broken client itself, so logging is enough. */
  pool.on("error", (error) => {
    log.error({ err: error }, "Idle database client error");
  });

  return {
    db: drizzleNodePg({ client: pool, schema, casing: "snake_case" }),
    close: () => pool.end(),
    stats: () => ({
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    }),
  };
}

async function createPgliteConnection(): Promise<Connection> {
  /* Imported dynamically so the WASM bundle is never loaded — or even
     required to be installed — in a production deployment. */
  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);

  const dataDir = config.database.pgliteDataDir;
  const client = new PGlite(dataDir);
  await client.waitReady;

  log.warn(
    { dataDir },
    "Using the embedded PGlite driver — development and testing only",
  );

  return {
    db: drizzlePglite({
      client,
      schema,
      casing: "snake_case",
    }) as unknown as Database,
    close: () => client.close(),
    stats: () => undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Opens the connection and verifies it with a round trip.
 *
 * Called once during bootstrap. Failing here — rather than lazily on the first
 * request — means an orchestrator sees the container fail its start and can
 * roll back the deploy.
 */
export async function initDatabase(): Promise<Database> {
  if (connection) return connection.db;

  connection =
    config.database.driver === "pglite"
      ? await createPgliteConnection()
      : createPostgresConnection();

  try {
    await connection.db.execute(sql`select 1`);
  } catch (error) {
    await connection.close().catch(() => undefined);
    connection = undefined;
    throw new DatabaseError("Failed to establish a database connection.", error);
  }

  log.info(
    { driver: config.database.driver, poolMax: config.database.pool.max },
    "Database connected",
  );

  return connection.db;
}

/**
 * Returns the active connection.
 *
 * Throws rather than lazily connecting: an implicit connect inside a request
 * handler hides startup failures and makes connection storms possible.
 */
export function getDb(): Database {
  if (!connection) {
    throw new DatabaseError("Database has not been initialised. Call initDatabase() first.");
  }
  return connection.db;
}

export async function closeDatabase(): Promise<void> {
  if (!connection) return;
  await connection.close();
  connection = undefined;
  log.info("Database connection closed");
}

/** Cheap liveness probe used by the readiness endpoint. */
export async function pingDatabase(): Promise<boolean> {
  if (!connection) return false;
  try {
    await connection.db.execute(sql`select 1`);
    return true;
  } catch (error) {
    log.error({ err: error }, "Database ping failed");
    return false;
  }
}

export function getPoolStats(): ReturnType<Connection["stats"]> {
  return connection?.stats();
}

/**
 * Test seam. Lets an integration test supply its own Drizzle instance without
 * the production bootstrap path. Not exported through any route.
 */
export function __setTestConnection(testConnection: Connection | undefined): void {
  connection = testConnection;
}

export { schema };
