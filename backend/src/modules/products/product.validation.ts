import { z } from "zod";
import {
  PRODUCT_SORT_OPTIONS,
  productStatusEnum,
  stockStatusEnum,
} from "../../db/schema/catalog-enums.js";
import {
  paginationSchema,
  safeString,
  stripControlCharacters,
  uuidSchema,
} from "../../lib/validation/schemas.js";

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

/**
 * What the shop pays. Nullish everywhere: absent leaves it alone, `null` clears
 * it back to "not recorded", which is a meaningfully different state from 0 —
 * zero would claim the stock was free and report a 100% margin.
 */
const costPriceField = z
  .number()
  .int("Buying price must be a whole number of taka.")
  .min(0, "Buying price cannot be negative.")
  .max(100_000_000, "Buying price is unrealistically high.");

/**
 * What THIS product costs to ship and to box, overriding the shop defaults.
 *
 * Nullish everywhere, and `null` means "go back to the shop figure" — a
 * meaningfully different state from 0, which would claim the item ships free.
 */
const perProductCostField = z
  .number()
  .int("Must be a whole number of taka.")
  .min(0, "Cannot be negative.")
  .max(1_000_000, "That is unrealistically high.");

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

/**
 * Brand — optional, with blank normalised to `null`.
 *
 * The admin form always submits the field, so an untouched box arrives as `""`.
 * Storing that as an empty string would make "no brand" two different values
 * that behave differently: `group by brand` would grow a nameless facet entry,
 * and `lower(brand) = ''` would match rows that a NULL check would not.
 *
 * Length is checked after cleaning, so 80 spaces is "no brand" rather than a
 * value that is too long.
 */
function normalizeBrand(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = stripControlCharacters(value).trim();
  return cleaned === "" ? null : cleaned;
}

const brandInput = z.union([z.string(), z.null()]);

/** On create, absent means "this product has no brand". */
const createBrandField = brandInput
  .optional()
  .transform((value) => normalizeBrand(value ?? null))
  .pipe(z.string().min(1).max(80, "Brand is too long.").nullable());

/**
 * On update, absent means "leave it alone" — the service only writes keys that
 * are present. An explicit `null` or `""` is how the brand gets cleared.
 */
const updateBrandField = brandInput
  .optional()
  .transform((value) => (value === undefined ? undefined : normalizeBrand(value)))
  .pipe(z.string().min(1).max(80, "Brand is too long.").nullish());

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
    /**
     * How the shopper picks on this axis. Omitted means text, which is what
     * every product saved before this existed will send — and they must keep
     * rendering exactly as they do now.
     */
    display: z.enum(["text", "image"]).optional(),
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
    /* Omitted means "same as the product" — usually true for a colour, not for
       a storage tier. */
    costPrice: costPriceField.nullish(),
    stockQuantity: z.number().int().min(0).max(1_000_000).default(0),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    /**
     * Which of the product's own photographs shows this variant.
     *
     * The column has existed since the table was created and nothing has ever
     * been able to set it — it was accepted nowhere in this schema, so the
     * feature was a dead foreign key. This is what makes an image swatch
     * possible: the picture the shopper taps to choose "Green" is this one.
     *
     * Checked in the service against the parent product's images, because a
     * schema cannot see the sibling field it would need to. Pointing a variant
     * at another product's photograph would put the wrong picture on the page
     * and break the moment that image is deleted.
     */
    imageId: uuidSchema.nullish(),
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
    brand: createBrandField,
    categoryId: uuidSchema,

    shortDescription: safeString({ max: 300 }).nullish(),
    description: safeString({ max: 20_000 }).nullish(),
    videoUrl: safeString({ max: 2000 }).nullish(),
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
    costPrice: costPriceField.nullish(),

    /* Per-product shipping and boxing. Omitted uses the shop defaults. */
    courierCostInsideDhaka: perProductCostField.nullish(),
    courierCostOutsideDhaka: perProductCostField.nullish(),
    packagingCost: perProductCostField.nullish(),

    stockQuantity: z.number().int().min(0).max(1_000_000).default(0),
    lowStockThreshold: z.number().int().min(0).max(10_000).default(5),
    /** Only the manual states are settable; in/out of stock is derived. */
    stockStatus: z.enum(["pre_order", "discontinued"]).optional(),

    sortOrder: z.number().int().min(0).max(999_999).default(0),
    status: z.enum(productStatusEnum.enumValues).default("draft"),
    isVisible: z.boolean().default(true),

    /**
     * Whether the storefront offers this product's alternate image states.
     *
     * Defaults off, so a product created tomorrow behaves exactly like every
     * product created before this field existed.
     */
    interactiveEnabled: z.boolean().default(false),

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
    brand: updateBrandField,
    categoryId: uuidSchema.optional(),

    shortDescription: safeString({ max: 300 }).nullish(),
    description: safeString({ max: 20_000 }).nullish(),
    videoUrl: safeString({ max: 2000 }).nullish(),
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
    costPrice: costPriceField.nullish(),

    courierCostInsideDhaka: perProductCostField.nullish(),
    courierCostOutsideDhaka: perProductCostField.nullish(),
    packagingCost: perProductCostField.nullish(),

    stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
    stockStatus: z.enum(stockStatusEnum.enumValues).optional(),

    sortOrder: z.number().int().min(0).max(999_999).optional(),
    status: z.enum(productStatusEnum.enumValues).optional(),
    isVisible: z.boolean().optional(),

    /* Independent of whether any state image exists: the shop can upload the
       unlit photos, check them, and switch this on afterwards — or switch it
       off later without losing the uploads. */
    interactiveEnabled: z.boolean().optional(),

    variantOptions: z.array(optionDefinitionSchema).max(4).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const reorderProductsSchema = z
  .object({
    order: z
      .array(
        z.object({
          id: uuidSchema,
          sortOrder: z.number().int().min(0).max(999_999),
        }),
      )
      .min(1, "Send at least one product to reorder.")
      .max(500, "Cannot reorder more than 500 products at once.")
      .refine(
        (items) => {
          const ids = items.map((i) => i.id);
          return new Set(ids).size === ids.length;
        },
        { message: "Duplicate product ids are not allowed in reorder." },
      ),
  })
  .strict();

export type ReorderProductsInput = z.infer<typeof reorderProductsSchema>;

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
    costPrice: costPriceField.nullish(),
    stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    /**
     * The picture that shows this variant — see `variantInputSchema`.
     *
     * `nullish`, so `null` explicitly clears the swatch while omitting the key
     * leaves it alone. On a partial update those are genuinely different
     * intentions, and collapsing them would make a swatch impossible to remove.
     */
    imageId: uuidSchema.nullish(),
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

export const updateProductImageSchema = z
  .object({
    alt: z.string().trim().max(255).nullish(),
  })
  .strict();

export type UpdateProductImageInput = z.infer<typeof updateProductImageSchema>;

/**
 * A state key is a name, not free text.
 *
 * Lowercase letters, digits and dashes only, because it travels in a URL path
 * and is compared exactly. `off` today; `warm`, `night`, `folded` later.
 */
const stateKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes.");

export const productImageStateParamSchema = z.object({
  id: uuidSchema,
  imageId: uuidSchema,
  stateKey: stateKeySchema,
});

export const uploadImageStateSchema = z
  .object({
    stateKey: stateKeySchema,
    /** What the shopper is offered. Falls back to the key when absent. */
    label: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export type UploadImageStateInput = z.infer<typeof uploadImageStateSchema>;

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
