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

/** Asking for a code. Nothing but the address — see the controller on why the
 *  answer is the same whether or not it exists. */
export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Spending the code.
 *
 * The code is six digits and is checked for exactly that here, so a malformed
 * value is a 422 that never reaches an Argon2 verification — one fewer way to
 * spend the server's CPU from outside. It stays a string: leading zeros are
 * significant, and `000123` parsed as a number is `123`.
 */
export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code."),
    newPassword: passwordSchema,
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
