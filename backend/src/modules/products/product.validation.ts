import { z } from "zod";
import {
  PRODUCT_SORT_OPTIONS,
  productStatusEnum,
  stockStatusEnum,
} from "../../db/schema/catalog-enums.js";
import { paginationSchema, safeString, uuidSchema } from "../../lib/validation/schemas.js";

/**
 * Product request contracts.
 *
 * Money is validated as a non-negative integer everywhere — the database
 * stores whole taka and accepting `1299.99` here would silently truncate.
 */

const priceField = z
  .number()
  .int("Price must be a whole number of taka.")
  .min(0, "Price cannot be negative.")
  .max(100_000_000, "Price is unrealistically high.");

const slugField = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may contain lowercase letters, numbers and single hyphens only.",
  );

/** SKUs are printed on boxes and typed by hand — keep the alphabet tight. */
const skuField = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
    "SKU may contain letters, numbers, dots, slashes, underscores and hyphens.",
  );

const tagField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Tags may contain lowercase letters, numbers and hyphens.");

const specSchema = z
  .object({
    label: safeString({ min: 1, max: 80 }),
    value: safeString({ min: 1, max: 400 }),
  })
  .strict();

const optionDefinitionSchema = z
  .object({
    name: safeString({ min: 1, max: 40 }),
    values: z
      .array(safeString({ min: 1, max: 60 }))
      .min(1, "An option needs at least one value.")
      .max(30)
      .refine(
        (values) => new Set(values.map((v) => v.toLowerCase())).size === values.length,
        "Option values must be unique.",
      ),
  })
  .strict();

