import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendSuccess } from "../../core/response.js";
import { UnauthorizedError } from "../../core/errors.js";
import { uuidSchema } from "../../lib/validation/schemas.js";
import { getSettings } from "../settings/settings.service.js";
import * as service from "./courier.service.js";

/**
 * Courier hand-off — /api/v1/admin/courier.
 *
 * Sending a parcel is `manager` and above: it is the order desk's job, done
 * right after the confirmation call, by the same people who work the queue.
 * Nothing here exposes a credential or a margin.
 */

export const courierAdminRouter: Router = Router();

courierAdminRouter.use(authenticate, requireRole("manager"));

function actorOf(req: { auth?: { adminId: string; email: string } | undefined }) {
  if (!req.auth) throw new UnauthorizedError("Authentication required.");
  return { adminId: req.auth.adminId, name: req.auth.email };
}

const orderIdParam = z.object({ id: uuidSchema });

/**
 * A checklist, like the other integrations.
 *
 * "Why can I not send this parcel" has several answers — no courier chosen, no
 * keys, no store id, switched off — and the operator cannot read the logs.
 */
const status: RequestHandler = async (_req, res) => {
  const settings = await getSettings();
  const problem = service.configProblem(settings);

  sendSuccess(res, {
    status: {
      ready: problem === null,
      problem,
      provider: settings.courierProvider,
      credentialsConfigured:
        settings.courierApiKey.trim() !== "" && settings.courierApiSecret.trim() !== "",
      storeIdConfigured: settings.courierStoreId.trim() !== "",
      enabled: settings.courierEnabled,
      openShipments: await service.openCount(),
    },
  });
};

/**
 * Proves the credentials before an order depends on them.
 *
 * Always 200 with an outcome: "Pathao says your store id is wrong" is a
 * successful diagnostic, and the operator needs to read the sentence rather
 * than a 500.
 */
const test: RequestHandler = async (_req, res) => {
  const settings = await getSettings();

  if (settings.courierProvider === "") {
    sendSuccess(res, { result: { ok: false, detail: "Choose a courier first." } });
    return;
  }

  const adapter = service.adapterFor(settings);
  sendSuccess(res, { result: await adapter.verifyCredentials() });
};

const send: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  sendSuccess(res, { shipment: await service.sendOrder(params.id, actorOf(req)) });
};

const forOrder: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  sendSuccess(res, { shipment: await service.findByOrder(params.id) });
};

const sync: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  sendSuccess(res, { shipment: await service.syncShipment(params.id) });
};

/** Refreshes everything still moving. Also runs on a timer. */
const syncAll: RequestHandler = async (_req, res) => {
  sendSuccess(res, { result: await service.syncOpenShipments({ staleMinutes: 0 }) });
};

courierAdminRouter.get("/status", status);
courierAdminRouter.post("/test", test);
courierAdminRouter.post("/sync", syncAll);
courierAdminRouter.get("/order/:id", validate({ params: orderIdParam }), forOrder);
courierAdminRouter.post("/order/:id/send", validate({ params: orderIdParam }), send);
courierAdminRouter.post("/shipment/:id/sync", validate({ params: orderIdParam }), sync);
