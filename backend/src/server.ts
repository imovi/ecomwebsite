import type { Server } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { closeDatabase, initDatabase } from "./db/client.js";
import { logger } from "./core/logger.js";
import { initStorage } from "./lib/storage/index.js";

/**
 * Process bootstrap and lifecycle.
 *
 * Responsibilities kept out of `app.ts` on purpose: connecting dependencies,
 * binding the port, and shutting down cleanly.
 */

let server: Server | undefined;
let shuttingDown = false;

async function start(): Promise<void> {
  /* Dependencies connect BEFORE the port is bound. Binding first would let the
     load balancer route traffic to an instance that cannot serve it, turning a
     slow database start into a burst of 500s. */
  await initDatabase();
  await initStorage();

  const app = createApp();

  server = app.listen(config.server.port, () => {
    logger.info(
      {
        port: config.server.port,
        env: config.env,
        apiUrl: config.server.apiUrl,
        databaseDriver: config.database.driver,
      },
      `gng API listening on port ${config.server.port}`,
    );
  });

  /* Must exceed the idle timeout of any upstream proxy (ALB defaults to 60s),
     otherwise the proxy reuses a connection Node is simultaneously closing and
     the client sees sporadic 502s. */
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
}

/**
 * Graceful shutdown.
 *
 * Stops accepting new connections, lets in-flight requests finish, then closes
 * the database. The timeout is the backstop: a request wedged on a hung query
 * must not keep a terminating pod alive until the orchestrator SIGKILLs it.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, config.server.shutdownTimeoutMs);
  /* Do not let this timer hold the event loop open if shutdown finishes. */
  forceExit.unref();

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
      logger.info("HTTP server closed");
    }

    await closeDatabase();

    clearTimeout(forceExit);
    logger.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

/**
 * An unhandled rejection or uncaught exception leaves the process in an
 * unknown state. Logging and continuing is worse than dying: the orchestrator
 * can replace a dead process, but not a silently corrupted one.
 */
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("unhandledRejection");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException");
});

start().catch((error: unknown) => {
  logger.fatal({ err: error }, "Failed to start the server");
  process.exit(1);
});
