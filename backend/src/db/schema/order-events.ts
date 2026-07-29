import { sql } from "drizzle-orm";
import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orders } from "./orders.js";
import { admins } from "./admins.js";
import { orderEventTypeEnum } from "./order-enums.js";

/**
 * Order timeline — an append-only audit log.
 *
 * Nothing about an order is modified silently. Every mutation writes a row
 * here inside the same transaction as the change itself, so the log cannot
 * drift from reality: if the event insert fails, the change is rolled back
 * with it.
 *
 * There is deliberately no update or delete path in the repository. A
 * correction is a new event, never an edit of an old one — an audit trail that
 * can be rewritten is not an audit trail.
 *
 * `previous_value` and `new_value` are jsonb so one shape covers a status
 * string, an integer quantity, a money amount and a whole address object
 * without a column per type.
 */
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Monotonic ordering key.
     *
     * The audit log is ordered by THIS, not by `created_at`. Several events
     * written by one edit can land in the same microsecond, and a timestamp
     * tie leaves the log with no defined order — "address changed" could
     * render after the recalculation it caused. A sequence is immune to that,
     * and to clock adjustments.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),

    type: orderEventTypeEnum("type").notNull(),

    /** Dotted path of what changed, e.g. `customer.phone`, `items[2].quantity`. */
    field: text("field"),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),

    /**
     * Who did it.
     *
     * Null means the actor was not an administrator — the customer placing
     * the order, or the system reacting to something. RESTRICT on delete: an
     * audit entry must never lose its author because an account was removed.
     */
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "restrict" }),
    /** Snapshot of the actor's name, so the log reads correctly forever. */
    actorName: text("actor_name").notNull().default("System"),

    /** Free-text context supplied by the operator. */
    note: text("note"),

    /**
     * `clock_timestamp()`, deliberately not `now()`.
     *
     * `now()` returns the TRANSACTION start time, so several events written by
     * a single edit would all carry an identical timestamp and the audit log
     * would have no defined order — "address changed" could render after the
     * recalculation it caused. `clock_timestamp()` advances within the
     * transaction, giving each entry a distinct, correctly ordered time.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    /* The timeline is always read as "this order, oldest first". */
    index("order_events_order_seq_idx").on(table.orderId, table.seq),
    index("order_events_type_idx").on(table.type),
    index("order_events_admin_idx").on(table.adminId),
  ],
);

export type OrderEventRow = typeof orderEvents.$inferSelect;
export type NewOrderEventRow = typeof orderEvents.$inferInsert;
