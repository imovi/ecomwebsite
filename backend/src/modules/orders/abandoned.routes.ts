import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../../config/index.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { customerKey } from "../../middleware/rate-limit.js";
import { blockGuard } from "../../middleware/block-guard.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendNoContent, sendSuccess } from "../../core/response.js";
import { TooManyRequestsError } from "../../core/errors.js";
import { uuidSchema, safeString } from "../../lib/validation/schemas.js";
/* The same normaliser the real checkout uses, so a lead recorded as
   `+8801712345678` and the order later placed as `01712345678` are recognised
   as the same person and the lead actually closes. */
import { bdPhoneSchema } from "./order.validation.js";
import { deliveryZoneEnum } from "../../db/schema/order-enums.js";
import { ABANDONED_REASONS, ABANDONED_STATUSES } from "../../db/schema/abandoned-checkouts.js";
import * as service from "./abandoned.service.js";
import * as coupons from "./recovery-coupon.service.js";
import type { LeadActor } from "./abandoned-event.repository.js";

/**
 * Incomplete checkouts.
 *
 *   POST /api/v1/checkout/incomplete   public, called as the customer types
 *   GET  /api/v1/checkout/resume/:id   public, the cart behind a WhatsApp link
 *   /api/v1/admin/abandoned            the shop's call list
 *
 * The public endpoint takes a phone number from an unauthenticated stranger, so
 * it is treated like the checkout itself: validated to a real Bangladeshi
 * mobile, rate limited per IP, and never echoed back. It returns 204 — there is
 * nothing a caller should learn from it, including whether the number was
 * already known.
 */

export const abandonedPublicRouter: Router = Router();
export const abandonedAdminRouter: Router = Router();

/**
 * Tighter than quoting, looser than ordering.
 *
 * The storefront saves on a debounce, so a genuine customer sends a handful of
 * these per checkout. A ceiling still matters: without one this is a free way
 * to write rows into the shop's database from anywhere.
 *
 * Keyed by the SHOPPER, like the quote and the checkout, and for the same
 * reason: every one of these arrives from the storefront container, so keying
 * on the connection makes one allowance for the entire shop. A debounced save
 * per customer meant a few dozen checkouts spent it, and the failure is silent
 * by design on the caller's side — so the shop's call list would simply stop
 * filling and nothing anywhere would say why.
 */
const recordRateLimit: RequestHandler = rateLimit({
  windowMs: config.rateLimit.checkout.windowMs,
  limit: config.rateLimit.checkout.quoteMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `abandoned:${customerKey(req)}`,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError(Math.ceil(config.rateLimit.checkout.windowMs / 1000)));
  },
});

