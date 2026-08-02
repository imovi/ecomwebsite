import { Router, type RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { config } from "../../config/index.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { sendSuccess } from "../../core/response.js";
import { TooManyRequestsError } from "../../core/errors.js";
import { getSettings } from "../settings/settings.service.js";
import * as telegram from "./telegram.service.js";
import * as sheets from "./google-sheets.service.js";

/**
 * Integration status and diagnostics — /api/v1/admin/integrations.
 *
 * Configuration itself lives in store settings; this router is what settings
 * cannot express: a readable status, and buttons that prove the connection works
 * before an order depends on it.
 *
 * `admin` and above, matching settings writes — and because these responses
 * reveal whether credentials are configured.
 */

export const integrationsAdminRouter: Router = Router();

integrationsAdminRouter.use(authenticate, requireRole("admin"));

/**
 * These make outbound calls on demand, so a tight ceiling. A diagnostic button
 * with no limit is a way to burn the shop's Google quota, or to have Telegram
 * rate-limit the bot for everyone.
 */
const diagnosticRateLimit: RequestHandler = rateLimit({
  windowMs: config.rateLimit.integrationTest.windowMs,
  limit: config.rateLimit.integrationTest.max,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `integration-test:${ipKeyGenerator(req.ip ?? "unknown")}`,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError(config.rateLimit.integrationTest.windowMs / 1000));
  },
});

/**
 * A checklist rather than a boolean.
 *
 * "Why did no alert arrive" has several answers and the shop owner cannot read
 * the server logs, so each prerequisite is reported separately.
 */
const status: RequestHandler = async (_req, res) => {
  const settings = await getSettings();

  const telegramProblem = telegram.configProblem(settings);
  const sheetsProblem = sheets.configProblem(settings);

  sendSuccess(res, {
    status: {
      telegram: {
        ready: telegramProblem === null,
        problem: telegramProblem,
        tokenConfigured: settings.telegramBotToken.trim() !== "",
        chatConfigured: settings.telegramChatId.trim() !== "",
        enabled: settings.telegramEnabled,
        chatId: settings.telegramChatId,
        /**
         * The interactive half: buttons and commands.
         *
         * Reported separately from `enabled` because they fail independently —
         * alerts can be arriving perfectly while the buttons do nothing, and
         * that is exactly the state somebody needs to be told about.
         */
        botEnabled: settings.telegramWebhookSecret !== "",
        allowedUserIds: settings.telegramAllowedUserIds,
        /* What Telegram itself believes. A URL it cannot reach shows up here
           as a pending backlog and an error string, which is the only place
           that failure is visible at all. */
        webhook: settings.telegramBotToken.trim() === "" ? null : await telegram.webhookInfo(settings),
      },
      googleSheets: {
        ready: sheetsProblem === null,
        problem: sheetsProblem,
        credentialsConfigured: settings.googleSheetsCredentials.trim() !== "",
        sheetConfigured: settings.googleSheetsId.trim() !== "",
        enabled: settings.googleSheetsEnabled,
        tab: settings.googleSheetsTab,
        /**
         * The service account's email.
         *
         * Surfaced because the sheet has to be SHARED with it, and forgetting
         * that is the single most common reason the export 403s. Derived from
         * the stored key rather than asked for separately — it is public
         * information inside a credential that is not.
         */
        serviceAccountEmail: (() => {
          if (settings.googleSheetsCredentials.trim() === "") return null;
          const parsed = sheets.parseCredentials(settings.googleSheetsCredentials);
          return "error" in parsed ? null : parsed.client_email;
        })(),
        columns: sheets.SHEET_COLUMNS,
      },
    },
  });
};

/**
 * Always answers 200 with an outcome, even on failure: "Telegram says your token
 * is invalid" is a successful diagnostic, and the operator needs to read the
 * reason rather than a generic 500.
 */
const testTelegram: RequestHandler = async (_req, res) => {
  sendSuccess(res, { result: await telegram.sendTestMessage() });
};

const findChats: RequestHandler = async (_req, res) => {
  sendSuccess(res, { result: await telegram.discoverChats() });
};

const testSheets: RequestHandler = async (_req, res) => {
  sendSuccess(res, { result: await sheets.sendTestRow() });
};

/**
 * Turns the interactive bot on: mints a secret, tells Telegram where to send
 * updates, and stores the secret so incoming ones can be checked.
 *
 * Both halves have to succeed. Storing a secret Telegram was never told about
 * would leave an endpoint that refuses every real update; telling Telegram a
 * secret we did not store would do the same in reverse. So Telegram is asked
 * first and the secret is only written once it accepted.
 */
const enableBot: RequestHandler = async (_req, res) => {
  sendSuccess(res, { result: await telegram.enableBot() });
};

const disableBot: RequestHandler = async (_req, res) => {
  sendSuccess(res, { result: await telegram.disableBot() });
};

integrationsAdminRouter.get("/status", status);
integrationsAdminRouter.post("/telegram/test", diagnosticRateLimit, testTelegram);
integrationsAdminRouter.post("/telegram/find-chats", diagnosticRateLimit, findChats);
integrationsAdminRouter.post("/telegram/bot/enable", diagnosticRateLimit, enableBot);
integrationsAdminRouter.post("/telegram/bot/disable", diagnosticRateLimit, disableBot);
integrationsAdminRouter.post("/sheets/test", diagnosticRateLimit, testSheets);
