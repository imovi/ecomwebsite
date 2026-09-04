import type { Request, RequestHandler } from "express";
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from "../../core/response.js";
import { NotFoundError, UnauthorizedError } from "../../core/errors.js";
import { validated } from "../../middleware/validate.js";
import { searchAreas } from "../../lib/geo/delivery-zone.js";
import { clientIp } from "../../lib/net/client-ip.js";
import * as checkout from "./checkout.service.js";
import * as orderService from "./order.service.js";
import {
  buildInvoice,
  buildInvoices,
  renderInvoiceHtml,
  renderInvoiceSheetHtml,
} from "./invoice.service.js";
import type { Actor } from "./order-event.repository.js";
import type { OrderFilters } from "./order.repository.js";
import type {
  AdminCreateOrderInput,
  CancelOrderInput,
  RevertStatusInput,
  InternalNotesInput,
  InvoiceSheetQuery,
  ListOrdersQuery,
  PlaceOrderInput,
  QuoteInput,
  StatusCountsQuery,
  UpdateCustomerInput,
  UpdateItemQuantityInput,
  UpdateItemVariantInput,
  UpdateStatusInput,
  BulkUpdateStatusInput,
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
/**
 * POST /api/v1/admin/orders — an order typed in by the desk.
 *
 * Most of this shop's sales are agreed in a message, not through the checkout: a
 * customer sees an ad, writes to the page or to WhatsApp, and somebody at the
 * desk settles it in a conversation. This is where that conversation becomes an
 * order.
 *
 * It calls the SAME `checkout.placeOrder` the storefront does. That is the whole
 * point — one place resolves prices from the catalogue, one place decrements
 * stock conditionally inside the transaction, one place generates the order
 * number. A separate admin write path would duplicate the stock logic, and two
 * copies of a decrement are how a shop oversells without noticing.
 *
 * What differs is only context: a source, who typed it, and a starting status.
 */
export const adminCreateOrder: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();

  const { body } = validated<AdminCreateOrderInput>(req);
  const { source, status, ...order } = body;

  const result = await checkout.placeOrder(order, {
    source,
    initialStatus: status,
    /* The email rather than a display name: `req.auth` carries it already, so
       the timeline names the person without a second query, and an address is
       unambiguous in a way a first name is not. */
    createdBy: { adminId: req.auth.adminId, name: req.auth.email },
    /* Deliberately no ipAddress and no userAgent. They describe the OPERATOR's
       browser, not the customer's, and writing the desk's address into
       `customer_ip` would poison both the fraud trail and Meta's attribution
       with the shop's own office. Absent is the honest value. */
  });

  sendCreated(res, { order: result.order });
};

export const placeOrder: RequestHandler = async (req, res) => {
  const { body } = validated<PlaceOrderInput>(req);

  const idempotencyKey = req.get("idempotency-key")?.trim().slice(0, 200);

  const result = await checkout.placeOrder(body, {
    idempotencyKey: idempotencyKey || undefined,
    /* Through the shared resolver, not `req.ip`. The latter happens to be
       correct today only because the storefront forwards a single-entry
       X-Forwarded-For and TRUST_PROXY_HOPS is 1 — an incidental alignment that
       a future proxy change would break silently, poisoning the fraud trail and
       Meta's attribution with it. */
    ipAddress: clientIp(req) ?? undefined,
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

/**
 * Turns the two date query parameters into a range.
 *
 * Shared by the list and the status tiles so a chosen range means exactly the
 * same thing to both — tiles counting one window while the list below shows
 * another is the kind of discrepancy that costs trust in every other number on
 * the screen.
 */
function toDateRange(query: { dateFrom?: string; dateTo?: string }): {
  dateFrom?: Date;
  dateTo?: Date;
} {
  const range: { dateFrom?: Date; dateTo?: Date } = {};

  if (query.dateFrom) range.dateFrom = new Date(query.dateFrom);

  if (query.dateTo) {
    /* A bare date means the whole day. Without this, `dateTo=2026-07-29`
       resolves to midnight and silently excludes everything ordered that day
       — the single most confusing filter bug in any admin panel. */
    const to = new Date(query.dateTo);
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)) to.setUTCHours(23, 59, 59, 999);
    range.dateTo = to;
  }

  return range;
}

function toFilters(query: ListOrdersQuery): OrderFilters {
  const filters: OrderFilters = {};

  if (query.q) filters.search = query.q;
  if (query.status?.length) filters.status = query.status;
  if (query.paymentMethod) filters.paymentMethod = query.paymentMethod;
  if (query.deliveryZone) filters.deliveryZone = query.deliveryZone;
  if (query.minTotal !== undefined) filters.minTotal = query.minTotal;
  if (query.maxTotal !== undefined) filters.maxTotal = query.maxTotal;

  const range = toDateRange(query);
  if (range.dateFrom) filters.dateFrom = range.dateFrom;
  if (range.dateTo) filters.dateTo = range.dateTo;

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

/**
 * GET /api/v1/admin/orders/status-counts — badge numbers for the status tabs.
 *
 * Takes the same optional `dateFrom`/`dateTo` as the list, so the overview
 * tiles can answer "how many today" rather than only "how many ever".
 */
export const statusCounts: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, StatusCountsQuery>(req);
  sendSuccess(res, { counts: await orderService.statusCounts(toDateRange(query)) });
};

/** GET /api/v1/admin/orders/:identifier — uuid or order number. */
export const detail: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { identifier: string }>(req);
  sendSuccess(res, { order: await orderService.getByIdentifier(params.identifier) });
};

