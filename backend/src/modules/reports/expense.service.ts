import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  expenses,
  type ExpenseCategory,
  type ExpensePeriod,
  type ExpenseRow,
} from "../../db/schema/expenses.js";
import { NotFoundError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";

/**
 * The expense ledger.
 *
 * Ads are why this exists. On a shop that lives on Facebook traffic, ad spend is
 * usually the largest single cost and the one that decides whether a product is
 * worth selling at all — gross margin without it is a number that flatters.
 *
 * Everything here is day-grained and entered by a person. There is no bank feed
 * and no receipt scanning, deliberately: an owner will type one number a day for
 * ads, and will abandon anything heavier within a fortnight. A ledger that stops
 * being filled in is worse than none, because the profit page keeps reporting
 * from it as if it were complete.
 */

const log = createLogger("expenses");

export interface ExpenseDto {
  id: string;
  category: ExpenseCategory;
  amount: number;
  /** `YYYY-MM-DD`. */
  incurredOn: string;
  period: ExpensePeriod;
  note: string;
  createdAt: string;
}

function toDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    category: row.category,
    amount: row.amount,
    incurredOn: row.incurredOn,
    period: row.period,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Spreading a monthly cost across its days                                   */
/* -------------------------------------------------------------------------- */

/** Days in the calendar month a `YYYY-MM-DD` string falls in. */
export function daysInMonthOf(isoDate: string): number {
  const [year, month] = isoDate.split("-").map(Number) as [number, number, number];
  /* Day 0 of the next month is the last day of this one. */
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * How much of one expense falls inside `[from, to]`.
 *
 * A `day` expense is all-or-nothing. A `month` one is divided by the length of
 * its month and counted for each day of overlap, so a 7-day view carries a
 * seventh of the rent rather than the whole month's if the range happens to
 * include the 1st — or none of it if it does not. Without that, weekly profit
 * swings by the rent depending on which week you look at, which is noise
 * presented as signal.
 *
 * Rounded once at the end. Rounding per day would drift by several taka across
 * a month, and a report that does not reconcile with itself gets distrusted.
 */
export function amountWithin(row: ExpenseRow, from: string, to: string): number {
  if (row.period === "day") {
    return row.incurredOn >= from && row.incurredOn <= to ? row.amount : 0;
  }

  const [year, month] = row.incurredOn.split("-").map(Number) as [number, number, number];
  const days = daysInMonthOf(row.incurredOn);

  const monthStart = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(days).padStart(2, "0")}`;

  const overlapStart = from > monthStart ? from : monthStart;
  const overlapEnd = to < monthEnd ? to : monthEnd;
  if (overlapStart > overlapEnd) return 0;

  const overlapDays =
    Math.round(
      (Date.parse(`${overlapEnd}T00:00:00Z`) - Date.parse(`${overlapStart}T00:00:00Z`)) /
        86_400_000,
    ) + 1;

  return Math.round((row.amount * overlapDays) / days);
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface ListExpensesOptions {
  from?: string | undefined;
  to?: string | undefined;
  category?: ExpenseCategory | undefined;
}

/**
 * Rows that could contribute to `[from, to]`.
 *
 * Monthly rows are widened to their whole month before filtering: rent dated the
 * 1st still applies to a range covering only the 20th, and a naive `between` on
 * `incurred_on` would drop it.
 */
export async function findForRange(
  from: string,
  to: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ExpenseRow[]> {
  return executor
    .select()
    .from(expenses)
    .where(
      sql`(
        (${expenses.period} = 'day' and ${expenses.incurredOn} between ${from} and ${to})
        or (
          ${expenses.period} = 'month'
          and date_trunc('month', ${expenses.incurredOn}) <= ${to}::date
          and (date_trunc('month', ${expenses.incurredOn}) + interval '1 month - 1 day') >= ${from}::date
        )
      )`,
    );
}

export async function list(options: ListExpensesOptions = {}): Promise<ExpenseDto[]> {
  const filters = [
    ...(options.from ? [gte(expenses.incurredOn, options.from)] : []),
    ...(options.to ? [lte(expenses.incurredOn, options.to)] : []),
    ...(options.category ? [eq(expenses.category, options.category)] : []),
  ];

  const rows = await getDb()
    .select()
    .from(expenses)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(expenses.incurredOn), desc(expenses.createdAt))
    .limit(500);

  return rows.map(toDto);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateExpenseInput {
  category: ExpenseCategory;
  amount: number;
  incurredOn: string;
  period: ExpensePeriod;
  note?: string | undefined;
}

export async function create(
  input: CreateExpenseInput,
  actorId: string | null,
): Promise<ExpenseDto> {
  const rows = await getDb()
    .insert(expenses)
    .values({
      category: input.category,
      amount: input.amount,
      incurredOn: input.incurredOn,
      period: input.period,
      note: input.note ?? "",
      createdBy: actorId,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new NotFoundError("Expense could not be recorded.");

  log.info(
    { expenseId: row.id, category: row.category, amount: row.amount, by: actorId },
    "Expense recorded",
  );
  return toDto(row);
}

export interface UpdateExpenseInput {
  category?: ExpenseCategory | undefined;
  amount?: number | undefined;
  incurredOn?: string | undefined;
  period?: ExpensePeriod | undefined;
  note?: string | undefined;
}

export async function update(id: string, input: UpdateExpenseInput): Promise<ExpenseDto> {
  const patch: Partial<ExpenseRow> = {};
  if (input.category !== undefined) patch.category = input.category;
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.incurredOn !== undefined) patch.incurredOn = input.incurredOn;
  if (input.period !== undefined) patch.period = input.period;
  if (input.note !== undefined) patch.note = input.note;

  const rows = await getDb()
    .update(expenses)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(expenses.id, id))
    .returning();

  const row = rows[0];
  if (!row) throw new NotFoundError("Expense not found.");

  log.info({ expenseId: id, fields: Object.keys(patch) }, "Expense updated");
  return toDto(row);
}

export async function remove(id: string): Promise<void> {
  const rows = await getDb().delete(expenses).where(eq(expenses.id, id)).returning({
    id: expenses.id,
  });

  if (rows.length === 0) throw new NotFoundError("Expense not found.");
  log.info({ expenseId: id }, "Expense deleted");
}

/**
 * Records or replaces the ad spend for one day.
 *
 * Ads are entered daily and corrected often — "I said 2,000, it was 2,400" — so
 * the dashboard needs an idempotent write. Without it the obvious UI (type a
 * number, press save) silently produces two rows for one day and doubles the
 * cost.
 */
export async function setAdSpend(
  date: string,
  amount: number,
  actorId: string | null,
): Promise<ExpenseDto | null> {
  const existing = await getDb()
    .select()
    .from(expenses)
    .where(
      and(eq(expenses.category, "ads"), eq(expenses.incurredOn, date), eq(expenses.period, "day")),
    )
    .limit(1);

  const current = existing[0];

  /* Zero is how a day with no spend is expressed. The CHECK forbids storing
     it — a zero-taka expense is a mistyped one — so it means "remove the row". */
  if (amount === 0) {
    if (current) await remove(current.id);
    return null;
  }

  if (current) return update(current.id, { amount });
  return create({ category: "ads", amount, incurredOn: date, period: "day" }, actorId);
}
