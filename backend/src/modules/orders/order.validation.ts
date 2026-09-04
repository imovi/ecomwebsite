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

/**
 * A recovery coupon code as the customer types it.
 *
 * Bounded and folded to upper case here rather than in the service, so
 * everything downstream compares one form. Deliberately NOT pattern-matched
 * against the generator's alphabet: a typo should come back as "we do not
 * recognise that code" from the lookup, which is what happened, rather than as
 * a validation error about characters — the customer cannot act on the
 * difference and one of the two messages blames them for it.
 */
export const couponCodeSchema = z
  .string()
  .trim()
  .min(1, "Enter the coupon code.")
  .max(24)
  .transform((value) => value.toUpperCase());

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
    /**
     * A recovery coupon, checked but never spent here.
     *
     * The quote reports whether it would apply and what it is worth, so the
     * summary can show the delivery charge falling to zero before the customer
     * commits. Claiming it at quote time would burn the code for anybody who
     * pasted it and then changed their mind.
     */
    couponCode: couponCodeSchema.optional(),
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

    /**
     * Meta's click and browser cookies, read by the storefront at submit.
     *
     * Opaque to this API — they are passed through to the conversion report and
     * never parsed, so they are bounded by length and nothing else. A client
     * that sends nonsense here poisons only its own attribution.
     *
     * They MUST be declared even though nothing here reads them, because this
     * schema is `.strict()`: an undeclared field is not ignored, it is a 422.
     * Shipping the storefront half of this without this line would reject every
     * checkout in the shop.
     */
    fbc: safeString({ max: 255 }).nullish(),
    fbp: safeString({ max: 255 }).nullish(),

    /**
     * The coupon actually being spent.
     *
     * This one IS a price input, which is why it is the single exception to the
     * rule below — and why it is safe: it names a row the shop issued rather
     * than an amount the client chose. What it is worth is read from the
     * settings and the coupon, never from the request, and the code is claimed
     * by a conditional UPDATE inside the order transaction. A client that sends
     * a code it was never given gets a 409 and no order.
     */
    couponCode: couponCodeSchema.nullish(),

    /* Deliberately absent: price, subtotal, deliveryCharge, grandTotal.
       Accepting any of them from an unauthenticated request would let a
       client name its own price. `.strict()` rejects them outright. */
  })
  .strict();

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/**
 * The same order, typed in by the order desk.
 *
 * Extends the public checkout rather than replacing it, so a hand-typed order
 * goes through the identical validation, the identical price resolution and the
 * identical stock decrement. The alternative — a second write path with its own
 * rules — is how two places end up disagreeing about whether stock was taken,
 * and oversold inventory is the outcome nobody notices until a courier is
 * standing at a door.
 *
 * Money is still absent. An operator does not name a price either: the
 * catalogue does, exactly as it does for a customer.
 */
export const adminCreateOrderSchema = placeOrderSchema
  .extend({
    /**
     * Where the order came from, in the operator's own words — "WhatsApp",
     * "Facebook page", "phone". Required here, because an order reaching this
     * endpoint came from SOMEWHERE other than the website, and leaving it blank
     * would make it indistinguishable from a storefront checkout.
     */
    source: safeString({ min: 2, max: 40 }),

    /**
     * Where the order starts. Defaults to `confirmed`.
     *
     * The desk has already spoken to this customer — that conversation is why
     * the order exists. Starting at `pending` would put it on the "needs a
     * confirmation call" list it has already been through. `pending` stays
     * available for the case where somebody is typing up a message they have
     * not replied to yet.
     */
    status: z.enum(["pending", "confirmed"]).default("confirmed"),
  })
  .strict();

export type AdminCreateOrderInput = z.infer<typeof adminCreateOrderSchema>;

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

/**
 * Undoing the last status change.
 *
 * The destination is not a parameter. It is read from the timeline, so a
 * caller cannot ask to be put anywhere it likes — see `revertStatus`. The only
 * thing to supply is why, and that is required: an unexplained reversal on a
 * delivered order is indistinguishable from someone hiding a mistake.
 */
export const revertStatusSchema = z
  .object({
    reason: safeString({ min: 3, max: 300 }),
    expectedVersion,
  })
  .strict();

export type RevertStatusInput = z.infer<typeof revertStatusSchema>;

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

/**
 * The date window for the overview tiles.
 *
 * Only the two date fields — the tiles count every status by definition, so
 * accepting a `status` filter here would produce a set of counts that
 * contradicts its own labels.
 */
export const statusCountsQuerySchema = z
  .object({
    dateFrom: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
    dateTo: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  })
  .strict()
  .refine(
    (query) =>
      query.dateFrom === undefined ||
      query.dateTo === undefined ||
      new Date(query.dateFrom) <= new Date(query.dateTo),
    { message: "dateFrom must not be after dateTo.", path: ["dateFrom"] },
  );

export type StatusCountsQuery = z.infer<typeof statusCountsQuerySchema>;

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

/**
 * Bulk invoice sheet.
 *
 * `ids` is comma separated and holds order numbers or uuids — whichever the
 * caller has. Capped at 200: past that the URL approaches what proxies will
 * carry, and a browser asked to lay out that many sheets at once stops being
 * responsive long before the printer is the problem.
 *
 * `per` is validated against the layouts the renderer actually tiles evenly,
 * rather than any integer — a count that leaves a ragged last row cannot be
 * cut apart in straight lines.
 */
export const invoiceSheetQuerySchema = z
  .object({
    ids: z
      .string()
      .min(1, "Select at least one order.")
      .transform((value) =>
        value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(z.string().min(1).max(160))
          .min(1, "Select at least one order.")
          .max(200, "Too many orders for one print run — select 200 or fewer."),
      ),
    per: z.coerce.number().int().refine((value) => [1, 2, 4, 6, 9].includes(value), {
      message: "Choose 1, 2, 4, 6 or 9 invoices per sheet.",
    }).default(4),
    /** Suppresses the automatic print dialog; read by the page, not the API. */
    autoprint: z.string().optional(),
    keep: z.string().optional(),
  })
  .strict();

export type InvoiceSheetQuery = z.infer<typeof invoiceSheetQuerySchema>;

export const areaSearchQuerySchema = z
  .object({ q: z.string().trim().min(2).max(80) })
  .strict();
