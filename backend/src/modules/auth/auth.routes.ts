import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { authRateLimit } from "../../middleware/rate-limit.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./auth.controller.js";
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
} from "./auth.validation.js";

/**
 * Admin authentication routes — mounted at /api/v1/auth.
 *
 * Middleware order per route is load-bearing:
 *   rate limit → validate → authenticate → handler
 *
 * Rate limiting runs first so a flood is rejected before it costs a schema
 * parse or an Argon2 verification. Validation runs before authentication so
 * malformed input fails fast with a 422 rather than a confusing 401.
 */
export const authRouter: Router = Router();

/** Public. Tightly rate limited — this is the credential-stuffing target. */
authRouter.post(
  "/login",
  authRateLimit,
  validate({ body: loginSchema }),
  controller.login,
);

/**
 * Public. The expired access token cannot authenticate its own replacement,
 * so the refresh cookie is the credential here. Rate limited because a stolen
 * cookie plus unlimited retries is a brute-force surface.
 */
authRouter.post(
  "/refresh",
  authRateLimit,
  validate({ body: refreshSchema }),
  controller.refresh,
);

/** Authenticated: `allDevices` must not be usable by a cookie alone. */
authRouter.post(
  "/logout",
  authenticate,
  validate({ body: logoutSchema }),
  controller.logout,
);

/** Authenticated. Returns the live account, not the token's stale claims. */
authRouter.get("/me", authenticate, controller.me);

/**
 * Authenticated: any role. Rate limited like `/login` — it verifies a
 * password too, and a valid session should not be a way to brute-force the
 * current one.
 */
authRouter.post(
  "/change-password",
  authRateLimit,
  authenticate,
  validate({ body: changePasswordSchema }),
  controller.changePassword,
);
