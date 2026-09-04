import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
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
  const available = await service.getAvailableCourierProviders(settings);

  sendSuccess(res, {
    status: {
      ready: problem === null || available.providers.some((p) => p.ready),
      problem,
      provider: settings.courierProvider,
      availableProviders: available.providers,
      defaultProvider: available.defaultProvider,
      credentialsConfigured:
        settings.courierApiKey.trim() !== "" && settings.courierApiSecret.trim() !== "",
      storeIdConfigured: settings.courierStoreId.trim() !== "",
      enabled: settings.courierEnabled,
      openShipments: await service.openCount(),
      /* State only, never the secret — the panel needs to know whether the
         webhook is armed, not what the token is. */
      webhookConfigured: settings.courierWebhookToken !== "",
      /**
       * Built here, from the API's own configured public address.
       *
       * The panel cannot work this out: the browser only knows the storefront's
       * origin, and the API answers on a different host. Guessing at it from
       * the page URL produced `https://api.localhost:3000` in development and
       * would have been a plausible-looking wrong address in any deployment
       * that does not follow the `api.` prefix convention — pasted into the
       * courier's panel, that fails silently as a webhook that never arrives.
       */
      webhookUrl: `${config.server.apiUrl}/api/v1/webhooks/courier/steadfast`,
    },
  });
};

/**
 * Generates a fresh webhook secret and returns it once.
 *
 * `admin` and above rather than the `manager` floor this router uses: rotating
 * it silently breaks delivery updates until someone re-pastes it into the
 * courier's panel, which is a commercial setting rather than order-desk work.
 */
const rotateWebhookToken: RequestHandler = async (_req, res) => {
  sendSuccess(res, { token: await service.rotateWebhookToken() });
};

const clearWebhookToken: RequestHandler = async (_req, res) => {
  await service.clearWebhookToken();
  sendSuccess(res, { cleared: true });
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

const sendBody = z
  .object({
    provider: z.enum(["steadfast", "pathao"]).optional(),
  })
  .optional();

const send: RequestHandler = async (req, res) => {
  const { params, body } = validated<{ provider?: "steadfast" | "pathao" }, unknown, { id: string }>(req);
  sendSuccess(res, { shipment: await service.sendOrder(params.id, actorOf(req), body?.provider) });
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
courierAdminRouter.post("/webhook-token", requireRole("admin"), rotateWebhookToken);
courierAdminRouter.delete("/webhook-token", requireRole("admin"), clearWebhookToken);
courierAdminRouter.post("/sync", syncAll);
courierAdminRouter.get("/order/:id", validate({ params: orderIdParam }), forOrder);
courierAdminRouter.post(
  "/order/:id/send",
  validate({ params: orderIdParam, body: sendBody }),
  send,
);
courierAdminRouter.post("/shipment/:id/sync", validate({ params: orderIdParam }), sync);
