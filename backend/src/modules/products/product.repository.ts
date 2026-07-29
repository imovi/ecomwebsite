import {
  and,
  arrayOverlaps,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import { categories, type CategoryRow } from "../../db/schema/categories.js";
import { products, type NewProductRow, type ProductRow } from "../../db/schema/products.js";
import { productImages, type ProductImageRow } from "../../db/schema/product-images.js";
import { productVariants, type ProductVariantRow } from "../../db/schema/product-variants.js";
import { productMetrics, type ProductMetricsRow } from "../../db/schema/product-metrics.js";
import type { ProductSort, ProductStatus, StockStatus } from "../../db/schema/catalog-enums.js";

/**
 * Product data access.
 *
 * The listing query is the hot path of the whole application, so it is built
 * as ONE statement that returns rows, the featured image and the total count
 * together:
 *
 *   - a LATERAL join picks each product's featured image (falling back to its
 *     first image) without an N+1 or a second round trip;
 *   - `count(*) over()` produces the total for pagination in the same pass,
 *     rather than a separate COUNT query that re-runs every filter;
 *   - `product_metrics` is joined 1:1 so `best_selling` and trending sorts
 *     need no extra query.
 *
 * Every ordering and filter column is index-backed — see `db/schema/products.ts`.
 */

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  categorySlug?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  stockStatus?: StockStatus;
  /** Convenience filter mapping to `stock_quantity > 0`. */
  inStockOnly?: boolean;
  tags?: string[];
  /** Admin only. Public reads are always constrained to published products. */
  status?: ProductStatus;
  onlyDiscounted?: boolean;
}

export interface ListProductsOptions {
  filters: ProductFilters;
  sort: ProductSort;
  page: number;
  perPage: number;
  /** `public` forces `status = 'active' and is_visible`. */
  scope: "public" | "admin";
}

export interface ProductListRow {
  product: ProductRow;
  category: Pick<CategoryRow, "id" | "name" | "slug"> | null;
  featuredImage: ProductImageRow | null;
  totalCount: number;
}

/* -------------------------------------------------------------------------- */
/* Predicates                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Builds the WHERE clause.
 *
 * Every value reaches SQL as a bound parameter — including the search term and
 * the brand list. Nothing here interpolates client input into the statement.
 */
function buildWhere(options: ListProductsOptions): SQL | undefined {
  const { filters, scope } = options;
  const conditions: (SQL | undefined)[] = [];

  if (scope === "public") {
    conditions.push(eq(products.status, "active"), eq(products.isVisible, true));
  } else if (filters.status) {
    conditions.push(eq(products.status, filters.status));
  }

  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));
  if (filters.categorySlug) {
    conditions.push(sql`lower(${categories.slug}) = ${filters.categorySlug.toLowerCase()}`);
  }

  if (filters.brands?.length) {
    /* Matches the lower(brand) index. */
    conditions.push(
      inArray(
        sql`lower(${products.brand})`,
        filters.brands.map((brand) => brand.toLowerCase()),
      ),
    );
  }

  if (filters.minPrice !== undefined) conditions.push(gte(products.price, filters.minPrice));
  if (filters.maxPrice !== undefined) conditions.push(lte(products.price, filters.maxPrice));

  if (filters.stockStatus) conditions.push(eq(products.stockStatus, filters.stockStatus));
  if (filters.inStockOnly) {
    conditions.push(sql`${products.stockQuantity} > 0`, eq(products.stockStatus, "in_stock"));
  }

  /* Array overlap (`&&`), index-backed by the GIN index on tags.
     `arrayOverlaps` binds a real array parameter — hand-writing
     `${tags}::text[]` binds the array as one text value and Postgres then
     rejects it as a malformed array literal. */
  if (filters.tags?.length) {
    conditions.push(arrayOverlaps(products.tags, filters.tags));
  }

  if (filters.onlyDiscounted) conditions.push(sql`${products.discountPercent} > 0`);

  if (filters.search) {
    conditions.push(searchPredicate(filters.search));
  }

  const defined = conditions.filter((condition): condition is SQL => condition !== undefined);
  return defined.length > 0 ? and(...defined) : undefined;
}

/**
 * Search predicate.
 *
 * `websearch_to_tsquery` accepts what people actually type — quoted phrases,
 * `or`, leading `-` for exclusion — and, unlike `to_tsquery`, never throws on
 * malformed input. That matters: a syntax error from a search box is a 500
 * caused by a user typing an apostrophe.
 *
 * The prefix branch exists because full-text search matches whole lexemes, so
 * "sam" would not find "Samsung". A bounded ILIKE prefix on name and SKU makes
 * type-ahead behave, while the GIN index still handles the general case.
 */
