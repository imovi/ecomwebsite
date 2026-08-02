import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendSuccess } from "../../core/response.js";
import { safeString, uuidSchema } from "../../lib/validation/schemas.js";
import * as service from "./profit.service.js";
import * as adSpend from "./product-ad-spend.service.js";

/**
 * Profit and loss — /api/v1/admin/reports.
 *
 * `admin` and above. Margins, buying prices and ad spend are the shop's most
 * sensitive commercial numbers; the order desk has no need of them, and a staff
 * account that could read them could price a competing shop.
 */

export const reportsAdminRouter: Router = Router();

reportsAdminRouter.use(authenticate, requireRole("admin"));

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

const profit: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, RangeQuery>(req);
  const range = service.resolveRange(query.preset, query);

  sendSuccess(res, { report: await service.profitReport(range, { preset: query.preset }) });
};

/**
 * The same report as a download.
 *
 * Not JSON: this endpoint exists so the numbers can be opened in a spreadsheet,
 * and a browser given `text/csv` with a filename does the right thing without
 * any client-side blob handling.
 */
const profitCsv: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, RangeQuery>(req);
  const range = service.resolveRange(query.preset, query);
  const report = await service.profitReport(range, { preset: query.preset });

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    `attachment; filename="gng-profit-${range.from}-to-${range.to}.csv"`,
  );
  res.send(service.toCsv(report));
};

/* -------------------------------------------------------------------------- */
/* Per-product boosts                                                         */
/* -------------------------------------------------------------------------- */

const boostRangeSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    productId: uuidSchema.optional(),
  })
  .strict()
  .refine((query) => query.from <= query.to, {
    message: "from must not be after to.",
    path: ["from"],
  });

const boostBodySchema = z
  .object({
    productId: uuidSchema,
    /* A calendar day, matching how the budget was actually set. */
    spentOn: z.iso.date(),
    amount: z.number().int().min(0).max(100_000_000),
    note: safeString({ max: 200 }).optional(),
  })
  .strict();

const listBoosts: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, z.infer<typeof boostRangeSchema>>(req);

  sendSuccess(res, {
    boosts: await adSpend.listForRange(
      { from: query.from, to: query.to },
      query.productId,
    ),
  });
};

const recordBoost: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof boostBodySchema>>(req);

  sendSuccess(res, {
    boost: await adSpend.record({
      productId: body.productId,
      spentOn: body.spentOn,
      amount: body.amount,
      ...(body.note !== undefined ? { note: body.note } : {}),
    }),
  });
};

const deleteBoost: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await adSpend.remove(params.id);
  sendSuccess(res, { deleted: true });
};

reportsAdminRouter.get("/profit", validate({ query: rangeQuerySchema }), profit);
reportsAdminRouter.get("/profit.csv", validate({ query: rangeQuerySchema }), profitCsv);

reportsAdminRouter.get("/boosts", validate({ query: boostRangeSchema }), listBoosts);
reportsAdminRouter.put("/boosts", validate({ body: boostBodySchema }), recordBoost);
reportsAdminRouter.delete(
  "/boosts/:id",
  validate({ params: z.object({ id: uuidSchema }) }),
  deleteBoost,
);
