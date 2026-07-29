import { z } from "zod";

/**
 * Shared validation building blocks.
 *
 * Feature modules compose these rather than redefining "what is a valid
 * email" in six places. Anything reused across two modules belongs here.
 */

/* -------------------------------------------------------------------------- */
/* Sanitisers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Strips C0/C1 control characters and zero-width code points.
 *
 * These are invisible in any UI but survive JSON encoding, and are the usual
 * carrier for terminal-escape injection and for homograph-style spoofing of
 * names. Tab and newline are preserved — multi-line addresses are legitimate
 * input, and structured JSON logging escapes them safely.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u200B-\\u200D\\uFEFF]", "g");

export function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

/**
 * A trimmed, control-character-free string.
 *
 * The default for any free-text field. Note this does NOT escape HTML: this
 * API stores text and returns JSON, and escaping on the way in double-encodes
 * data for every non-HTML consumer. Escaping belongs at the point of HTML
 * rendering, which for this system is React — and React escapes by default.
 */
export const safeString = (options: { min?: number; max?: number } = {}) => {
  /* Length is checked AFTER cleaning, so a value made entirely of control
     characters fails a `min` constraint instead of passing as whitespace. */
  let constraint = z.string();
  if (options.min !== undefined) constraint = constraint.min(options.min);
  if (options.max !== undefined) constraint = constraint.max(options.max);

  return z
    .string()
    .transform((value) => stripControlCharacters(value).trim())
    .pipe(constraint);
};

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Email is required.")
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

export const uuidSchema = z.uuid("Must be a valid identifier.");

/**
 * Password policy for new and changed passwords.
 *
 * Length is the dominant factor in resistance to offline cracking, so the
 * floor is 12 rather than the more common 8. Composition rules are kept light
 * on purpose — forcing symbols pushes people towards `Password1!` and reused
 * credentials. The 72-byte ceiling is not an Argon2 limit but keeps a
 * megabyte-long password from being a free CPU-exhaustion vector.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(72, "Password must be at most 72 characters.")
  .refine((value) => /[a-z]/.test(value), "Password must contain a lowercase letter.")
  .refine((value) => /[A-Z]/.test(value), "Password must contain an uppercase letter.")
  .refine((value) => /\d/.test(value), "Password must contain a number.");

/**
 * Password at login.
 *
 * Deliberately only checks presence. Applying the policy here would reject a
 * legacy password before verification and tell an attacker something about the
 * stored value.
 */
export const loginPasswordSchema = z
  .string()
  .min(1, "Password is required.")
  .max(72, "Password is too long.");

/* -------------------------------------------------------------------------- */
/* Query helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Pagination.
 *
 * `perPage` is capped at 100 — an uncapped page size is a trivial way to make
 * the database do unbounded work on a public endpoint.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

export const sortOrderSchema = z.enum(["asc", "desc"]).default("desc");

/** Builds a sort schema constrained to an explicit allow-list of columns.
 *  Passing a client string straight into `order by` is a SQL injection. */
export function sortSchema<const T extends readonly [string, ...string[]]>(
  fields: T,
  defaultField: T[number],
) {
  return z.object({
    sortBy: z.enum(fields).default(defaultField),
    sortOrder: sortOrderSchema,
  });
}

export const idParamSchema = z.object({ id: uuidSchema });
