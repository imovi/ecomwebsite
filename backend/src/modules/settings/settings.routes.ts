import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendSuccess } from "../../core/response.js";
import { safeString } from "../../lib/validation/schemas.js";
import * as service from "./settings.service.js";

/**
 * Store settings.
 *
 * Reading is restricted to authenticated staff: delivery pricing is public
 * information in effect, but the store's internal contact details and order
 * thresholds are not, and the storefront gets its delivery charges from the
 * checkout quote endpoint rather than from here.
 *
 * Writing requires `admin` — a manager can run the catalogue and the order
 * queue, but changing what the store charges for delivery is a commercial
 * decision.
 */

const money = z.number().int().min(0).max(100_000);

const updateSettingsSchema = z
  .object({
    delivery: z
      .object({
        insideDhaka: money.optional(),
        outsideDhaka: money.optional(),
        /** 0 disables free delivery entirely. */
        freeDeliveryThreshold: money.optional(),
      })
      .strict()
      .optional(),
    ordering: z
      .object({
        minimumOrderValue: money.optional(),
        maxQuantityPerItem: z.number().int().min(1).max(1000).optional(),
      })
      .strict()
      .optional(),
    store: z
      .object({
        name: safeString({ min: 1, max: 120 }).optional(),
        phone: safeString({ max: 40 }).optional(),
        email: z.union([z.literal(""), z.email()]).optional(),
        address: safeString({ max: 400 }).optional(),
        invoiceFooter: safeString({ max: 400 }).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one settings group to update.",
  });

type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;

const read: RequestHandler = async (_req, res) => {
  sendSuccess(res, { settings: await service.getSettingsDto() });
};

const update: RequestHandler = async (req, res) => {
  const { body } = validated<UpdateSettingsBody>(req);
  sendSuccess(res, { settings: await service.updateSettings(body) });
};

export const settingsAdminRouter: Router = Router();

settingsAdminRouter.use(authenticate);

settingsAdminRouter.get("/", requireRole("manager"), read);
settingsAdminRouter.patch(
  "/",
  requireRole("admin"),
  validate({ body: updateSettingsSchema }),
  update,
);
