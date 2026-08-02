import { z } from "zod";
import { emailSchema, loginPasswordSchema, passwordSchema } from "../../lib/validation/schemas.js";

/**
 * Auth request contracts.
 *
 * `.strict()` on the login body rejects unknown keys outright rather than
 * silently ignoring them — it catches client typos (`{ emailAddress: … }`)
 * immediately instead of producing a confusing "email is required".
 */

export const loginSchema = z
  .object({
    email: emailSchema,
    password: loginPasswordSchema,
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Refresh accepts the token from the httpOnly cookie by default. The optional
 * body field exists for non-browser clients (a native admin app, integration
 * tests) that cannot use cookies.
 */
export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1).max(512).optional(),
  })
  .strict();

export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(1).max(512).optional(),
    /** When true, ends every session for this admin, not just this one. */
    allDevices: z.boolean().default(false),
  })
  .strict();

export type LogoutInput = z.infer<typeof logoutSchema>;

/**
 * Self-service password change.
 *
 * `currentPassword` uses the presence-only login schema rather than the full
 * policy — a legacy password that predates a policy tightening must still be
 * accepted for verification. `newPassword` uses the full policy, same as
 * creating or resetting an account.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: loginPasswordSchema,
    newPassword: passwordSchema,
  })
  .strict();

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
