import type { Request, RequestHandler } from "express";
import { sendCreated, sendPaginated, sendSuccess } from "../../core/response.js";
import { UnauthorizedError } from "../../core/errors.js";
import { validated } from "../../middleware/validate.js";
import { searchAreas } from "../../lib/geo/delivery-zone.js";
import * as checkout from "./checkout.service.js";
import * as orderService from "./order.service.js";
import { buildInvoice, renderInvoiceHtml } from "./invoice.service.js";
import type { Actor } from "./order-event.repository.js";
import type { OrderFilters } from "./order.repository.js";
import type {
  CancelOrderInput,
  InternalNotesInput,
  ListOrdersQuery,
  PlaceOrderInput,
  QuoteInput,
  UpdateCustomerInput,
  UpdateItemQuantityInput,
  UpdateItemVariantInput,
  UpdateStatusInput,
} from "./order.validation.js";

/**
 * Order HTTP layer. Translation only — no rules, no database access.
 */

/**
 * Identifies the acting administrator for the audit trail.
 *
 * Every admin route runs behind `authenticate`, so `req.auth` is guaranteed;
 * asserting keeps the type honest and turns a middleware misconfiguration into
 * a clear 401 rather than an audit entry attributed to nobody.
 */
function actorFrom(req: Request): Actor {
  if (!req.auth) throw new UnauthorizedError();
  return { adminId: req.auth.adminId, name: req.auth.email };
}

/* -------------------------------------------------------------------------- */
/* Public checkout                                                            */
/* -------------------------------------------------------------------------- */

/** POST /api/v1/checkout/quote — prices a cart without committing anything. */
export const quote: RequestHandler = async (req, res) => {
  const { body } = validated<QuoteInput>(req);
  sendSuccess(res, await checkout.quote(body));
};

/**
 * POST /api/v1/checkout/order — the only public write in the API.
 *
 * The `Idempotency-Key` header makes a retry safe: a flaky mobile connection
 * replaying the POST returns the original order instead of creating a second.
 */
export const placeOrder: RequestHandler = async (req, res) => {
  const { body } = validated<PlaceOrderInput>(req);

  const idempotencyKey = req.get("idempotency-key")?.trim().slice(0, 200);

  const result = await checkout.placeOrder(body, {
    idempotencyKey: idempotencyKey || undefined,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });

  /* A replay is not a creation, so it answers 200 rather than 201. */
  if (result.replayed) {
    sendSuccess(res, { order: result.order, replayed: true });
    return;
  }

  sendCreated(res, { order: result.order });
};

/** GET /api/v1/checkout/areas?q= — autocomplete for the address field. */
export const searchDeliveryAreas: RequestHandler = (req, res) => {
  const { query } = validated<unknown, { q: string }>(req);
  sendSuccess(res, { areas: searchAreas(query.q) });
};

/* -------------------------------------------------------------------------- */
/* Admin — reads                                                              */
/* -------------------------------------------------------------------------- */

function toFilters(query: ListOrdersQuery): OrderFilters {
  const filters: OrderFilters = {};

  if (query.q) filters.search = query.q;
  if (query.status?.length) filters.status = query.status;
  if (query.paymentMethod) filters.paymentMethod = query.paymentMethod;
  if (query.deliveryZone) filters.deliveryZone = query.deliveryZone;
  if (query.minTotal !== undefined) filters.minTotal = query.minTotal;
  if (query.maxTotal !== undefined) filters.maxTotal = query.maxTotal;

  if (query.dateFrom) filters.dateFrom = new Date(query.dateFrom);

  if (query.dateTo) {
    /* A bare date means the whole day. Without this, `dateTo=2026-07-29`
       resolves to midnight and silently excludes everything ordered that day
       — the single most confusing filter bug in any admin panel. */
    const to = new Date(query.dateTo);
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)) to.setUTCHours(23, 59, 59, 999);
    filters.dateTo = to;
  }

  return filters;
}

