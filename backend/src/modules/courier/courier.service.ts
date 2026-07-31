import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  courierShipments,
  FINAL_SHIPMENT_STATUSES,
  type CourierProvider,
  type CourierShipmentRow,
  type ShipmentStatus,
} from "../../db/schema/courier-shipments.js";
import { orders } from "../../db/schema/orders.js";
import { orderItems } from "../../db/schema/order-items.js";
import type { StoreSettingsRow } from "../../db/schema/store-settings.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import { getSettings } from "../settings/settings.service.js";
import * as orderService from "../orders/order.service.js";
import { SYSTEM_ACTOR, type Actor } from "../orders/order-event.repository.js";
import { createSteadfastAdapter } from "./steadfast.adapter.js";
import { createPathaoAdapter } from "./pathao.adapter.js";
import { CourierError, type CourierProviderAdapter } from "./provider.js";

/**
 * Courier hand-off.
 *
 * Replaces two manual jobs: typing each parcel into the courier's own panel,
 * and walking each order through five statuses here. The second one matters
 * more than it looks — the profit report is built on `delivered_at`, so an
 * order that really was delivered but never clicked reads as zero revenue and
 * sits in "on the way" forever. Reading the status back from the courier fixes
 * the accounting as well as the labour.
 *
 * WHAT THIS DELIBERATELY WILL NOT DO
 * It never cancels or returns an order on its own. A courier reporting
 * `returned` moves our order to returned, because that is a fact about a parcel
 * that came back. But nothing here creates a parcel without a person pressing
 * the button: on cash on delivery an unconfirmed parcel is a likely refusal,
 * and the confirmation call is the human step that prevents it.
 */

const log = createLogger("courier");

export type CourierConfig = Pick<
  StoreSettingsRow,
  | "courierProvider"
  | "courierApiKey"
  | "courierApiSecret"
  | "courierStoreId"
  | "courierBaseUrl"
  | "courierEnabled"
>;

export type CourierProblem =
  | "disabled"
  | "no_provider"
  | "missing_credentials"
  | "missing_store_id";

export function configProblem(settings: CourierConfig): CourierProblem | null {
  if (settings.courierProvider === "") return "no_provider";
  if (settings.courierApiKey.trim() === "" || settings.courierApiSecret.trim() === "") {
    return "missing_credentials";
  }
  /* Pathao dispatches from a specific merchant store; Steadfast has no such
     concept, so this is only required for one of them. */
  if (settings.courierProvider === "pathao" && settings.courierStoreId.trim() === "") {
    return "missing_store_id";
  }
  if (!settings.courierEnabled) return "disabled";
  return null;
}

/**
 * Builds the adapter for whichever courier is configured.
 *
 * Constructed per call rather than cached: the Pathao adapter holds an OAuth
 * token, and a cached adapter would keep using a token minted for credentials
 * the owner has since replaced.
 */
export function adapterFor(settings: CourierConfig): CourierProviderAdapter {
  switch (settings.courierProvider as CourierProvider) {
    case "steadfast":
      return createSteadfastAdapter({
        apiKey: settings.courierApiKey,
        apiSecret: settings.courierApiSecret,
        baseUrl: settings.courierBaseUrl || undefined,
      });
    case "pathao":
      return createPathaoAdapter({
        clientId: settings.courierApiKey,
        clientSecret: settings.courierApiSecret,
        storeId: settings.courierStoreId,
        baseUrl: settings.courierBaseUrl || undefined,
      });
    default:
      throw new BadRequestError("No courier is configured. Choose one in Settings.");
  }
}

/* -------------------------------------------------------------------------- */
/* Sending a parcel                                                           */
/* -------------------------------------------------------------------------- */

export interface ShipmentDto {
  id: string;
  provider: CourierProvider;
  consignmentId: string;
  trackingCode: string;
  courierStatus: string;
  status: ShipmentStatus;
  codAmount: number;
  lastSyncedAt: string | null;
  lastError: string;
  createdAt: string;
}

