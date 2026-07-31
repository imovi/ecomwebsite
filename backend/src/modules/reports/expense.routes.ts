import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendSuccess } from "../../core/response.js";
import { safeString, uuidSchema } from "../../lib/validation/schemas.js";
import { EXPENSE_CATEGORIES, EXPENSE_PERIODS } from "../../db/schema/expenses.js";
import * as service from "./expense.service.js";

/**
 * Expense ledger — /api/v1/admin/expenses.
 *
 * `admin` and above, matching settings and the profit reports. What the shop
 * spends is not something the order desk needs, and a staff account that could
 * edit expenses could quietly change what the owner believes they earned.
 */

export const expensesAdminRouter: Router = Router();

expensesAdminRouter.use(authenticate, requireRole("admin"));

/**
 * `YYYY-MM-DD` and nothing else.
 *
 * Rejecting anything looser is deliberate: these dates are compared as strings
 * in SQL and in the range arithmetic, which is correct and fast for ISO dates
 * and silently wrong for any other format.
 */
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD form.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That is not a real date.");

const amountField = z
  .number()
  .int("Amount must be a whole number of taka.")
  .min(1, "An expense of zero is not an expense — delete the entry instead.")
  .max(100_000_000);

const categoryField = z.enum(EXPENSE_CATEGORIES);
const periodField = z.enum(EXPENSE_PERIODS);

const listQuerySchema = z
  .object({
    from: dateField.optional(),
    to: dateField.optional(),
    category: categoryField.optional(),
  })
  .strict();

const createSchema = z
  .object({
    category: categoryField,
    amount: amountField,
    incurredOn: dateField,
    period: periodField.default("day"),
    note: safeString({ max: 300 }).optional(),
  })
  .strict();

const updateSchema = z
  .object({
    category: categoryField.optional(),
    amount: amountField.optional(),
    incurredOn: dateField.optional(),
    period: periodField.optional(),
    note: safeString({ max: 300 }).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

/** Zero is allowed here, and means "this day had no spend" — see the service. */
const adSpendSchema = z
  .object({
    date: dateField,
    amount: z.number().int().min(0).max(100_000_000),
  })
  .strict();

const idParamSchema = z.object({ id: uuidSchema });

/* -------------------------------------------------------------------------- */

const list: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, z.infer<typeof listQuerySchema>>(req);
  sendSuccess(res, { expenses: await service.list(query) });
};

const create: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof createSchema>>(req);
  sendCreated(res, { expense: await service.create(body, req.auth?.adminId ?? null) });
};

const update: RequestHandler = async (req, res) => {
  const { body, params } = validated<z.infer<typeof updateSchema>, unknown, { id: string }>(req);
  sendSuccess(res, { expense: await service.update(params.id, body) });
};

const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await service.remove(params.id);
  sendNoContent(res);
};

/** One call per day, idempotent, so the dashboard can offer a simple field. */
const setAdSpend: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof adSpendSchema>>(req);
  const expense = await service.setAdSpend(body.date, body.amount, req.auth?.adminId ?? null);
  sendSuccess(res, { expense });
};

expensesAdminRouter.get("/", validate({ query: listQuerySchema }), list);
expensesAdminRouter.post("/", validate({ body: createSchema }), create);
expensesAdminRouter.put("/ad-spend", validate({ body: adSpendSchema }), setAdSpend);
expensesAdminRouter.patch("/:id", validate({ params: idParamSchema, body: updateSchema }), update);
expensesAdminRouter.delete("/:id", validate({ params: idParamSchema }), remove);
