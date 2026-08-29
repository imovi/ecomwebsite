import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendCreated, sendSuccess } from "../../core/response.js";
import { BadRequestError } from "../../core/errors.js";
import { safeString, uuidSchema } from "../../lib/validation/schemas.js";
import { resolveRange } from "../reports/profit.service.js";
import * as service from "./ads.service.js";
import { MetaAdsError } from "./meta-ads.client.js";

/**
 * Campaigns and their numbers — /api/v1/admin/ads.
 *
 * `admin` and above, the same bar as the profit report: this screen shows what
 * the shop spends and earns, and the order desk has no need of either.
 */

export const adsAdminRouter: Router = Router();

adsAdminRouter.use(authenticate, requireRole("admin"));

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That is not a real date.");

const rangeQuerySchema = z
  .object({
    preset: z.enum(["today", "yesterday", "last7", "last30", "month", "lifetime"]).optional(),
    from: dateField.optional(),
    to: dateField.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "The start date must not be after the end date.",
    path: ["from"],
  });

type RangeQuery = z.infer<typeof rangeQuerySchema>;

/**
 * A campaign id, however it was copied.
 *
 * Ads Manager offers the id as digits, but people paste the whole URL or the
 * id with a stray space at least as often. Everything that is not a digit is
 * stripped here, so the shop is not made to clean it up by hand.
 */
const campaignIdSchema = z
  .string()
  .min(1)
  .max(200)
  .transform((value) => value.replace(/\D+/g, ""))
  .refine((value) => value.length >= 5 && value.length <= 32, {
    message: "Copy the numeric Campaign ID from Ads Manager.",
  });

const createSchema = z
  .object({
    metaId: campaignIdSchema,
    label: safeString({ max: 120 }).optional(),
    productId: uuidSchema.nullish(),
  })
  .strict();

const patchSchema = z
  .object({
    label: safeString({ max: 120 }).optional(),
    productId: uuidSchema.nullish(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.");

/* -------------------------------------------------------------------------- */

/**
 * Meta's failures reach the panel as themselves.
 *
 * An expired token, a rate limit and a wrong id need three different things
 * done about them, and a generic 500 tells the shop none of it. The status
 * codes are chosen so the panel's own error handling shows the message.
 */
function rethrow(error: unknown): never {
  if (error instanceof MetaAdsError) {
    throw new BadRequestError(error.message);
  }
  throw error;
}

const list: RequestHandler = async (_req, res) => {
  sendSuccess(res, { campaigns: await service.listCampaigns() });
};

const create: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof createSchema>>(req);
  sendCreated(res, {
    campaign: await service.addCampaign({
      metaId: body.metaId,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.productId !== undefined ? { productId: body.productId } : {}),
    }),
  });
};

const patch: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    z.infer<typeof patchSchema>,
    unknown,
    { id: string }
  >(req);
  sendSuccess(res, { campaign: await service.updateCampaign(params.id, body) });
};

const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await service.removeCampaign(params.id);
  sendSuccess(res, { deleted: true });
};

/** Every registered campaign, with Meta's spend beside the shop's deliveries. */
const overview: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, RangeQuery>(req);
  const range = resolveRange(query.preset, query);
  sendSuccess(res, { overview: await service.adsOverview(range) });
};

/** One campaign, for the screen reached by clicking its row. */
const report: RequestHandler = async (req, res) => {
  const { query, params } = validated<unknown, RangeQuery, { id: string }>(req);
  const range = resolveRange(query.preset, query);
  sendSuccess(res, { report: await service.campaignReport(params.id, range) });
};

/** Proves the token and account work, and says what account it reached. */
const test: RequestHandler = async (_req, res) => {
  try {
    sendSuccess(res, { account: await service.testAdsConnection() });
  } catch (error) {
    rethrow(error);
  }
};

/* -------------------------------------------------------------------------- */

adsAdminRouter.get("/campaigns", list);
adsAdminRouter.post("/campaigns", validate({ body: createSchema }), create);
adsAdminRouter.patch(
  "/campaigns/:id",
  validate({ params: z.object({ id: uuidSchema }), body: patchSchema }),
  patch,
);
adsAdminRouter.delete(
  "/campaigns/:id",
  validate({ params: z.object({ id: uuidSchema }) }),
  remove,
);

adsAdminRouter.get("/overview", validate({ query: rangeQuerySchema }), overview);
adsAdminRouter.get(
  "/campaigns/:id/report",
  validate({ params: z.object({ id: uuidSchema }), query: rangeQuerySchema }),
  report,
);
adsAdminRouter.post("/test", test);
