import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./products.js";

/**
 * What was spent boosting one product on one day.
 *
 * WHY THIS EXISTS ALONGSIDE THE EXPENSE LEDGER
 * The ledger records "৳2,000 on ads today" for the whole shop, and the profit
 * report splits that across products by share of revenue. That split is only
 * ever an estimate, and it is worst exactly where it matters most: a product
 * that is selling BECAUSE it is boosted gets charged in proportion to the sales
 * the boost created, which flatters it and quietly overcharges everything else.
 *
 * A figure recorded here is a fact rather than an inference, and it replaces the
 * estimate for that product. Products with nothing recorded keep the old
 * share-out, so a shop can adopt this one product at a time.
 *
 * WHY PER DAY
 * Boost budgets change daily and the report is read by date range. A single
 * number on the product row would restate last week's figures every time today's
 * budget changed — the report would stop being a record of what happened.
 */
export const productAdSpend = pgTable(
  "product_ad_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /**
     * A calendar day, not a timestamp.
     *
     * This is a budget somebody set for a day, not an event at an instant, and
     * a `date` cannot drift across a timezone boundary the way a timestamp can.
     */
    spentOn: date("spent_on").notNull(),

    amount: integer("amount").notNull().default(0),
    note: text("note").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    /* One figure per product per day: entering it twice corrects it rather than
       doubling it, which is the same rule the shop-wide ledger follows. */
    uniqueIndex("product_ad_spend_product_day_idx").on(table.productId, table.spentOn),
    index("product_ad_spend_day_idx").on(table.spentOn),

    check("product_ad_spend_amount_non_negative", sql`${table.amount} >= 0`),
  ],
);

export type ProductAdSpendRow = typeof productAdSpend.$inferSelect;
export type NewProductAdSpendRow = typeof productAdSpend.$inferInsert;