const variantInputSchema = z
  .object({
    sku: skuField,
    /* Keys are validated against the parent's declared axes in the service —
       a schema cannot see sibling fields at this depth. */
    options: z.record(z.string().min(1).max(40), z.string().min(1).max(60)),
    price: priceField,
    oldPrice: priceField.nullish(),
    stockQuantity: z.number().int().min(0).max(1_000_000).default(0),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .strict()
  .refine(
    (variant) => variant.oldPrice == null || variant.oldPrice > variant.price,
    {
      message: "Old price must be greater than the current price.",
      path: ["oldPrice"],
    },
  );

/* -------------------------------------------------------------------------- */
/* Create / update                                                            */
/* -------------------------------------------------------------------------- */

export const createProductSchema = z
  .object({
    name: safeString({ min: 2, max: 200 }),
    /** Derived from `name` when omitted. */
    slug: slugField.optional(),
    sku: skuField,
    brand: safeString({ min: 1, max: 80 }),
    categoryId: uuidSchema,

    shortDescription: safeString({ max: 300 }).nullish(),
    description: safeString({ max: 20_000 }).nullish(),
    specifications: z.array(specSchema).max(60).default([]),
    whatsIncluded: z.array(safeString({ min: 1, max: 200 })).max(40).default([]),
    warranty: safeString({ max: 120 }).nullish(),

    tags: z
      .array(tagField)
      .max(25)
      .default([])
      .transform((tags) => [...new Set(tags)]),

    price: priceField,
    oldPrice: priceField.nullish(),

    stockQuantity: z.number().int().min(0).max(1_000_000).default(0),
    lowStockThreshold: z.number().int().min(0).max(10_000).default(5),
    /** Only the manual states are settable; in/out of stock is derived. */
    stockStatus: z.enum(["pre_order", "discontinued"]).optional(),

    status: z.enum(productStatusEnum.enumValues).default("draft"),
    isVisible: z.boolean().default(true),

    variantOptions: z.array(optionDefinitionSchema).max(4).default([]),
    variants: z.array(variantInputSchema).max(100).default([]),
  })
  .strict()
  .refine((product) => product.oldPrice == null || product.oldPrice > product.price, {
    message: "Old price must be greater than the current price.",
    path: ["oldPrice"],
  })
  .refine(
    (product) => product.variants.length === 0 || product.variantOptions.length > 0,
    {
      message: "Declare variantOptions before adding variants.",
      path: ["variantOptions"],
    },
  );

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    name: safeString({ min: 2, max: 200 }).optional(),
    slug: slugField.optional(),
    sku: skuField.optional(),
    brand: safeString({ min: 1, max: 80 }).optional(),
    categoryId: uuidSchema.optional(),

    shortDescription: safeString({ max: 300 }).nullish(),
    description: safeString({ max: 20_000 }).nullish(),
    specifications: z.array(specSchema).max(60).optional(),
    whatsIncluded: z.array(safeString({ min: 1, max: 200 })).max(40).optional(),
    warranty: safeString({ max: 120 }).nullish(),

    /* `.transform()` before `.optional()` — the reverse makes `tags` a
       required key whose value may be undefined, which then breaks every
       caller that builds a partial update object. */
    tags: z
      .array(tagField)
      .max(25)
      .transform((tags) => [...new Set(tags)])
      .optional(),

    price: priceField.optional(),
    oldPrice: priceField.nullish(),

    stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
    stockStatus: z.enum(stockStatusEnum.enumValues).optional(),

    status: z.enum(productStatusEnum.enumValues).optional(),
    isVisible: z.boolean().optional(),

    variantOptions: z.array(optionDefinitionSchema).max(4).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productStatusSchema = z
  .object({
    status: z.enum(productStatusEnum.enumValues).optional(),
    isVisible: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.isVisible !== undefined, {
    message: "Provide status, isVisible, or both.",
  });

/* -------------------------------------------------------------------------- */
/* Variants                                                                   */
/* -------------------------------------------------------------------------- */

export const createVariantSchema = variantInputSchema;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = z
  .object({
    sku: skuField.optional(),
    options: z.record(z.string().min(1).max(40), z.string().min(1).max(60)).optional(),
    price: priceField.optional(),
    oldPrice: priceField.nullish(),
    stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

export const reorderImagesSchema = z
  .object({
    order: z
      .array(z.object({ id: uuidSchema, sortOrder: z.number().int().min(0).max(999) }).strict())
      .min(1)
      .max(50)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
        "Each image may appear only once.",
      ),
  })
  .strict();

export type ReorderImagesInput = z.infer<typeof reorderImagesSchema>;

export const imageAltSchema = z
  .object({ alt: safeString({ max: 200 }).nullish() })
  .strict();

/* -------------------------------------------------------------------------- */
/* Listing, filtering, sorting                                                */
/* -------------------------------------------------------------------------- */

/**
 * Query strings arrive as text.
 *
 * Both `?brand=apple,samsung` and `?brand=apple&brand=samsung` are accepted —
 * clients disagree about which is idiomatic, and rejecting one of them
 * produces a confusing empty result rather than an error. Capped at 30 values
 * so a crafted query cannot build an unbounded `IN` list.
 */
const csvArray = (normalize: (value: string) => string = (value) => value) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const parts = Array.isArray(value) ? value : value.split(",");
      const cleaned = parts
        .map((part) => normalize(part.trim()))
        .filter((part) => part.length > 0 && part.length <= 80)
        .slice(0, 30);
      return cleaned.length > 0 ? cleaned : undefined;
    });

export const listProductsQuerySchema = paginationSchema
  .extend({
    q: z.string().trim().min(1).max(120).optional(),
    categoryId: uuidSchema.optional(),
    category: slugField.optional(),
    brand: csvArray(),
    tags: csvArray((value) => value.toLowerCase()),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    stockStatus: z.enum(stockStatusEnum.enumValues).optional(),
    inStock: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => value === true || value === "true"),
    onSale: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => value === true || value === "true"),
    sort: z.enum(PRODUCT_SORT_OPTIONS).default("newest"),
  })
  .strict()
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    { message: "minPrice cannot be greater than maxPrice.", path: ["minPrice"] },
  );

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/** Admin listing additionally exposes drafts and archived products. */
export const adminListProductsQuerySchema = listProductsQuerySchema.safeExtend({
  status: z.enum(productStatusEnum.enumValues).optional(),
});

export type AdminListProductsQuery = z.infer<typeof adminListProductsQuerySchema>;

export const searchQuerySchema = paginationSchema
  .extend({
    q: z.string().trim().min(1, "Enter a search term.").max(120),
    sort: z.enum(PRODUCT_SORT_OPTIONS).default("newest"),
  })
  .strict();

export const homepageQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(12) })
  .strict();

export const facetsQuerySchema = z
  .object({ categoryId: uuidSchema.optional() })
  .strict();

/* -------------------------------------------------------------------------- */
/* Params                                                                     */
/* -------------------------------------------------------------------------- */

export const productIdParamSchema = z.object({ id: uuidSchema });

export const productIdentifierParamSchema = z.object({
  identifier: z.string().trim().min(1).max(160),
});

export const productImageParamSchema = z.object({
  id: uuidSchema,
  imageId: uuidSchema,
});

export const productVariantParamSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
});

export const deleteProductQuerySchema = z
  .object({
    /** Hard delete. Restricted to super_admin at the route. */
    permanent: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((value) => value === true || value === "true"),
  })
  .strict();
