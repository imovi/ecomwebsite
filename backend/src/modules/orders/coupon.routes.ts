import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendSuccess } from "../../core/response.js";
import { safeString, uuidSchema } from "../../lib/validation/schemas.js";
import * as coupons from "./recovery-coupon.service.js";

/**
 * Coupons as objects, rather than as something a lead has.
 *
 *   GET    /api/v1/admin/coupons        the ledger, with the counts above it
 *   POST   /api/v1/admin/coupons        mint one for nobody in particular
 *   DELETE /api/v1/admin/coupons/:id    withdraw one that has not been spent
 *
 * The lead-shaped routes still live on `abandoned.routes.ts` — issuing an offer
 * to a customer the shop is already chasing belongs on that lead, and the panel
 * does it from the card. These exist for the case that had nowhere to go: the
 * desk is on the phone to somebody who was never in the call list at all.
 */

export const couponsAdminRouter: Router = Router();

/**
 * `manager` and above, like the rest of the order desk's work.
 *
 * Not `admin`: whoever is making the confirmation calls is the person who needs
 * to hand out a free delivery mid-conversation, and a rule that sends them to
 * find the owner first is a rule that gets worked around.
 */
couponsAdminRouter.use(authenticate, requireRole("manager"));

const listQuerySchema = z
  .object({
    state: z.enum(["active", "used", "expired", "cancelled"]).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

const createSchema = z
  .object({
    /* Who it is for, in the operator's own words. Optional, because a code
       being minted while somebody is waiting on the phone should not stop for
       a required field — but the list is unreadable without it, so the panel
       asks. */
    note: safeString({ max: 120 }).optional(),

    /**
     * A code chosen by hand. Blank means "generate one".
     *
     * Letters, digits and dashes. NOT the restricted alphabet the generator
     * uses: that exists so a customer hearing a code read down a phone does not
     * have to ask "oh or zero", and somebody typing EID2026 themselves has
     * already made that call.
     */
    code: z
      .string()
      .trim()
      .min(3, "A code needs at least three characters.")
      .max(24)
      .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only.")
      .transform((value) => value.toUpperCase())
      .optional(),

    /* Up to a year. Past that it is not an offer any more, it is the shop's
       delivery price, and that belongs in the delivery settings. */
    validHours: z.coerce.number().int().min(1).max(8760).optional(),

    /**
     * How many times it may be spent. `null` is unlimited, and is deliberately
     * spelled rather than encoded as 0 — a shop that typed 0 by accident must
     * not get an unlimited coupon out of it.
     */
    maxUses: z.union([z.coerce.number().int().min(1).max(10000), z.null()]).optional(),

    /** Discount type: free_delivery, fixed (taka), or percentage (%). Defaults to free_delivery. */
    discountType: z.enum(["free_delivery", "fixed", "percentage"]).default("free_delivery"),
    discountValue: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const idParamSchema = z.object({ id: uuidSchema });

const list: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, z.infer<typeof listQuerySchema>>(req);

  /* Both in one response: the page draws the counts above the table, and two
     round trips to fill one screen is how a panel starts feeling slow. */
  const [rows, totals] = await Promise.all([
    coupons.listCoupons(query),
    coupons.totals(),
  ]);

  sendSuccess(res, { coupons: rows, totals });
};

const create: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof createSchema>>(req);

  const result = await coupons.generate({
    /* No lead. Every lead guard is skipped, including the minimum-basket
       setting — there is no basket to measure it against, and the operator is
       deciding by hand. */
    checkoutId: null,
    ...(body.note ? { note: body.note } : {}),
    ...(body.code ? { code: body.code } : {}),
    ...(body.validHours ? { validHours: body.validHours } : {}),
    ...(body.maxUses !== undefined ? { maxUses: body.maxUses } : {}),
    discountType: body.discountType,
    discountValue: body.discountValue,
    actor: { adminId: req.auth?.adminId ?? null, name: req.auth?.email ?? "Admin" },
  });

  sendSuccess(res, result);
};

const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);

  sendSuccess(res, {
    coupon: await coupons.cancel(params.id, {
      adminId: req.auth?.adminId ?? null,
      name: req.auth?.email ?? "Admin",
    }),
  });
};

couponsAdminRouter.get("/", validate({ query: listQuerySchema }), list);
couponsAdminRouter.post("/", validate({ body: createSchema }), create);
couponsAdminRouter.delete("/:id", validate({ params: idParamSchema }), remove);
