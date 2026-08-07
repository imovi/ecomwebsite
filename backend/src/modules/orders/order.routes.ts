import { Router, type RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { config } from "../../config/index.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { validate } from "../../middleware/validate.js";
import { TooManyRequestsError } from "../../core/errors.js";
import * as controller from "./order.controller.js";
import {
  areaSearchQuerySchema,
  cancelOrderSchema,
  internalNotesSchema,
  invoiceQuerySchema,
  invoiceSheetQuerySchema,
  listOrdersQuerySchema,
  statusCountsQuerySchema,
  orderIdParamSchema,
  orderIdentifierParamSchema,
  orderItemParamSchema,
  placeOrderSchema,
  quoteSchema,
  updateCustomerSchema,
  updateItemQuantitySchema,
  updateItemVariantSchema,
  updateStatusSchema,
} from "./order.validation.js";

/**
 * Order routes.
 *
 *   /api/v1/checkout       public — quote and place order, nothing else
 *   /api/v1/admin/orders   authenticated — everything else
 *
 * Public users can place an order and cannot read one back. There is
 * deliberately no public order-lookup endpoint: order numbers are sequential,
 * and an order record contains a name, a phone number and a home address.
 * Exposing lookup would turn a guessable identifier into a customer-data leak.
 */

/* -------------------------------------------------------------------------- */
/* Public checkout                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Checkout is the only unauthenticated write in the API, which makes it the
 * obvious target for order spam on a cash-on-delivery store where placing an
 * order costs the customer nothing.
 *
 * Keyed by IP collapsed to a /64 for IPv6 — a residential IPv6 allocation
 * gives one attacker 2^64 addresses, so keying on the full address is no limit
 * at all.
 *
 * SCALING NOTE: the default store is per-process memory, so the effective
 * limit multiplies by the replica count. Swap in `rate-limit-redis` before
 * scaling horizontally; nothing else here changes.
 */
const checkoutRateLimit: RequestHandler = rateLimit({
  windowMs: config.rateLimit.checkout.windowMs,
  limit: config.rateLimit.checkout.max,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `checkout:${ipKeyGenerator(req.ip ?? "unknown")}`,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError(Math.ceil(config.rateLimit.checkout.windowMs / 1000)));
  },
});

/** Quoting is read-only, so it gets a looser ceiling than placing an order. */
const quoteRateLimit: RequestHandler = rateLimit({
  windowMs: config.rateLimit.checkout.windowMs,
  limit: config.rateLimit.checkout.quoteMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `quote:${ipKeyGenerator(req.ip ?? "unknown")}`,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError(Math.ceil(config.rateLimit.checkout.windowMs / 1000)));
  },
});

export const checkoutPublicRouter: Router = Router();

checkoutPublicRouter.post(
  "/quote",
  quoteRateLimit,
  validate({ body: quoteSchema }),
  controller.quote,
);

checkoutPublicRouter.post(
  "/order",
  checkoutRateLimit,
  validate({ body: placeOrderSchema }),
  controller.placeOrder,
);

checkoutPublicRouter.get(
  "/areas",
  quoteRateLimit,
  validate({ query: areaSearchQuerySchema }),
  controller.searchDeliveryAreas,
);

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export const orderAdminRouter: Router = Router();

/* `manager` is the floor: working the order queue — confirming, correcting a
   phone number, packing — is daily operational work. */
orderAdminRouter.use(authenticate, requireRole("manager"));

/* Literal paths before the `/:identifier` catch-all; Express matches in
   declaration order and would otherwise treat "status-counts" as an order
   number. */
orderAdminRouter.get(
  "/status-counts",
  validate({ query: statusCountsQuerySchema }),
  controller.statusCounts,
);

/* Also before `/:identifier` — Express matches in declaration order and would
   otherwise read "trash" as an order number. */
orderAdminRouter.get(
  "/trash",
  validate({ query: listOrdersQuerySchema }),
  controller.listTrash,
);

/* Also before `/:identifier`, for the same reason as the two above: on its own
   "invoices" is a perfectly good order number as far as the router is
   concerned. Plural, so it cannot collide with `/:identifier/invoice`. */
orderAdminRouter.get(
  "/invoices",
  validate({ query: invoiceSheetQuerySchema }),
  controller.invoiceSheet,
);

orderAdminRouter.get(
  "/",
  validate({ query: listOrdersQuerySchema }),
  controller.list,
);

orderAdminRouter.get(
  "/:identifier/invoice",
  validate({ params: orderIdentifierParamSchema, query: invoiceQuerySchema }),
  controller.invoice,
);

orderAdminRouter.get(
  "/:id/timeline",
  validate({ params: orderIdParamSchema }),
  controller.timeline,
);

orderAdminRouter.get(
  "/:identifier",
  validate({ params: orderIdentifierParamSchema }),
  controller.detail,
);

/* --- Customer information -------------------------------------------------
   One endpoint covers name, phone, address and area. They are edited together
   during a confirmation call, and splitting them into four endpoints would
   mean four requests, four version bumps and four chances to half-apply a
   correction. Each changed field still produces its own timeline entry. */
orderAdminRouter.patch(
  "/:id/customer",
  validate({ params: orderIdParamSchema, body: updateCustomerSchema }),
  controller.updateCustomer,
);

/* --- Line items ----------------------------------------------------------- */

orderAdminRouter.patch(
  "/:id/items/:itemId/quantity",
  validate({ params: orderItemParamSchema, body: updateItemQuantitySchema }),
  controller.updateItemQuantity,
);

orderAdminRouter.patch(
  "/:id/items/:itemId/variant",
  validate({ params: orderItemParamSchema, body: updateItemVariantSchema }),
  controller.updateItemVariant,
);

/* --- Lifecycle ------------------------------------------------------------ */

orderAdminRouter.patch(
  "/:id/status",
  validate({ params: orderIdParamSchema, body: updateStatusSchema }),
  controller.updateStatus,
);

orderAdminRouter.post(
  "/:id/cancel",
  validate({ params: orderIdParamSchema, body: cancelOrderSchema }),
  controller.cancel,
);

orderAdminRouter.patch(
  "/:id/notes",
  validate({ params: orderIdParamSchema, body: internalNotesSchema }),
  controller.updateInternalNotes,
);

/* --- Trash ---------------------------------------------------------------
   Moving to the trash is `manager`, the same floor as working the queue: it is
   a tidying action and it is reversible for thirty days. Destroying an order
   for good is `admin`, because that one is not. */

orderAdminRouter.delete(
  "/:id",
  validate({ params: orderIdParamSchema }),
  controller.moveToTrash,
);

orderAdminRouter.post(
  "/:id/restore",
  validate({ params: orderIdParamSchema }),
  controller.restore,
);

orderAdminRouter.delete(
  "/:id/purge",
  requireRole("admin"),
  validate({ params: orderIdParamSchema }),
  controller.purge,
);