/** GET /api/v1/admin/orders */
export const list: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListOrdersQuery>(req);

  const result = await orderService.list({
    filters: toFilters(query),
    sort: query.sort,
    page: query.page,
    perPage: query.perPage,
  });

  sendPaginated(res, result.items, result.pagination);
};

/** GET /api/v1/admin/orders/status-counts — badge numbers for the status tabs. */
export const statusCounts: RequestHandler = async (_req, res) => {
  sendSuccess(res, { counts: await orderService.statusCounts() });
};

/** GET /api/v1/admin/orders/:identifier — uuid or order number. */
export const detail: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { identifier: string }>(req);
  sendSuccess(res, { order: await orderService.getByIdentifier(params.identifier) });
};

/**
 * GET /api/v1/admin/orders/:id/timeline — the immutable audit log.
 *
 * The same entries are embedded in the order detail; this serves them alone
 * for an operator investigating a dispute on an order with a long history.
 */
export const timeline: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  sendSuccess(res, { timeline: await orderService.getTimeline(params.id) });
};

/* -------------------------------------------------------------------------- */
/* Admin — writes                                                             */
/* -------------------------------------------------------------------------- */

/** PATCH /api/v1/admin/orders/:id/customer */
export const updateCustomer: RequestHandler = async (req, res) => {
  const { body, params } = validated<UpdateCustomerInput, unknown, { id: string }>(req);
  const order = await orderService.updateCustomer(params.id, body, actorFrom(req));
  sendSuccess(res, { order });
};

/** PATCH /api/v1/admin/orders/:id/items/:itemId/quantity */
export const updateItemQuantity: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    UpdateItemQuantityInput,
    unknown,
    { id: string; itemId: string }
  >(req);
  const order = await orderService.updateItemQuantity(
    params.id,
    params.itemId,
    body,
    actorFrom(req),
  );
  sendSuccess(res, { order });
};

/** PATCH /api/v1/admin/orders/:id/items/:itemId/variant */
export const updateItemVariant: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    UpdateItemVariantInput,
    unknown,
    { id: string; itemId: string }
  >(req);
  const order = await orderService.updateItemVariant(
    params.id,
    params.itemId,
    body,
    actorFrom(req),
  );
  sendSuccess(res, { order });
};

/** PATCH /api/v1/admin/orders/:id/status */
export const updateStatus: RequestHandler = async (req, res) => {
  const { body, params } = validated<UpdateStatusInput, unknown, { id: string }>(req);
  const order = await orderService.updateStatus(params.id, body, actorFrom(req));
  sendSuccess(res, { order });
};

/** POST /api/v1/admin/orders/:id/cancel */
export const cancel: RequestHandler = async (req, res) => {
  const { body, params } = validated<CancelOrderInput, unknown, { id: string }>(req);
  const order = await orderService.cancel(params.id, body, actorFrom(req));
  sendSuccess(res, { order });
};

/** PATCH /api/v1/admin/orders/:id/notes */
export const updateInternalNotes: RequestHandler = async (req, res) => {
  const { body, params } = validated<InternalNotesInput, unknown, { id: string }>(req);
  const order = await orderService.updateInternalNotes(params.id, body, actorFrom(req));
  sendSuccess(res, { order });
};

/**
 * GET /api/v1/admin/orders/:identifier/invoice
 *
 * `?format=html` returns a self-contained printable document; the default JSON
 * lets the admin panel render its own. Both are built from the current order,
 * so an invoice always reflects the latest edits.
 */
export const invoice: RequestHandler = async (req, res) => {
  const { params, query } = validated<
    unknown,
    { format: "json" | "html" },
    { identifier: string }
  >(req);

  const data = await buildInvoice(params.identifier);

  if (query.format === "html") {
    res.type("html").send(renderInvoiceHtml(data));
    return;
  }

  sendSuccess(res, { invoice: data });
};