/* -------------------------------------------------------------------------- */
/* Trash                                                                      */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/admin/orders/trash — what is waiting to be purged. */
export const listTrash: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListOrdersQuery>(req);

  const result = await orderService.list({
    filters: { ...toFilters(query), deleted: "trashed" },
    sort: query.sort,
    page: query.page,
    perPage: query.perPage,
  });

  sendPaginated(res, result.items, result.pagination);
};

/** DELETE /api/v1/admin/orders/:id — to the trash, not gone. */
export const moveToTrash: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await orderService.moveToTrash(params.id, actorFrom(req));
  sendNoContent(res);
};

/** POST /api/v1/admin/orders/:id/restore */
export const restore: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await orderService.restoreFromTrash(params.id, actorFrom(req));
  sendSuccess(res, { order: await orderService.getByIdentifier(params.id) });
};

/** DELETE /api/v1/admin/orders/:id/purge — gone for good. */
export const purge: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await orderService.purgeFromTrash(params.id);
  sendNoContent(res);
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

/** POST /api/v1/admin/orders/bulk-status */
export const bulkUpdateStatus: RequestHandler = async (req, res) => {
  const { body } = validated<BulkUpdateStatusInput>(req);
  const result = await orderService.bulkUpdateStatus(body.orderIds, body.status, actorFrom(req));
  sendSuccess(res, result);
};

/** POST /api/v1/admin/orders/:id/cancel */
export const cancel: RequestHandler = async (req, res) => {
  const { body, params } = validated<CancelOrderInput, unknown, { id: string }>(req);
  const order = await orderService.cancel(params.id, body, actorFrom(req));
  sendSuccess(res, { order });
};

/**
 * POST /api/v1/admin/orders/:id/revert
 *
 * The role goes to the service rather than sitting on the route: whether this
 * needs an admin depends on which status is being left, and only the service
 * knows that.
 */
export const revertStatus: RequestHandler = async (req, res) => {
  if (!req.auth) throw new UnauthorizedError();
  const { body, params } = validated<RevertStatusInput, unknown, { id: string }>(req);
  const order = await orderService.revertStatus(params.id, body, actorFrom(req), req.auth.role);
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

/**
 * GET /api/v1/admin/orders/invoices?ids=a,b,c&per=4
 *
 * Many invoices tiled onto A4 sheets, for packing a batch in one print run.
 * Always HTML — the JSON form of this is the single-order endpoint called in a
 * loop, and there is no caller that wants an array of invoice documents.
 */
export const invoiceSheet: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, InvoiceSheetQuery>(req);

  const invoices = await buildInvoices(query.ids);
  if (invoices.length === 0) throw new NotFoundError("None of those orders exist.");

  res.type("html").send(renderInvoiceSheetHtml(invoices, query.per));
};
