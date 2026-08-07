import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../../config/index.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { customerKey } from "../../middleware/rate-limit.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendNoContent, sendSuccess } from "../../core/response.js";
import { TooManyRequestsError } from "../../core/errors.js";
import { uuidSchema, safeString } from "../../lib/validation/schemas.js";
/* The same normaliser the real checkout uses, so a lead recorded as
   `+8801712345678` and the order later placed as `01712345678` are recognised
   as the same person and the lead actually closes. */
import { bdPhoneSchema } from "./order.validation.js";
import { deliveryZoneEnum } from "../../db/schema/order-enums.js";
import { ABANDONED_STATUSES } from "../../db/schema/abandoned-checkouts.js";
import * as service from "./abandoned.service.js";

/**
 * Incomplete checkouts.
 *
 *   POST /api/v1/checkout/incomplete   public, called as the customer types
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

abandonedPublicRouter.post(
  "/incomplete",
  recordRateLimit,
  validate({ body: recordSchema }),
  record,
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
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide a status, a note, or both.",
  });

const idParamSchema = z.object({ id: uuidSchema });

const list: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, z.infer<typeof listQuerySchema>>(req);
  const [checkouts, waiting] = await Promise.all([service.list(query), service.openCount()]);
  sendSuccess(res, { checkouts, openCount: waiting });
};

const update: RequestHandler = async (req, res) => {
  const { body, params } = validated<z.infer<typeof updateSchema>, unknown, { id: string }>(req);
  sendSuccess(res, {
    checkout: await service.update(params.id, body, req.auth?.adminId ?? null),
  });
};

const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await service.remove(params.id);
  sendNoContent(res);
};

abandonedAdminRouter.get("/", validate({ query: listQuerySchema }), list);
abandonedAdminRouter.patch("/:id", validate({ params: idParamSchema, body: updateSchema }), update);
abandonedAdminRouter.delete("/:id", validate({ params: idParamSchema }), remove);