function searchPredicate(term: string): SQL {
  const trimmed = term.trim();
  const prefix = `${trimmed.replace(/[%_\\]/g, "\\$&")}%`;

  return or(
    sql`${products.searchVector} @@ websearch_to_tsquery('simple', ${trimmed})`,
    sql`${products.name} ILIKE ${prefix}`,
    sql`${products.sku} ILIKE ${prefix}`,
  )!;
}

/** Relevance, used only when a search term is present. */
function relevance(term: string): SQL<number> {
  return sql<number>`ts_rank(${products.searchVector}, websearch_to_tsquery('simple', ${term}))`;
}

/**
 * ORDER BY.
 *
 * A closed mapping from an enum to column expressions — a client string is
 * never interpolated. Every branch ends with a unique tiebreaker (`id`), so
 * pagination cannot repeat or skip a row when the sort key ties.
 */
function buildOrderBy(sort: ProductSort, search?: string): SQL[] {
  const tiebreak = sql`${products.id}`;

  if (search) {
    /* Relevance first whenever the user actually searched. */
    return [sql`${relevance(search)} desc`, sql`${products.createdAt} desc`, tiebreak];
  }

  switch (sort) {
    case "oldest":
      return [sql`${products.createdAt} asc`, tiebreak];
    case "price_asc":
      return [sql`${products.price} asc`, tiebreak];
    case "price_desc":
      return [sql`${products.price} desc`, tiebreak];
    case "name_asc":
      return [sql`${products.name} asc`, tiebreak];
    case "name_desc":
      return [sql`${products.name} desc`, tiebreak];
    case "discount":
      return [sql`${products.discountPercent} desc`, tiebreak];
    case "best_selling":
      /* Zero for everything until the orders module records sales; the
         secondary key keeps the ordering stable and useful meanwhile. */
      return [
        sql`coalesce(${productMetrics.unitsSold}, 0) desc`,
        sql`${products.createdAt} desc`,
        tiebreak,
      ];
    case "trending":
      /* Reads the precomputed score — no decay maths at request time. */
      return [
        sql`coalesce(${productMetrics.trendingScore}, 0) desc`,
        sql`${products.createdAt} desc`,
        tiebreak,
      ];
    case "newest":
    default:
      return [sql`${products.createdAt} desc`, tiebreak];
  }
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export async function listProducts(
  options: ListProductsOptions,
  executor: DatabaseExecutor = getDb(),
): Promise<{ rows: ProductListRow[]; total: number }> {
  const db = executor as ReturnType<typeof getDb>;
  const offset = (options.page - 1) * options.perPage;

  /* Correlated LATERAL subquery: the featured image, or the first image when
     none is flagged. One row per product, resolved inside the same scan. */
  const featured = db
    .select({
      id: productImages.id,
      productId: productImages.productId,
      storageKey: productImages.storageKey,
      alt: productImages.alt,
      width: productImages.width,
      height: productImages.height,
      size: productImages.size,
      mimeType: productImages.mimeType,
      checksum: productImages.checksum,
      isFeatured: productImages.isFeatured,
      sortOrder: productImages.sortOrder,
      createdAt: productImages.createdAt,
    })
    .from(productImages)
    .where(eq(productImages.productId, products.id))
    .orderBy(desc(productImages.isFeatured), asc(productImages.sortOrder))
    .limit(1)
    .as("featured_image");

  const rows = await db
    .select({
      product: products,
      category: {
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      },
      /* Columns are selected individually: Drizzle only allows a whole
         subquery to stand in for a single column. */
      featuredImage: {
        id: featured.id,
        productId: featured.productId,
        storageKey: featured.storageKey,
        alt: featured.alt,
        width: featured.width,
        height: featured.height,
        size: featured.size,
        mimeType: featured.mimeType,
        checksum: featured.checksum,
        isFeatured: featured.isFeatured,
        sortOrder: featured.sortOrder,
        createdAt: featured.createdAt,
      },
      /* Window function: the pre-LIMIT total, without a second COUNT query. */
      totalCount: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(productMetrics, eq(productMetrics.productId, products.id))
    .leftJoinLateral(featured, sql`true`)
    .where(buildWhere(options))
    .orderBy(...buildOrderBy(options.sort, options.filters.search))
    .limit(options.perPage)
    .offset(offset);

  return {
    rows: rows.map((row) => ({
      product: row.product,
      category: row.category,
      /* The LEFT JOIN yields all-null columns when a product has no images. */
      featuredImage: row.featuredImage?.id ? (row.featuredImage) : null,
      totalCount: row.totalCount,
    })),
    total: rows[0]?.totalCount ?? 0,
  };
}

export interface ProductDetail {
  product: ProductRow;
  category: CategoryRow | null;
  images: ProductImageRow[];
  variants: ProductVariantRow[];
  metrics: ProductMetricsRow | null;
}

/**
 * Full product detail in a single round trip.
 *
 * Drizzle's relational query compiles the `with` clauses into lateral joins
 * against one statement, so the busiest read in the catalogue costs one query
 * rather than four sequential ones.
 */
export async function findProductDetail(
  identifier: { id?: string; slug?: string },
  options: { scope: "public" | "admin" } = { scope: "public" },
  executor: DatabaseExecutor = getDb(),
): Promise<ProductDetail | undefined> {
  const db = executor as ReturnType<typeof getDb>;

  const identity = identifier.id
    ? eq(products.id, identifier.id)
    : sql`lower(${products.slug}) = ${(identifier.slug ?? "").toLowerCase()}`;

  const visibility =
    options.scope === "public"
      ? and(eq(products.status, "active"), eq(products.isVisible, true))
      : undefined;

  const row = await db.query.products.findFirst({
    where: visibility ? and(identity, visibility) : identity,
    with: {
      category: true,
      images: true,
      variants: true,
      metrics: true,
    },
  });

  if (!row) return undefined;

  return {
    product: row as unknown as ProductRow,
    category: row.category ?? null,
    images: row.images,
    variants: row.variants,
    metrics: row.metrics ?? null,
  };
}

export async function findProductById(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductRow | undefined> {
  const rows = await executor.select().from(products).where(eq(products.id, id)).limit(1);
  return rows[0];
}

/** Case-insensitive uniqueness probe, optionally excluding one row. */
export async function productFieldExists(
  field: "slug" | "sku",
  value: string,
  excludeId?: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const column = field === "slug" ? products.slug : products.sku;
  const match = sql`lower(${column}) = ${value.toLowerCase()}`;

  const rows = await executor
    .select({ id: products.id })
    .from(products)
    .where(excludeId ? and(match, ne(products.id, excludeId)) : match)
    .limit(1);

  return rows.length > 0;
}

export async function insertProduct(
  input: NewProductRow,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductRow> {
  const rows = await executor.insert(products).values(input).returning();
  const created = rows[0];
  if (!created) throw new Error("Insert into products returned no row");
  return created;
}

export async function updateProductRow(
  id: string,
  patch: Partial<NewProductRow>,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductRow | undefined> {
  const rows = await executor
    .update(products)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(products.id, id))
    .returning();
  return rows[0];
}

export async function deleteProductRow(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const rows = await executor
    .delete(products)
    .where(eq(products.id, id))
    .returning({ id: products.id });
  return rows.length === 1;
}

/* -------------------------------------------------------------------------- */
/* Facets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Filter facets: the distinct brands and the price range of the visible
 * catalogue. Lets a storefront build its filter UI without pulling every
 * product down to derive the options client-side.
 */
export async function getCatalogFacets(
  filters: { categoryId?: string } = {},
  executor: DatabaseExecutor = getDb(),
): Promise<{
  brands: { name: string; productCount: number }[];
  priceRange: { min: number; max: number };
}> {
  const visible = and(
    eq(products.status, "active"),
    eq(products.isVisible, true),
    filters.categoryId ? eq(products.categoryId, filters.categoryId) : undefined,
  );

  const [brandRows, rangeRows] = await Promise.all([
    executor
      .select({
        name: products.brand,
        productCount: sql<number>`count(*)`.mapWith(Number),
      })
      .from(products)
      .where(visible)
      .groupBy(products.brand)
      .orderBy(asc(products.brand)),
    executor
      .select({
        min: sql<number>`coalesce(min(${products.price}), 0)`.mapWith(Number),
        max: sql<number>`coalesce(max(${products.price}), 0)`.mapWith(Number),
      })
      .from(products)
      .where(visible),
  ]);

  return {
    brands: brandRows,
    priceRange: rangeRows[0] ?? { min: 0, max: 0 },
  };
}

/* -------------------------------------------------------------------------- */
/* Stock                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Recomputes a product's stock from its variants.
 *
 * `stock_quantity` on the product is a denormalised sum, so filtering and
 * sorting the catalogue by availability needs no aggregate join. It is
 * recalculated inside the same transaction as any variant change, so the two
 * can never disagree.
 *
 * Manual statuses (`pre_order`, `discontinued`) are merchandising decisions
 * and are left untouched.
 */
export async function syncProductStockFromVariants(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor.execute(sql`
    update ${products} p
    set stock_quantity = coalesce(v.total, 0),
        stock_status = case
          when p.stock_status in ('pre_order', 'discontinued') then p.stock_status
          when coalesce(v.total, 0) > 0 then 'in_stock'::stock_status
          else 'out_of_stock'::stock_status
        end,
        updated_at = now()
    from (
      select coalesce(sum(stock_quantity), 0) as total
      from ${productVariants}
      where product_id = ${productId} and is_active
    ) v
    where p.id = ${productId}
  `);
}
