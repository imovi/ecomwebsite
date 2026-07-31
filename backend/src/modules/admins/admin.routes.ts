import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendSuccess } from "../../core/response.js";
import { UnauthorizedError } from "../../core/errors.js";
import { ADMIN_ROLES } from "../../db/schema/enums.js";
import { emailSchema, safeString, uuidSchema } from "../../lib/validation/schemas.js";
import * as service from "./admin.service.js";

/**
 * Team management — mounted at /api/v1/admin/team.
 *
 * `super_admin` only. Every route here can grant or remove access to the whole
 * shop, so it is gated at the highest role rather than at `admin`; an `admin`
 * who could edit accounts would be a `super_admin` in all but name.
 *
 * The service enforces the rules that actually matter — no self-demotion, no
 * removing the last owner, no granting a role above your own — because they must
 * hold regardless of which route reaches them.
 */

export const teamAdminRouter: Router = Router();

teamAdminRouter.use(authenticate, requireRole("super_admin"));

/** Narrows `req.auth` for handlers that need to know who is acting. */
function actorOf(req: { auth?: { adminId: string; role: string } | undefined }) {
  if (!req.auth) throw new UnauthorizedError("Authentication required.");
  return { id: req.auth.adminId, role: req.auth.role as (typeof ADMIN_ROLES)[number] };
}

const roleField = z.enum(ADMIN_ROLES);

/**
 * A supplied password is optional throughout.
 *
 * When omitted the service generates a strong one and returns it once — which is
 * the better default, since there is no invitation email and a human-chosen
 * password for a colleague is usually a weak one typed into a chat window.
 */
const passwordField = z.string().min(12, "Use at least 12 characters.").max(200);

const createSchema = z
  .object({
    email: emailSchema,
    name: safeString({ min: 2, max: 120 }),
    role: roleField,
    password: passwordField.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: safeString({ min: 2, max: 120 }).optional(),
    role: roleField.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

const resetPasswordSchema = z
  .object({ password: passwordField.optional() })
  .strict();

const idParamSchema = z.object({ id: uuidSchema });

/* -------------------------------------------------------------------------- */

const list: RequestHandler = async (_req, res) => {
  sendSuccess(res, { team: await service.list() });
};

const create: RequestHandler = async (req, res) => {
  const { body } = validated<z.infer<typeof createSchema>>(req);
  const result = await service.create(body, actorOf(req));

  /* The password travels in the create response and nowhere else. */
  sendCreated(res, result);
};

const update: RequestHandler = async (req, res) => {
  const { body, params } = validated<z.infer<typeof updateSchema>, unknown, { id: string }>(req);
  sendSuccess(res, { admin: await service.update(params.id, body, actorOf(req)) });
};

const resetPassword: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    z.infer<typeof resetPasswordSchema>,
    unknown,
    { id: string }
  >(req);

  sendSuccess(res, await service.resetPassword(params.id, actorOf(req), body.password));
};

const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await service.remove(params.id, actorOf(req));
  sendNoContent(res);
};

teamAdminRouter.get("/", list);
teamAdminRouter.post("/", validate({ body: createSchema }), create);
teamAdminRouter.patch("/:id", validate({ params: idParamSchema, body: updateSchema }), update);
teamAdminRouter.post(
  "/:id/password",
  validate({ params: idParamSchema, body: resetPasswordSchema }),
  resetPassword,
);
teamAdminRouter.delete("/:id", validate({ params: idParamSchema }), remove);
