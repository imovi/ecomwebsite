import { Router, type RequestHandler } from "express";
import { config } from "../../config/index.js";
import { getPoolStats, pingDatabase } from "../../db/client.js";
import { sendSuccess } from "../../core/response.js";
import { HttpStatus } from "../../core/http-status.js";
import { ServiceUnavailableError } from "../../core/errors.js";

/**
 * Health endpoints — mounted outside the versioned API, at /health.
 *
 * Two distinct probes, because orchestrators need to tell two different
 * questions apart:
 *
 *   /health/live   — is the process alive? Never touches a dependency. If this
 *                    fails, restarting helps.
 *   /health/ready  — can it serve traffic? Checks the database. If this fails,
 *                    restarting does NOT help; the instance should just leave
 *                    the load balancer rotation until the dependency recovers.
 *
 * Conflating the two is how a brief database blip turns into every replica
 * being killed and restarted simultaneously.
 */
export const healthRouter: Router = Router();

const startedAt = Date.now();

const live: RequestHandler = (_req, res) => {
  sendSuccess(res, {
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
};

const ready: RequestHandler = async (_req, res) => {
  const databaseReachable = await pingDatabase();

  if (!databaseReachable) {
    throw new ServiceUnavailableError("Database is not reachable.");
  }

  sendSuccess(res, {
    status: "ready",
    checks: {
      database: {
        status: "ok",
        driver: config.database.driver,
        /* Pool saturation is the first symptom of a leak or a slow query;
           surfacing it here means monitoring gets it for free. */
        pool: getPoolStats() ?? null,
      },
    },
    timestamp: new Date().toISOString(),
  });
};

healthRouter.get("/", live);
healthRouter.get("/live", live);
healthRouter.get("/ready", ready);

/** Bare 200 for load balancers that want no body at all. */
healthRouter.head("/", (_req, res) => {
  res.status(HttpStatus.OK).end();
});
