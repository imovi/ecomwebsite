import { asc, eq, inArray } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  abandonedCheckoutEvents,
  type AbandonedCheckoutEventRow,
  type AbandonedEventType,
} from "../../db/schema/abandoned-checkout-events.js";
import { createLogger } from "../../core/logger.js";

/**
 * Writing and reading a lead's history.
 *
 * Its own module rather than a function on either service, because both the
 * call list and the coupons write to it — putting it on one of them would have
 * the two importing each other.
 *
 * Mirrors `order-event.repository.ts` deliberately: a shop that has learnt to
 * read one timeline should not have to learn a second.
 */

const log = createLogger("abandoned-events");

export interface LeadActor {
  adminId: string | null;
  name: string;
}

/** The customer did this, not a member of staff. */
export const CUSTOMER_LEAD_ACTOR: LeadActor = { adminId: null, name: "Customer" };

export interface LeadEventDto {
  id: string;
  type: AbandonedEventType;
  detail: Record<string, unknown>;
  actorName: string;
  createdAt: string;
}

function toDto(row: AbandonedCheckoutEventRow): LeadEventDto {
  return {
    id: row.id,
    type: row.type,
    detail: row.detail,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Records one thing that happened to a lead.
 *
 * Never throws. Every caller is doing something that matters more than its own
 * audit line — sending a message, issuing a coupon, closing a recovered lead —
 * and a failed history write must not undo any of them. It is logged instead,
 * which is the same trade the order timeline makes.
 */
export async function recordLeadEvent(
  input: {
    checkoutId: string;
    type: AbandonedEventType;
    detail?: Record<string, unknown> | undefined;
    actor: LeadActor;
  },
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  try {
    await executor.insert(abandonedCheckoutEvents).values({
      checkoutId: input.checkoutId,
      type: input.type,
      detail: input.detail ?? {},
      actorAdminId: input.actor.adminId,
      actorName: input.actor.name,
    });
  } catch (error) {
    log.error(
      { err: error, checkoutId: input.checkoutId, type: input.type },
      "Could not record the lead event",
    );
  }
}

/** Every entry for one lead, oldest first — the order a story is read in. */
export async function listLeadEvents(checkoutId: string): Promise<LeadEventDto[]> {
  const rows = await getDb()
    .select()
    .from(abandonedCheckoutEvents)
    .where(eq(abandonedCheckoutEvents.checkoutId, checkoutId))
    .orderBy(asc(abandonedCheckoutEvents.createdAt))
    .limit(100);

  return rows.map(toDto);
}

/**
 * The same, for a page of leads at once.
 *
 * The call list renders every card with its history open, and one query per
 * card would be fifty round trips to draw one screen.
 */
export async function listLeadEventsFor(
  checkoutIds: string[],
): Promise<Map<string, LeadEventDto[]>> {
  const byCheckout = new Map<string, LeadEventDto[]>();
  if (checkoutIds.length === 0) return byCheckout;

  const rows = await getDb()
    .select()
    .from(abandonedCheckoutEvents)
    .where(inArray(abandonedCheckoutEvents.checkoutId, checkoutIds))
    .orderBy(asc(abandonedCheckoutEvents.createdAt));

  for (const row of rows) {
    const existing = byCheckout.get(row.checkoutId);
    if (existing) existing.push(toDto(row));
    else byCheckout.set(row.checkoutId, [toDto(row)]);
  }

  return byCheckout;
}
