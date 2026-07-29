import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  productVariants,
  type NewProductVariantRow,
  type ProductVariantRow,
} from "../../db/schema/product-variants.js";

/** Variant data access. */

export async function listVariants(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductVariantRow[]> {
  return executor
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.price));
}

export async function findVariantById(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductVariantRow | undefined> {
  const rows = await executor
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, id))
    .limit(1);
  return rows[0];
}

/** SKUs are globally unique across products — see the note on the table. */
export async function variantSkuExists(
  sku: string,
  excludeId?: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const match = sql`lower(${productVariants.sku}) = ${sku.toLowerCase()}`;

  const rows = await executor
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(excludeId ? and(match, ne(productVariants.id, excludeId)) : match)
    .limit(1);

  return rows.length > 0;
}

export async function insertVariants(
  input: NewProductVariantRow[],
  executor: DatabaseExecutor = getDb(),
): Promise<ProductVariantRow[]> {
  if (input.length === 0) return [];
  /* One multi-row INSERT rather than a loop — creating a phone with nine
     colour/storage combinations should be one statement. */
  return executor.insert(productVariants).values(input).returning();
}

export async function updateVariantRow(
  id: string,
  patch: Partial<NewProductVariantRow>,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductVariantRow | undefined> {
  const rows = await executor
    .update(productVariants)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(productVariants.id, id))
    .returning();
  return rows[0];
}

export async function deleteVariantRow(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const rows = await executor
    .delete(productVariants)
    .where(eq(productVariants.id, id))
    .returning({ id: productVariants.id });
  return rows.length === 1;
}

export async function deleteVariantsForProduct(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const rows = await executor
    .delete(productVariants)
    .where(eq(productVariants.productId, productId))
    .returning({ id: productVariants.id });
  return rows.length;
}
