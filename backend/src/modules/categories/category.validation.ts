import { z } from "zod";
import { safeString, uuidSchema } from "../../lib/validation/schemas.js";

/**
 * Category request contracts.
 *
 * `.strict()` everywhere: unknown keys are rejected rather than ignored, so a
 * client typo (`sortIndex` instead of `sortOrder`) fails loudly instead of
 * silently doing nothing.
 */

const slugField = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may contain lowercase letters, numbers and single hyphens only.",
  );

/** Icon is a key into the storefront's own icon set, not arbitrary markup. */
const iconField = z
  .string()
  .trim()
  .max(50)
  .regex(/^[a-z0-9-]+$/, "Icon may contain lowercase letters, numbers and hyphens only.");

export const createCategorySchema = z
  .object({
    name: safeString({ min: 2, max: 100 }),
    /** Derived from `name` when omitted. */
    slug: slugField.optional(),
    description: safeString({ max: 1000 }).nullish(),
    icon: iconField.nullish(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** All fields optional, but at least one required — an empty PATCH is a bug. */
export const updateCategorySchema = z
  .object({
    name: safeString({ min: 2, max: 100 }).optional(),
    slug: slugField.optional(),
    description: safeString({ max: 1000 }).nullish(),
    icon: iconField.nullish(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const categoryStatusSchema = z.object({ isActive: z.boolean() }).strict();

export const reorderCategoriesSchema = z
  .object({
    order: z
      .array(
        z
          .object({
            id: uuidSchema,
            sortOrder: z.number().int().min(0).max(9999),
          })
          .strict(),
      )
      .min(1, "Provide at least one category.")
      .max(200)
      /* A duplicated id means the client built the payload wrong; applying it
         would produce an order that depends on statement evaluation order. */
      .refine(
        (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
        "Each category may appear only once.",
      ),
  })
  .strict();

export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;

/** Public listing options. */
export const listCategoriesQuerySchema = z
  .object({
    /** Admin-only; ignored on the public route. */
    includeInactive: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => value === true || value === "true"),
  })
  .strict();

/** Categories are addressable by uuid or slug — both are stable identifiers. */
export const categoryIdentifierSchema = z.object({
  identifier: z.string().trim().min(1).max(120),
});

export const categoryIdParamSchema = z.object({ id: uuidSchema });
