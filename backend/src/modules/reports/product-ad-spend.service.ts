import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { productAdSpend } from "../../db/schema/product-ad-spend.js";
import { products } from "../../db/schema/products.js";
import { NotFoundError } from "../../core/errors.js";

/**
 * Money spent boosting one product on one day.
 *
 * WHY THIS IS SEPARATE FROM THE EXPENSE LEDGER
 * The ledger records "৳2,000 on ads today" for the shop, and the profit report
 * splits that across products by share of revenue. That split is an inference,
 * and it is worst exactly where it matters most: a product selling BECAUSE it is
 * boosted gets charged in proportion to the sales the boost created, which
 * flatters it and overcharges everything else.
 *
 * A figure here is a fact. The report attributes it exactly and adds it to the
 * expense total under its own heading, rather than folding it into the ads line.
 *
 * THE ONE RULE FOR WHOEVER USES THIS
 * Record a boost here OR in the general ads expense — never both, or the same
 * taka is counted twice. The panel says so where the figure is entered.
 */

export interface ProductAdSpendDto {
  id: string;
  productId: string;
  productName: string;
  spentOn: string;
  amount: number;
  note: string;
}

export async function listForRange(
  range: { from: string; to: string },
  productId?: string,
): Promise<ProductAdSpendDto[]> {
  const conditions = [
    gte(productAdSpend.spentOn, range.from),
    lte(productAdSpend.spentOn, range.to),
    ...(productId ? [eq(productAdSpend.productId, productId)] : []),
  ];

  const rows = await getDb()
    .select({
      id: productAdSpend.id,
      productId: productAdSpend.productId,
      productName: products.name,
      spentOn: productAdSpend.spentOn,
      amount: productAdSpend.amount,
      note: productAdSpend.note,
    })
    .from(productAdSpend)
    .innerJoin(products, eq(productAdSpend.productId, products.id))
    .where(and(...conditions))
    .orderBy(desc(productAdSpend.spentOn));

  return rows;
}

/** Totals per product across a range, for the profit report. */
export async function totalsForRange(range: {
  from: string;
  to: string;
}): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({
      productId: productAdSpend.productId,
      total: sql<number>`coalesce(sum(${productAdSpend.amount}), 0)`.mapWith(Number),
    })
    .from(productAdSpend)
    .where(and(gte(productAdSpend.spentOn, range.from), lte(productAdSpend.spentOn, range.to)))
    .groupBy(productAdSpend.productId);

  return new Map(rows.map((row) => [row.productId, row.total]));
}

/**
 * Records what was spent on a product for a day.
 *
 * An upsert, not an insert: a daily budget is entered by hand and corrected
 * often, and a second entry for the same day should fix the figure rather than
 * double it. Same rule the shop-wide ledger follows.
 */
export async function record(input: {
  productId: string;
  spentOn: string;
  amount: number;
  note?: string;
}): Promise<ProductAdSpendDto> {
  const exists = await getDb()
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);

  const product = exists[0];
  if (!product) throw new NotFoundError("Product not found.");

  const rows = await getDb()
    .insert(productAdSpend)
    .values({
      productId: input.productId,
      spentOn: input.spentOn,
      amount: input.amount,
      note: input.note ?? "",
    })
    .onConflictDoUpdate({
      target: [productAdSpend.productId, productAdSpend.spentOn],
      set: {
        amount: input.amount,
        note: input.note ?? "",
        updatedAt: sql`now()`,
      },
    })
    .returning();

  const row = rows[0]!;

  return {
    id: row.id,
    productId: row.productId,
    productName: product.name,
    spentOn: row.spentOn,
    amount: row.amount,
    note: row.note,
  };
}

export async function remove(id: string): Promise<void> {
  await getDb().delete(productAdSpend).where(eq(productAdSpend.id, id));
}