function toDto(row: CourierShipmentRow): ShipmentDto {
  return {
    id: row.id,
    provider: row.provider,
    consignmentId: row.consignmentId,
    trackingCode: row.trackingCode,
    courierStatus: row.courierStatus,
    status: row.mappedStatus,
    codAmount: row.codAmount,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findByOrder(orderId: string): Promise<ShipmentDto | null> {
  const rows = await getDb()
    .select()
    .from(courierShipments)
    .where(eq(courierShipments.orderId, orderId))
    .limit(1);

  return rows[0] ? toDto(rows[0]) : null;
}

/**
 * Hands one order to the courier.
 *
 * Guarded three ways, because every one of them costs real money if it slips:
 * an order already sent (two couriers, one customer, two delivery charges), an
 * order that is cancelled or returned (a parcel for something nobody is owed),
 * and an unconfirmed order (the refusal this whole workflow exists to avoid).
 */
export async function sendOrder(orderId: string, actor: Actor): Promise<ShipmentDto> {
  const db = getDb();
  const settings = await getSettings();

  const problem = configProblem(settings);
  if (problem !== null) {
    throw new BadRequestError(
      problem === "disabled"
        ? "Courier hand-off is switched off in Settings."
        : problem === "no_provider"
          ? "No courier is configured. Choose one in Settings."
          : problem === "missing_store_id"
            ? "Pathao needs your store id. Add it in Settings."
            : "The courier API key and secret are not configured.",
    );
  }

  const existing = await findByOrder(orderId);
  if (existing) {
    throw new ConflictError(
      `This order is already with ${existing.provider} (${existing.trackingCode || existing.consignmentId}).`,
    );
  }

  const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = orderRows[0];
  if (!order) throw new NotFoundError("Order not found.");

  if (order.status === "cancelled" || order.status === "returned") {
    throw new BadRequestError(`This order is ${order.status}. It cannot be sent to a courier.`);
  }
  if (order.status === "pending") {
    /* The confirmation call is what stops a fake or hesitant order becoming a
       refused parcel — the single largest avoidable cost on COD. */
    throw new BadRequestError(
      "Confirm the order by phone first. Sending an unconfirmed order is how parcels come back.",
    );
  }

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const description = items
    .map((item) => `${item.productName}${item.variantLabel ? ` (${item.variantLabel})` : ""} x${item.quantity}`)
    .join(", ");

  const adapter = adapterFor(settings);

  let created;
  try {
    created = await adapter.createParcel({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      areaText: order.areaText,
      /* The whole amount, because this shop is cash on delivery. When advance
         payment lands, this is the line that becomes conditional. */
      codAmount: order.grandTotal,
      itemDescription: description || "Gadgets",
      totalQuantity: order.totalQuantity,
    });
  } catch (error) {
    const message = error instanceof CourierError ? error.message : "The courier refused the parcel.";
    log.error({ err: error, orderId }, "Parcel creation failed");
    throw new BadRequestError(message);
  }

  const inserted = await db
    .insert(courierShipments)
    .values({
      orderId,
      provider: settings.courierProvider as CourierProvider,
      consignmentId: created.consignmentId,
      trackingCode: created.trackingCode,
      codAmount: created.codAmount,
      mappedStatus: "pending",
      createdBy: actor.adminId ?? null,
      lastSyncedAt: new Date(),
    })
    .returning();

  const shipment = inserted[0];
  if (!shipment) throw new NotFoundError("The shipment could not be recorded.");

  /* Move the order along, so the board reflects that the parcel has gone.
     Failing here must not lose the consignment id — the parcel is already real,
     and losing the reference would mean it can never be tracked again. */
  try {
    await advanceToShipped(order.status, orderId, actor, {
      provider: settings.courierProvider,
      trackingCode: created.trackingCode || created.consignmentId,
    });
  } catch (error) {
    log.error({ err: error, orderId }, "Parcel created but the order status did not move");
  }

  if (created.codAmount !== order.grandTotal) {
    /* Money that goes quietly missing otherwise: the courier will collect what
       IT thinks it should, not what the order says. */
    log.warn(
      { orderId, expected: order.grandTotal, courier: created.codAmount },
      "Courier COD differs from the order total",
    );
  }

  return toDto(shipment);
}

/**
 * Walks an order up to `shipped` through every transition the domain allows.
 *
 * The status machine is deliberately strict — confirmed → processing → packed →
 * shipped — because on a manual workflow each of those is a real step somebody
 * performs. Handing a parcel to a courier collapses all of them into one act,
 * but the machine is not relaxed to allow the jump: those rules also guard the
 * manual path, and loosening them here would loosen them everywhere.
 *
 * Only the final step carries the courier note. Three identical audit entries
 * stamped in the same second would make the timeline harder to read, not
 * easier.
 */
async function advanceToShipped(
  from: string,
  orderId: string,
  actor: Actor,
  parcel: { provider: string; trackingCode: string },
): Promise<void> {
  const path: Record<string, ("processing" | "packed" | "shipped")[]> = {
    confirmed: ["processing", "packed", "shipped"],
    processing: ["packed", "shipped"],
    packed: ["shipped"],
  };

  const steps = path[from];
  /* Already shipped, delivered, or somewhere this should not touch. */
  if (!steps) return;

  for (const status of steps) {
    await orderService.updateStatus(
      orderId,
      {
        status,
        ...(status === "shipped"
          ? { note: `Handed to ${parcel.provider} — ${parcel.trackingCode}` }
          : {}),
      },
      actor,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the status back                                                    */
/* -------------------------------------------------------------------------- */

/** Order status implied by a parcel's state, or null to leave it alone. */
function orderStatusFor(status: ShipmentStatus): "shipped" | "delivered" | "returned" | null {
  if (status === "delivered") return "delivered";
  if (status === "returned") return "returned";
  if (status === "out_for_delivery" || status === "in_transit" || status === "picked_up") {
    return "shipped";
  }
  return null;
}

/**
 * Refreshes one parcel, and moves its order if the courier says so.
 *
 * `delivered` is the one that matters most: it is what the profit report counts
 * as revenue, and until now it depended on somebody remembering to click.
 */
export async function syncShipment(shipmentId: string): Promise<ShipmentDto> {
  const db = getDb();
  const settings = await getSettings();

  const rows = await db
    .select()
    .from(courierShipments)
    .where(eq(courierShipments.id, shipmentId))
    .limit(1);

  const shipment = rows[0];
  if (!shipment) throw new NotFoundError("Shipment not found.");

  const adapter = adapterFor(settings);

  let status;
  try {
    status = await adapter.fetchStatus(shipment.consignmentId);
  } catch (error) {
    const message = error instanceof CourierError ? error.message : "Could not reach the courier.";

    /* Recorded rather than thrown for the background sync: one unreachable
       parcel must not stop the rest, and a failure nobody can see in the panel
       is a failure nobody fixes. */
    const failed = await db
      .update(courierShipments)
      .set({ lastError: message, lastSyncedAt: new Date(), updatedAt: sql`now()` })
      .where(eq(courierShipments.id, shipmentId))
      .returning();

    return toDto(failed[0]!);
  }

  const updated = await db
    .update(courierShipments)
    .set({
      courierStatus: status.raw,
      mappedStatus: status.mapped,
      lastError: "",
      lastSyncedAt: new Date(),
      updatedAt: sql`now()`,
    })
    .where(eq(courierShipments.id, shipmentId))
    .returning();

  const next = updated[0]!;

  const target = orderStatusFor(status.mapped);
  if (target) {
    const orderRows = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, shipment.orderId))
      .limit(1);

    const current = orderRows[0]?.status;

    /* Only ever forward, and never over a decision a person made. An order
       someone cancelled by hand must not be resurrected because the courier's
       board is a day behind. */
    if (current && current !== target && current !== "cancelled" && current !== "returned") {
      try {
        /* `delivered` and `returned` are only legal from `shipped`. Normally
           the order is already there — the hand-off put it there — but if that
           step failed at send time, this catches up rather than logging an
           illegal-transition error every ten minutes forever. */
        await advanceToShipped(current, shipment.orderId, SYSTEM_ACTOR, {
          provider: shipment.provider,
          trackingCode: shipment.trackingCode || shipment.consignmentId,
        });

        if (target !== "shipped") {
          /* Attributed to the system, not to whoever triggered the sync — the
             courier decided this, not a person. */
          await orderService.updateStatus(
            shipment.orderId,
            { status: target, note: `Courier reported "${status.raw}"` },
            SYSTEM_ACTOR,
          );
        }
      } catch (error) {
        log.error(
          { err: error, orderId: shipment.orderId, target },
          "Courier status could not be applied to the order",
        );
      }
    }
  }

  return toDto(next);
}

/**
 * Refreshes every parcel that is still moving.
 *
 * Called on a timer. Skips anything already in a final state, and anything
 * synced within the last few minutes, so a shop with hundreds of open parcels
 * does not hammer the courier — or its own rate limit.
 */
export async function syncOpenShipments(options: { staleMinutes?: number } = {}): Promise<{
  checked: number;
  updated: number;
}> {
  const settings = await getSettings();
  if (configProblem(settings) !== null) return { checked: 0, updated: 0 };

  const staleBefore = new Date(Date.now() - (options.staleMinutes ?? 20) * 60_000);

  const open = await getDb()
    .select({ id: courierShipments.id, status: courierShipments.mappedStatus })
    .from(courierShipments)
    .where(
      and(
        sql`${courierShipments.mappedStatus} not in ('delivered', 'returned', 'cancelled')`,
        or(isNull(courierShipments.lastSyncedAt), lt(courierShipments.lastSyncedAt, staleBefore)),
      ),
    )
    .limit(100);

  let updated = 0;

  for (const row of open) {
    const result = await syncShipment(row.id);
    if (result.status !== row.status) updated += 1;
  }

  if (open.length > 0) {
    log.info({ checked: open.length, updated }, "Courier sync finished");
  }

  return { checked: open.length, updated };
}

/**
 * The narrow projection a customer is allowed to see.
 *
 * Separate from `findByOrder` on purpose: that returns the consignment id, the
 * last error and the COD figure, none of which belong on a public tracking
 * page. A shopper gets our mapped status, the tracking code they could type
 * into the courier's own site, and the carrier's name.
 */
export async function findShipmentForCustomer(orderId: string): Promise<{
  status: ShipmentStatus;
  trackingCode: string;
  provider: CourierProvider;
} | null> {
  const rows = await getDb()
    .select({
      status: courierShipments.mappedStatus,
      trackingCode: courierShipments.trackingCode,
      provider: courierShipments.provider,
    })
    .from(courierShipments)
    .where(eq(courierShipments.orderId, orderId))
    .limit(1);

  return rows[0] ?? null;
}

/** Shipments still in flight, for the admin overview. */
export async function openCount(): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(courierShipments)
    .where(sql`${courierShipments.mappedStatus} not in ('delivered', 'returned', 'cancelled')`);

  return rows[0]?.count ?? 0;
}

export { FINAL_SHIPMENT_STATUSES, inArray };
