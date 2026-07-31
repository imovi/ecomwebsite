import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { admins } from "./admins.js";

/**
 * Money that leaves the business without passing through an order.
 *
 * Ads are the reason this table exists — on a shop that lives on Facebook
 * traffic, ad spend is usually the largest single cost and the one that decides
 * whether a product is worth selling at all. Rent, salaries and a bulk packaging
 * purchase sit here too, so the profit page is a whole picture rather than a
 * gross-margin calculator.
 *
 * WHY A DATE AND NOT A TIMESTAMP
 * These are day-grained facts typed by a person: "Tuesday's ad spend was 2,000".
 * A timestamp would drag timezone arithmetic into a number that has none — a
 * Dhaka shop owner entering the 3rd means the 3rd, whatever UTC thinks the
 * instant was.
 */

/** Kept as a text column with a CHECK rather than an enum: adding a category is
 *  then a one-line migration instead of an `ALTER TYPE`, and nothing in the
 *  application dispatches on the value. */
export const EXPENSE_CATEGORIES = [
  "ads",
  "rent",
  "salary",
  "packaging",
  "transport",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * How the amount spreads across the calendar.
 *
 * `day` is spent on that date. `month` covers the whole calendar month and is
 * divided across its days, so a 7-day view carries a seventh of the rent rather
 * than the entire month's if the range happens to include the 1st — or none of
 * it if it does not. Without this, weekly profit swings by the rent depending on
 * which week you look at, which is noise dressed as signal.
 */
export const EXPENSE_PERIODS = ["day", "month"] as const;

export type ExpensePeriod = (typeof EXPENSE_PERIODS)[number];

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    category: text("category").$type<ExpenseCategory>().notNull(),

    /** Whole taka, like every other amount in this system. */
    amount: integer("amount").notNull(),

    /** For `period = 'month'`, any date within the month it covers. */
    incurredOn: date("incurred_on").notNull(),

    period: text("period").$type<ExpensePeriod>().notNull().default("day"),

    note: text("note").notNull().default(""),

    /* SET NULL, not CASCADE: an expense is a financial record and must not
       disappear because the person who entered it left the company. */
    createdBy: uuid("created_by").references(() => admins.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* Every report reads a date range, so the range scan is the access path
       that matters. Category is second because the summary groups by it. */
    index("expenses_incurred_on_idx").on(table.incurredOn.desc()),
    index("expenses_category_incurred_on_idx").on(table.category, table.incurredOn.desc()),

    /* A zero expense is a mistyped one, and a negative would be a refund —
       which belongs in its own row with its own category, not as a sign flip
       that quietly cancels out a real cost. */
    check("expenses_amount_positive", sql`${table.amount} > 0`),
    check(
      "expenses_category_known",
      sql`${table.category} in ('ads', 'rent', 'salary', 'packaging', 'transport', 'other')`,
    ),
    check("expenses_period_known", sql`${table.period} in ('day', 'month')`),
  ],
);

export type ExpenseRow = typeof expenses.$inferSelect;
export type NewExpenseRow = typeof expenses.$inferInsert;
