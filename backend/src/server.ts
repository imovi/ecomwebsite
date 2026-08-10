import type { Server } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { closeDatabase, initDatabase } from "./db/client.js";
import { logger } from "./core/logger.js";
import { initStorage } from "./lib/storage/index.js";
import { registerMetaTracking } from "./modules/marketing/meta.subscriber.js";
import { registerOrderIntegrations } from "./modules/integrations/integrations.subscriber.js";
import { isDeliveryConfigured } from "./modules/auth/reset-code.delivery.js";
import {
  startBlockedIpRefresh,
  stopBlockedIpRefresh,
} from "./modules/security/blocked-ip.service.js";
import { startCourierSync, stopCourierSync } from "./modules/courier/courier.sync.js";
import {
  startMetricsScheduler,
  stopMetricsScheduler,
} from "./modules/products/metrics.scheduler.js";
import {
  startTelegramScheduler,
  stopTelegramScheduler,
} from "./modules/integrations/telegram.scheduler.js";

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

  /* Domain event subscribers, before the port opens — a transport registered
     after traffic starts would silently miss the first orders. */
  registerMetaTracking();
  registerOrderIntegrations();

  /* Polls the courier for parcel statuses. Timer is unref'd, so it never holds
     a deploy open. */
  startCourierSync();

  /* Late alerts for abandoned checkouts, and the daily summary. Same unref'd
     timer discipline as the courier sync. */
  startTelegramScheduler();

  /* Refreshes the trending ranking. Without it the score keeps its column
     default of zero and the homepage rail is "newest" wearing another name. */
  startMetricsScheduler();

  /* Loads the blocked-address set into memory and keeps it current, so a
     checkout never pays for a database lookup to catch a rare abuser. Also
     what makes an expiry take effect without anyone doing anything. */
  startBlockedIpRefresh();

  /* Said on every boot, not once at setup. An insecure-cookie deployment is
     meant to be a short bridge until a domain and a certificate exist, and the
     way that turns permanent is nobody being reminded it is still on. */
  if (config.isProduction && !config.auth.cookie.secure) {
    logger.warn(
      "COOKIE_SECURE is off in production — session cookies travel in clear text. " +
        "Only acceptable while testing on a bare IP. Turn it on the moment a domain and " +
        "certificate are in place.",
    );
  }

  /**
   * Said at boot, because the day it matters is the day nobody can log in to
   * find out.
   *
   * A shop with no SMTP host and no Telegram credentials has no way to deliver
   * a password-reset code, and nothing about that is visible until an owner is
   * already locked out — at which point the only remaining route in is SSH and
   * a hand-written UPDATE. The rest of this file already shouts about
   * misconfiguration this consequential; recovery deserves the same.
   */
  void isDeliveryConfigured().then((configured) => {
    if (!configured) {
      logger.warn(
        "No SMTP host and no Telegram credentials — admin password-reset codes " +
          "cannot be delivered. If an owner forgets their password there is no way " +
          "back in through the panel. Set SMTP_* in the environment, or configure " +
          "Telegram in the admin dashboard.",
      );
    }
  });

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

  /* Stop polling before the database closes, so a sync in flight cannot query
     a connection that is being torn down. */
  stopCourierSync();
  stopTelegramScheduler();
  stopMetricsScheduler();
  stopBlockedIpRefresh();

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
