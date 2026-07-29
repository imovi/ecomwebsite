import { z } from "zod";
import {
  deliveryZoneEnum,
  orderStatusEnum,
  paymentMethodEnum,
} from "../../db/schema/order-enums.js";
import { paginationSchema, safeString, uuidSchema } from "../../lib/validation/schemas.js";

/**
 * Order request contracts.
 *
 * The public checkout schemas are the only unauthenticated write surface in
 * the whole API, so they are the strictest: every field bounded, unknown keys
 * rejected, and no field that could influence pricing accepted from the client.
 * Prices and totals are never taken from the request — they are re-derived
 * from the catalogue and the settings row.
 */

/**
 * Bangladeshi mobile number.
 *
 * Accepts the forms customers actually type — `01712345678`, `+8801712345678`,
 * `8801712345678`, with spaces or dashes — and normalises to `01XXXXXXXXX` so
 * search, deduplication and courier hand-off all see one canonical form.
 */
export const bdPhoneSchema = z
  .string()
  .trim()
  .min(6, "Phone number is required.")
  .max(20)
  .transform((value) => {
    const digits = value.replace(/\D/g, "");
    if (digits.startsWith("880")) return `0${digits.slice(3)}`;
    if (digits.length === 10 && digits.startsWith("1")) return `0${digits}`;
    return digits;
  })
  .refine(
    (value) => /^01[3-9]\d{8}$/.test(value),
    "Enter a valid Bangladeshi mobile number, e.g. 01712345678.",
  );

const quantitySchema = z
  .number()
  .int("Quantity must be a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(1000, "Quantity is unrealistically high.");

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

const cartItemSchema = z
  .object({
    productId: uuidSchema,
    /** Required for products that have variants; validated in the service. */
    variantId: uuidSchema.nullish(),
    quantity: quantitySchema,
  })
  .strict();

/**
 * Quote request — subtotal, delivery charge and grand total before committing.
 *
 * `deliveryZone` is optional here: the endpoint returns the zone it inferred
 * from `areaText` so a storefront can show the charge as the customer types,
 * and lets them override it.
 */
export const quoteSchema = z
  .object({
    items: z.array(cartItemSchema).min(1, "Your cart is empty.").max(50),
    areaText: safeString({ max: 200 }).optional(),
    deliveryZone: z.enum(deliveryZoneEnum.enumValues).optional(),
  })
  .strict();

export type QuoteInput = z.infer<typeof quoteSchema>;

export const placeOrderSchema = z
  .object({
    customerName: safeString({ min: 3, max: 120 }),
    phone: bdPhoneSchema,
    address: safeString({ min: 8, max: 500 }),
    areaText: safeString({ min: 2, max: 200 }),
    /** Omitted means "infer from areaText"; inference failure is a 422. */
    deliveryZone: z.enum(deliveryZoneEnum.enumValues).optional(),
    items: z.array(cartItemSchema).min(1, "Your cart is empty.").max(50),
    /** Free-text from the customer, kept separate from internal notes. */
    customerNote: safeString({ max: 500 }).nullish(),
    /* Deliberately absent: price, subtotal, deliveryCharge, grandTotal.
       Accepting any of them from an unauthenticated request would let a
       client name its own price. `.strict()` rejects them outright. */
  })
  .strict();

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/* -------------------------------------------------------------------------- */
/* Admin edits                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Optimistic concurrency token.
 *
 * Optional so a scripted correction can proceed, but the admin UI should
 * always send the version it read. Two operators editing the same order during
 * a confirmation call is routine.
 */
const expectedVersion = z.number().int().min(1).optional();

export const updateCustomerSchema = z
  .object({
    customerName: safeString({ min: 3, max: 120 }).optional(),
    phone: bdPhoneSchema.optional(),
    address: safeString({ min: 8, max: 500 }).optional(),
    areaText: safeString({ min: 2, max: 200 }).optional(),
    /** Supply explicitly to override the zone inferred from `areaText`. */
    deliveryZone: z.enum(deliveryZoneEnum.enumValues).optional(),
    note: safeString({ max: 300 }).optional(),
    expectedVersion,
  })
  .strict()
  .refine(
    (value) =>
      value.customerName !== undefined ||
      value.phone !== undefined ||
      value.address !== undefined ||
      value.areaText !== undefined ||
      value.deliveryZone !== undefined,
    { message: "Provide at least one customer field to update." },
  );

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const updateItemQuantitySchema = z
  .object({
    quantity: quantitySchema,
    note: safeString({ max: 300 }).optional(),
    expectedVersion,
  })
  .strict();

export type UpdateItemQuantityInput = z.infer<typeof updateItemQuantitySchema>;

export const updateItemVariantSchema = z
  .object({
    variantId: uuidSchema,
    note: safeString({ max: 300 }).optional(),
    expectedVersion,
  })
  .strict();

export type UpdateItemVariantInput = z.infer<typeof updateItemVariantSchema>;

export const updateStatusSchema = z
  .object({
    status: z.enum(orderStatusEnum.enumValues),
    note: safeString({ max: 300 }).optional(),
    expectedVersion,
  })
  .strict();

export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const cancelOrderSchema = z
  .object({
    /* Required, unlike a generic status change: on a cash-on-delivery store
       the cancellation reason is the only signal that separates a customer
       changing their mind from a suspected fake order. */
    reason: safeString({ min: 3, max: 300 }),
    expectedVersion,
  })
  .strict();

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const internalNotesSchema = z
  .object({
    internalNotes: safeString({ max: 2000 }).nullable(),
    /** Context for the audit entry, distinct from the note text itself. */
    note: safeString({ max: 300 }).optional(),
    expectedVersion,
  })
  .strict();

export type InternalNotesInput = z.infer<typeof internalNotesSchema>;

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

/** `a,b` and repeated keys both produce an array. */
const csvEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const parts = Array.isArray(value) ? value : value.split(",");
      const cleaned = parts.map((part) => part.trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : undefined;
    })
    .pipe(z.array(z.enum(values)).max(values.length).optional());