const recordSchema = z
  .object({
    phone: bdPhoneSchema,
    /* Everything else is partial by definition — the customer is mid-form. */
    customerName: safeString({ max: 120 }).optional(),
    address: safeString({ max: 500 }).optional(),
    areaText: safeString({ max: 160 }).optional(),
    deliveryZone: z.enum(deliveryZoneEnum.enumValues).optional(),
    items: z
      .array(
        z.object({
          productId: uuidSchema,
          variantId: uuidSchema.nullish(),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .max(50)
      .default([]),
  })
  .strict();

const record: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof recordSchema>>(req);
  await service.record(body);

  /* 204 on purpose. A response body here would tell an anonymous caller
     whether a number is already in the shop's list. */
  sendNoContent(res);
};

/* Blocked addresses are refused here too — a blocked customer filling the call
   list with leads nobody should ring is the same abuse wearing a different
   shape. After the rate limiter, for the reason spelled out in `blockGuard`. */
abandonedPublicRouter.post(
  "/incomplete",
  recordRateLimit,
  blockGuard,
  validate({ body: recordSchema }),
  record,
);

/**
 * The cart behind a resume link.
 *
 * Rate limited on the same allowance as recording one: it is an unauthenticated
 * read keyed by a UUID, and without a ceiling it is a free way to grind through
 * the id space from anywhere. The ids are not guessable and the payload holds no
 * contact details — see `resumeCart` — so a limit is the belt on top of that
 * rather than the thing keeping anybody out.
 */
const resume: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  sendSuccess(res, await service.resumeCart(params.id));
};

abandonedPublicRouter.get(
  "/resume/:id",
  recordRateLimit,
  validate({ params: z.object({ id: uuidSchema }) }),
  resume,
);

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `manager` and above — this is the order desk's daily work, the same people
 * who confirm orders by phone. It carries customer contact details and nothing
 * commercially sensitive, so it does not need the `admin` floor that settings
 * and profit use.
 */
abandonedAdminRouter.use(authenticate, requireRole("manager"));

const listQuerySchema = z
  .object({
    status: z.enum(ABANDONED_STATUSES).optional(),
    includeRecovered: z
      .union([z.literal("true"), z.literal("false")])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

const updateSchema = z
  .object({
    status: z.enum(ABANDONED_STATUSES).optional(),
    note: safeString({ max: 500 }).optional(),
    /* Empty clears it. A reason recorded by mistake has to be removable, and
       "do not contact" in particular gates whether an offer may be made. */
    reason: z.union([z.enum(ABANDONED_REASONS), z.literal("")]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide a status, a note or a reason.",
  });

const sentSchema = z.object({ kind: z.enum(["help", "coupon_offer"]) }).strict();

const idParamSchema = z.object({ id: uuidSchema });

/**
 * Who the history credits.
 *
 * The email rather than a display name, matching what the order timeline
 * records — one convention across both, and an address is at least unambiguous
 * about which of two people called Rahim it was.
 */
function actorOf(req: Parameters<RequestHandler>[0]): LeadActor {
  return { adminId: req.auth?.adminId ?? null, name: req.auth?.email ?? "Admin" };
}

const list: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, z.infer<typeof listQuerySchema>>(req);
  const [checkouts, waiting] = await Promise.all([service.list(query), service.openCount()]);
  sendSuccess(res, { checkouts, openCount: waiting });
};

const update: RequestHandler = async (req, res) => {
  const { body, params } = validated<z.infer<typeof updateSchema>, unknown, { id: string }>(req);
  sendSuccess(res, { checkout: await service.update(params.id, body, actorOf(req)) });
};

/** Confirms a message actually went out — pressed after sending, not before. */
const markSent: RequestHandler = async (req, res) => {
  const { body, params } = validated<z.infer<typeof sentSchema>, unknown, { id: string }>(req);
  sendSuccess(res, {
    checkout: await service.markMessageSent(params.id, body.kind, actorOf(req)),
  });
};

/**
 * Issues the offer, or hands back the one already outstanding.
 *
 * 200 either way, with `created` saying which happened. A second tap is not an
 * error — the operator wants the code, and telling them one already exists
 * somewhere they cannot see would be the least useful possible answer.
 */
const issueCoupon: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  const result = await coupons.generate({ checkoutId: params.id, actor: actorOf(req) });
  sendSuccess(res, result);
};

const cancelCoupon: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  sendSuccess(res, { coupon: await coupons.cancelForLead(params.id, actorOf(req)) });
};

const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await service.remove(params.id);
  sendNoContent(res);
};

abandonedAdminRouter.get("/", validate({ query: listQuerySchema }), list);
abandonedAdminRouter.patch("/:id", validate({ params: idParamSchema, body: updateSchema }), update);
abandonedAdminRouter.delete("/:id", validate({ params: idParamSchema }), remove);

abandonedAdminRouter.post(
  "/:id/sent",
  validate({ params: idParamSchema, body: sentSchema }),
  markSent,
);

/* The offer. POST creates or returns; DELETE withdraws one that has not been
   spent — a coupon the customer has already used cannot be taken back, because
   the order exists, and `cancel` refuses it rather than pretending. */
abandonedAdminRouter.post("/:id/coupon", validate({ params: idParamSchema }), issueCoupon);
abandonedAdminRouter.delete("/:id/coupon", validate({ params: idParamSchema }), cancelCoupon);
