import { and, asc, desc, eq } from "drizzle-orm";
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

/**
 * The last status change that has not already been taken back.
 *
 * Undoing needs to know what the order was before a move, and the timeline
 * holds that as a fact rather than something to infer from a transition table:
 * `previous_value` was written in the same transaction as the move it
 * describes.
 *
 * WHY THIS IS A STACK WALK AND NOT "THE NEWEST ROW"
 * ------------------------------------------------
 * An undo is itself a status event. Taking the newest row every time means the
 * second press of Undo finds the first undo and reverses *that* — the button
 * becomes a toggle between two statuses instead of stepping back through the
 * history. So the rows are walked newest-first and each `status_reverted`
 * cancels the next ordinary move below it, exactly like an undo stack. What
 * comes back is the oldest move still standing.
 *
 * Ordered by `seq`, not by the clock: two events written in the same
 * millisecond still have an order.
 */
export function pickUndoableStatusEvent(events: readonly OrderEventRow[]): OrderEventRow | null {
  const statusEvents = events
    .filter((event) => event.field === "status")
    .sort((a, b) => b.seq - a.seq);

  let alreadyUndone = 0;

  for (const event of statusEvents) {
    if (event.type === "status_reverted") {
      alreadyUndone += 1;
      continue;
    }
    if (alreadyUndone > 0) {
      alreadyUndone -= 1;
      continue;
    }
    return event;
  }

  return null;
}

/** The database-backed form. Same walk; the rows come from one indexed read. */
export async function findUndoableStatusEvent(
  orderId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<OrderEventRow | null> {
  const rows = await executor
    .select()
    .from(orderEvents)
    .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.field, "status")))
    .orderBy(desc(orderEvents.seq));

  return pickUndoableStatusEvent(rows);
}