export const listOrdersQuerySchema = paginationSchema
  .extend({
    q: z.string().trim().min(1).max(120).optional(),
    status: csvEnum(orderStatusEnum.enumValues),
    paymentMethod: z.enum(paymentMethodEnum.enumValues).optional(),
    deliveryZone: z.enum(deliveryZoneEnum.enumValues).optional(),
    /** ISO date or datetime. `dateTo` is widened to end-of-day in the service. */
    dateFrom: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
    dateTo: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
    minTotal: z.coerce.number().int().min(0).optional(),
    maxTotal: z.coerce.number().int().min(0).optional(),
    sort: z.enum(["newest", "oldest", "total_desc", "total_asc"]).default("newest"),
  })
  .strict()
  .refine(
    (query) =>
      query.dateFrom === undefined ||
      query.dateTo === undefined ||
      new Date(query.dateFrom) <= new Date(query.dateTo),
    { message: "dateFrom must not be after dateTo.", path: ["dateFrom"] },
  )
  .refine(
    (query) =>
      query.minTotal === undefined ||
      query.maxTotal === undefined ||
      query.minTotal <= query.maxTotal,
    { message: "minTotal must not exceed maxTotal.", path: ["minTotal"] },
  );

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Params                                                                     */
/* -------------------------------------------------------------------------- */

export const orderIdParamSchema = z.object({ id: uuidSchema });

export const orderItemParamSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
});

/** Orders are addressable by uuid or by order number. */
export const orderIdentifierParamSchema = z.object({
  identifier: z.string().trim().min(1).max(60),
});

export const invoiceQuerySchema = z
  .object({ format: z.enum(["json", "html"]).default("json") })
  .strict();

export const areaSearchQuerySchema = z
  .object({ q: z.string().trim().min(2).max(80) })
  .strict();
