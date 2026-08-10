import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate, validated } from "../../middleware/validate.js";
import { sendNoContent, sendSuccess } from "../../core/response.js";
import { UnauthorizedError } from "../../core/errors.js";
import { uuidSchema } from "../../lib/validation/schemas.js";
import { blockIp, listBlockedIps, unblockIp } from "./blocked-ip.service.js";

/**
 * The block list — mounted at /api/v1/admin/ips.
 *
 * `admin`, not `manager`. Reading an order's origin is part of vetting it on
 * the confirmation call and sits at `manager` with the rest of the order desk;
 * refusing an address is a decision that can cost the shop revenue, and it
 * belongs with whoever owns that.
 */
export const blockedIpAdminRouter: Router = Router();

blockedIpAdminRouter.use(authenticate, requireRole("admin"));

const blockSchema = z
  .object({
    ip: z.string().trim().min(3).max(64),
    reason: z.string().trim().max(300).default(""),
    /**
     * Days until it lifts itself. Null is permanent, and is meant to be chosen
     * rather than fallen into — the panel offers 7 by default.
     *
     * This is the single most important control in the feature. One address
     * here can be a whole carrier's worth of real customers, and a block that
     * expires is a mistake that heals while nobody is looking at it.
     */
    expiresInDays: z.number().int().min(1).max(3650).nullable().default(7),
  })
  .strict();

type BlockInput = z.infer<typeof blockSchema>;

const list: RequestHandler = async (_req, res) => {
  sendSuccess(res, { blocks: await listBlockedIps() });
};

const create: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const { body } = validated<BlockInput>(req);

  const expiresAt =
    body.expiresInDays === null
      ? null
      : new Date(Date.now() + body.expiresInDays * 86_400_000);

  const block = await blockIp({
    ip: body.ip,
    reason: body.reason,
    expiresAt,
    adminId: req.auth.adminId,
  });

  sendSuccess(res, { block }, { status: 201 });
};

const remove: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const { params } = validated<unknown, unknown, { id: string }>(req);

  await unblockIp(params.id, req.auth.adminId);
  sendNoContent(res);
};

blockedIpAdminRouter.get("/", list);
blockedIpAdminRouter.post("/", validate({ body: blockSchema }), create);
blockedIpAdminRouter.delete("/:id", validate({ params: z.object({ id: uuidSchema }) }), remove);
