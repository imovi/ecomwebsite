import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { webhookRateLimit } from "../../middleware/rate-limit.js";
import { createLogger } from "../../core/logger.js";
import * as service from "./courier.service.js";
import * as bot from "../integrations/telegram-bot.service.js";

/**
 * Inbound webhooks — /api/v1/webhooks.
 *
 * Two senders live here: the courier reporting a parcel, and Telegram
 * delivering button taps and commands. They share a file because they share the
 * one property that matters — both are public URLs that can change orders, and
 * both are guarded by a shared secret rather than a session.
 *
 * Courier webhook — /courier/steadfast.
 *
 * The one endpoint in this API that is both public and able to move an order to
 * `delivered`, which is the number the whole profit report is built on. So it is
 * deliberately the narrowest thing that can work:
 *
 *  - A bearer secret, compared in constant time, generated in the panel and
 *    pasted into the courier's own webhook settings. No secret configured means
 *    the endpoint refuses everything.
 *  - It reads a consignment id and a status. It cannot create an order, cannot
 *    change a price, and cannot reach any other part of the API.
 *  - It answers in the courier's own response shape, not this API's envelope,
 *    because the courier is the client here and their documentation states what
 *    they expect back.
 *
 * WHY NOT THE STANDARD ENVELOPE
 * Every other route answers `{ success, data, requestId }`. Steadfast documents
 * `{ status, message }` and treats anything else as a failure, so matching their
 * contract is the difference between a delivery confirmation landing and being
 * retried until they give up.
 *
 * WHY NON-2xx IS AVOIDED FOR BUSINESS FAILURES
 * A webhook that answers with an error gets retried. A parcel we have never
 * heard of — one created by hand in the courier's panel — would be retried
 * forever, so it is answered 200 with an error body: read as "received, not
 * ours" rather than "try again". Only a bad credential is a 401, because that
 * one genuinely needs the sender to stop and be fixed.
 */

const log = createLogger("courier:webhook");

export const webhookRouter: Router = Router();

/**
 * Deliberately loose.
 *
 * A courier that adds a field must not start failing validation, and one that
 * renames a field we do not read must not either. Only what is actually used is
 * constrained; `passthrough` keeps the rest without inspecting it.
 */
const steadfastPayloadSchema = z
  .object({
    notification_type: z.string().min(1).max(60),
    /* Sent as a number, but a courier switching to a string id later should not
       take the endpoint down — coerced rather than rejected. */
    consignment_id: z.union([z.number(), z.string().min(1).max(60)]),
    invoice: z.string().max(120).optional(),
    status: z.string().max(60).optional(),
    tracking_message: z.string().max(1000).optional(),
    cod_amount: z.number().optional(),
    delivery_charge: z.number().optional(),
    updated_at: z.string().max(60).optional(),
  })
  .passthrough();

function bearerOf(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

const steadfast: RequestHandler = async (req, res) => {
  const authorised = await service.verifyWebhookToken(bearerOf(req.get("authorization")));

  if (!authorised) {
    /* No detail about why. An endpoint that distinguishes "no token" from
       "wrong token" tells an attacker which half of the problem to work on. */
    log.warn({ ip: req.ip }, "Courier webhook rejected — bad or missing token");
    res.status(401).json({ status: "error", message: "Unauthorized." });
    return;
  }

  const parsed = steadfastPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues }, "Courier webhook payload rejected");
    res.status(400).json({ status: "error", message: "Malformed payload." });
    return;
  }

  const payload = parsed.data;

  try {
    const outcome = await service.handleWebhook({
      notification_type: payload.notification_type,
      consignment_id: Number(payload.consignment_id),
      ...(payload.invoice !== undefined ? { invoice: payload.invoice } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.tracking_message !== undefined
        ? { tracking_message: payload.tracking_message }
        : {}),
    });

    if (!outcome.handled) {
      /* 200 on purpose — see the header comment. This is "received, and it is
         not ours", which retrying cannot fix. */
      res.status(200).json({ status: "error", message: outcome.reason });
      return;
    }

    log.info(
      { type: payload.notification_type, consignmentId: payload.consignment_id },
      outcome.detail,
    );
    res.status(200).json({ status: "success", message: "Webhook received successfully." });
  } catch (error) {
    /* A genuine failure on our side IS worth retrying, so this one is a 500 —
       the courier resending it is exactly what should happen. */
    log.error({ err: error, consignmentId: payload.consignment_id }, "Courier webhook failed");
    res.status(500).json({ status: "error", message: "Could not process the webhook." });
  }
};

/**
 * POST /api/v1/webhooks/telegram — button taps and commands from the bot.
 *
 * Always 200, even for a rejected update. Telegram retries a non-2xx, and a
 * retried button tap would apply the same action to an order twice. Refusals are
 * logged and answered inside the bot service instead.
 */
const telegram: RequestHandler = async (req, res) => {
  const authorised = await bot.verifySecret(
    req.get("x-telegram-bot-api-secret-token") ?? null,
  );

  if (!authorised) {
    log.warn({ ip: req.ip }, "Telegram webhook rejected — bad or missing secret");
    /* 401 here, not 200: this is not Telegram, so there is nothing to protect
       from a retry, and refusing plainly is the honest answer. */
    res.status(401).json({ ok: false });
    return;
  }

  /* Answered immediately, before the work. Telegram's timeout is short and it
     retries anything slow — which for a button tap means applying it twice. */
  res.status(200).json({ ok: true });

  await bot.handleUpdate(req.body as bot.TelegramUpdate);
};

webhookRouter.post("/courier/steadfast", webhookRateLimit, steadfast);
webhookRouter.post("/telegram", webhookRateLimit, telegram);
