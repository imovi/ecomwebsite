import { asc, eq } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { orderEvents, type OrderEventRow } from "../../db/schema/order-events.js";
import type { OrderEventType } from "../../db/schema/order-enums.js";

/**
 * Order timeline — append only.
 *
 * There is deliberately no update and no delete function in this file. A
 * correction is a new event, never an edit of an old one: an audit trail that
 * can be rewritten is not an audit trail.
 *
 * Writes take an executor because they must run inside the same transaction as
 * the change they describe. If the change rolls back, so does its record — the
 * log cannot drift from reality.
 */

/** Who performed the action. Absent means the customer or the system. */
export interface Actor {
  adminId?: string | undefined;
  name: string;
}

export const SYSTEM_ACTOR: Actor = { name: "System" };
export const CUSTOMER_ACTOR: Actor = { name: "Customer" };

export interface RecordEventInput {
  orderId: string;
  type: OrderEventType;
  /** Dotted path of what changed, e.g. `customer.phone`. */
  field?: string;
  previousValue?: unknown;
  newValue?: unknown;
  actor: Actor;
  note?: string | undefined;
}

export async function recordEvent(
  input: RecordEventInput,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderEventRow> {
  const rows = await executor
    .insert(orderEvents)
    .values({
      orderId: input.orderId,
      type: input.type,
      field: input.field ?? null,
      /* `null` and "absent" are different: a cleared note has a previous value
         of some text and a new value of null, and the timeline should say so. */
      previousValue: input.previousValue === undefined ? null : input.previousValue,
      newValue: input.newValue === undefined ? null : input.newValue,
      adminId: input.actor.adminId ?? null,
      actorName: input.actor.name,
      note: input.note ?? null,
    })
    .returning();

  const created = rows[0];
  if (!created) throw new Error("Insert into order_events returned no row");
  return created;
}

/** Batch insert, for a single edit that changed several fields at once. */
export async function recordEvents(
  inputs: RecordEventInput[],
  executor: DatabaseExecutor = getDb(),
): Promise<OrderEventRow[]> {
  if (inputs.length === 0) return [];

  return executor
    .insert(orderEvents)
    .values(
      inputs.map((input) => ({
        orderId: input.orderId,
        type: input.type,
        field: input.field ?? null,
        previousValue: input.previousValue === undefined ? null : input.previousValue,
        newValue: input.newValue === undefined ? null : input.newValue,
        adminId: input.actor.adminId ?? null,
        actorName: input.actor.name,
        note: input.note ?? null,
      })),
    )
    .returning();
}

export async function listOrderEvents(
  orderId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderEventRow[]> {
  return executor
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    /* Ordered by the monotonic sequence, not the clock — see the note on
       the column. */
    .orderBy(asc(orderEvents.seq));
}
