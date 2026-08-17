import { Router, type RequestHandler } from "express";
import { sendSuccess } from "../../core/response.js";
import { UnauthorizedError } from "../../core/errors.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import * as service from "./overview.service.js";

/**
 * The dashboard summary.
 *
 * `manager` and above, because the order desk lives on this screen — the call
 * list and the parcels that stopped moving are their work. The takings are
 * withheld from them inside the service rather than by this guard, so one route
 * can serve both roles without a second endpoint that would drift from it.
 */
export const overviewAdminRouter: Router = Router();

overviewAdminRouter.use(authenticate, requireRole("manager"));

const summary: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  sendSuccess(res, { overview: await service.summary(req.auth.role) });
};

overviewAdminRouter.get("/", summary);
