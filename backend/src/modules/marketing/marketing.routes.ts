import { Router, type RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { config } from "../../config/index.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { sendSuccess } from "../../core/response.js";
import { TooManyRequestsError } from "../../core/errors.js";
import { getSettings } from "../settings/settings.service.js";
import { configProblem, sendTestEvent } from "./meta-capi.service.js";

/**
 * Marketing / tracking operations.
 *
 * Mounted at /api/v1/admin/marketing. Configuration itself lives in store
 * settings — this router is the two things settings cannot express: a readable
 * connection status, and a button that proves the connection works.
 *
 * `admin` and above, matching settings writes. Connecting an ad account is a
 * commercial decision, and the diagnostic below reveals whether a token is
 * configured.
 */

export const marketingAdminRouter: Router = Router();

marketingAdminRouter.use(authenticate, requireRole("admin"));

/**
 * GET /status — is tracking actually going to fire, and if not, why.
 *
 * Phrased as a checklist rather than a boolean because "why is Ads Manager not
 * receiving anything" has four different answers and the owner cannot see the
 * server logs.
 */
const status: RequestHandler = async (_req, res) => {
  const settings = await getSettings();
  const problem = configProblem(settings);

  sendSuccess(res, {
    status: {
      /* The single question the operator actually has. */
      ready: problem === null,
      problem,

      pixelConfigured: settings.metaPixelId.trim() !== "",
      tokenConfigured: settings.metaCapiToken.trim() !== "",
      trackingEnabled: settings.metaTrackingEnabled,
      domainVerified: settings.metaDomainVerification.trim() !== "",

      /* In test mode events go to the Test Events console and do NOT train the
         campaign. Surfaced prominently because leaving it on is the single most
         expensive misconfiguration available here. */
      testMode: settings.metaTestEventCode.trim() !== "",
      testEventCode: settings.metaTestEventCode,

      /** Where the API claims conversions happened. Must match the verified domain. */
      eventSourceUrl: `${config.marketing.storefrontUrl}/checkout`,

      /* Google Tag Manager is reported alongside Meta but is genuinely
         independent: no token, no server-side send, and its own switch. */
      google: {
        gtmConfigured: settings.googleGtmContainerId.trim() !== "",
        gtmEnabled: settings.googleGtmEnabled,
        gtmContainerId: settings.googleGtmContainerId,
        gtmReady:
          settings.googleGtmContainerId.trim() !== "" && settings.googleGtmEnabled,
      },
    },
  });
};

/**
 * Outbound calls to Meta on demand, so a tight limit — this is a diagnostic, not
 * a workflow, and an unbounded button is a way to burn the shop's API quota.
 */
const testEventRateLimit: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `meta-test:${ipKeyGenerator(req.ip ?? "unknown")}`,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError(60));
  },
});

/**
 * POST /test-event — sends a diagnostic event to Meta and reports what happened.
 *
 * Always 200 with an outcome, even on failure: "Meta rejected your token" is a
 * successful diagnostic, not a server error, and the operator needs to read the
 * reason rather than a generic 500.
 */
const testEvent: RequestHandler = async (_req, res) => {
  const settings = await getSettings();
  const outcome = await sendTestEvent(settings);

  sendSuccess(res, {
    result: {
      sent: outcome.sent,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.eventsReceived !== undefined
        ? { eventsReceived: outcome.eventsReceived }
        : {}),
      ...(outcome.fbTraceId ? { fbTraceId: outcome.fbTraceId } : {}),
      /* Tells the operator which console to look in. */
      destination: settings.metaTestEventCode.trim() !== "" ? "test_events" : "live",
    },
  });
};

marketingAdminRouter.get("/status", status);
marketingAdminRouter.post("/test-event", testEventRateLimit, testEvent);
