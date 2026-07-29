import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { categories, type CategoryRow, type NewCategoryRow } from "../../db/schema/categories.js";
import { products } from "../../db/schema/products.js";

/**
 * Category data access.
 *
 * The only module permitted to reference the `categories` table.
 */

export interface CategoryWithCount {
  category: CategoryRow;
  productCount: number;
}

/**
 * Lists categories with their product counts.
 *
 * A LEFT JOIN with GROUP BY rather than N+1 counts — the category rail is on
 * every page of the storefront, and it must be one query regardless of how
 * many categories exist.
 *
 * `onlyActive` also constrains the counted products to publicly visible ones,
 * so a storefront chip never advertises "12 products" and then shows 3.
 */
export async function listCategories(
  options: { onlyActive?: boolean } = {},
  executor: DatabaseExecutor = getDb(),
): Promise<CategoryWithCount[]> {
  const onlyActive = options.onlyActive ?? false;

  const productPredicate = onlyActive
    ? and(eq(products.status, "active"), eq(products.isVisible, true))
    : undefined;

  const rows = await executor
    .select({
      category: categories,
      productCount: count(products.id),
    })
    .from(categories)
    .leftJoin(
      products,
      productPredicate
        ? and(eq(products.categoryId, categories.id), productPredicate)
        : eq(products.categoryId, categories.id),
    )
    .where(onlyActive ? eq(categories.isActive, true) : undefined)
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  return rows;
}

export async function findCategoryById(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<CategoryRow | undefined> {
  const rows = await executor.select().from(categories).where(eq(categories.id, id)).limit(1);
  return rows[0];
}

export async function findCategoryBySlug(
  slug: string,
  executor: DatabaseExecutor = getDb(),
): Promise<CategoryRow | undefined> {
  const rows = await executor
    .select()
    .from(categories)
    .where(sql`lower(${categories.slug}) = ${slug.toLowerCase()}`)
    .limit(1);
  return rows[0];
}

/** Case-insensitive existence check, optionally excluding one row (for update). */
export async function categoryFieldExists(
  field: "slug" | "name",
  value: string,
  excludeId?: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const column = field === "slug" ? categories.slug : categories.name;

  const rows = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(
      excludeId
        ? and(sql`lower(${column}) = ${value.toLowerCase()}`, ne(categories.id, excludeId))
        : sql`lower(${column}) = ${value.toLowerCase()}`,
    )
    .limit(1);

  return rows.length > 0;
}

export async function insertCategory(
  input: NewCategoryRow,
  executor: DatabaseExecutor = getDb(),
): Promise<CategoryRow> {
  const rows = await executor.insert(categories).values(input).returning();
  const created = rows[0];
  if (!created) throw new Error("Insert into categories returned no row");
  return created;
}

export async function updateCategoryRow(
  id: string,
  patch: Partial<NewCategoryRow>,
  executor: DatabaseExecutor = getDb(),
): Promise<CategoryRow | undefined> {
  const rows = await executor
    .update(categories)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(categories.id, id))
    .returning();
  return rows[0];
}

export async function deleteCategoryRow(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const rows = await executor
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  return rows.length === 1;
}

/** Products in a category, regardless of status. Guards deletion. */
export async function countProductsInCategory(
  categoryId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(products)
    .where(eq(products.categoryId, categoryId));
  return rows[0]?.total ?? 0;
}

/**
 * Applies a new display order in one statement.
 *
 * Built as a single UPDATE ... FROM (VALUES ...) rather than a loop of
 * updates: reordering ten categories should be one round trip, and doing it
 * atomically means a failure cannot leave a half-applied order.
 */
export async function applyCategoryOrder(
  order: { id: string; sortOrder: number }[],
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  if (order.length === 0) return 0;

  const values = sql.join(
    order.map((entry) => sql`(${entry.id}::uuid, ${entry.sortOrder}::int)`),
    sql`, `,
  );

  const result = await executor.execute(sql`
    update ${categories} as c
    set sort_order = v.sort_order, updated_at = now()
    from (values ${values}) as v(id, sort_order)
    where c.id = v.id
  `);

  return result.rowCount ?? order.length;
}
