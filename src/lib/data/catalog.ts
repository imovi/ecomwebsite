import "server-only";

import { headers } from "next/headers";
import { apiRequestOptional, apiRequestSafe, query } from "@/lib/api/client";
import { forwardClientHints } from "@/lib/api/client-hints";
import { toBanner, toCategory, toProduct, toProductFromListItem } from "@/lib/api/adapters";
import type {
  ApiBanner,
  ApiCategory,
  ApiFacets,
  ApiProduct,
  ApiProductListItem,
} from "@/lib/api/types";
import type { Banner, Category, Product } from "@/types";

/**
 * Catalog reads, backed by the API.
 *
 * The function signatures are unchanged from the mock implementation this
 * replaced — that was the point of putting a repository layer here in the
 * first place. No page or component was modified to switch data sources.
 *
 * Sorting, filtering, search ranking and trending all happen in Postgres now
 * rather than in JavaScript. Anything this file still computes locally is
 * called out where it happens.
 */

/**
 * Cache tags, so an admin edit can revalidate exactly what it changed.
 *
 * The single source of truth for these strings: the reads below attach them, and
 * `src/app/api/admin/[...path]/route.ts` drops them after a write. A tag spelled
 * differently in those two places fails silently — the storefront just keeps
 * serving stale data — so nothing should hardcode these strings.
 */
export const CACHE_TAGS = {
  categories: "categories",
  products: "products",
  product: (slug: string) => `product:${slug}`,
  settings: "settings",
  banners: "banners",
} as const;

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function getCategories(): Promise<Category[]> {
  /* The category rail is on every page. A failure here should cost the rail,
     not the whole page. */
  const data = await apiRequestSafe<{ categories: ApiCategory[] }>(
    "/api/v1/categories",
    { categories: [] },
    { tags: [CACHE_TAGS.categories] },
  );

  return data.categories.map(toCategory);
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const data = await apiRequestOptional<{ category: ApiCategory }>(
    `/api/v1/categories/${encodeURIComponent(slug)}`,
    { tags: [CACHE_TAGS.categories] },
  );

  return data ? toCategory(data.category) : null;
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

/** Page size used wherever the storefront wants "everything visible". */
const LISTING_PAGE_SIZE = 100;

export async function getAllProducts(): Promise<Product[]> {
  const data = await apiRequestSafe<ApiProductListItem[]>(
    `/api/v1/products${query({ perPage: LISTING_PAGE_SIZE, sort: "newest" })}`,
    [],
    { tags: [CACHE_TAGS.products] },
  );

  return data.map(toProductFromListItem);
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const data = await apiRequestOptional<{ product: ApiProduct }>(
    `/api/v1/products/${encodeURIComponent(slug)}`,
    { tags: [CACHE_TAGS.products, CACHE_TAGS.product(slug)] },
  );

  return data ? toProduct(data.product) : null;
}

export async function getProductById(id: string): Promise<Product | null> {
  /* The API resolves a uuid or a slug on the same route. */
  return getProductBySlug(id);
}

/** Takes a category id — callers resolve the slug to a category first. */
export async function getProductsByCategory(
  categoryId: string,
  sort: "newest" | "price_asc" | "price_desc" = "newest",
): Promise<Product[]> {
  const data = await apiRequestSafe<ApiProductListItem[]>(
    `/api/v1/products${query({
      categoryId,
      sort,
      perPage: LISTING_PAGE_SIZE,
    })}`,
    [],
    { tags: [CACHE_TAGS.products] },
  );

  return data.map(toProductFromListItem);
}

export async function getNewArrivals(limit = 8): Promise<Product[]> {
  const data = await apiRequestSafe<{ products: ApiProductListItem[] }>(
    `/api/v1/products/new-arrivals${query({ limit })}`,
    { products: [] },
    { tags: [CACHE_TAGS.products] },
  );

  return data.products.map(toProductFromListItem);
}

/**
 * Trending.
 *
 * The decay-weighted popularity score is computed and indexed in Postgres and
 * refreshed on a schedule, so this is a single ordered read rather than the
 * in-memory scoring the mock implementation did. It is still driven purely by
 * measured demand — there is no way to pin a product here.
 */
export async function getTrending(limit = 8): Promise<Product[]> {
  const data = await apiRequestSafe<{ products: ApiProductListItem[] }>(
    `/api/v1/products/trending${query({ limit })}`,
    { products: [] },
    { tags: [CACHE_TAGS.products] },
  );

  return data.products.map(toProductFromListItem);
}

/**
 * Related products.
 *
 * Asks the API for the same category and drops the current product. Price
 * proximity ranking lives server-side in the catalogue module; this only needs
 * to avoid recommending the page you are already on.
 */
export async function getRelatedProducts(product: Product, limit = 6): Promise<Product[]> {
  if (!product.categoryId) return [];

  const data = await apiRequestSafe<ApiProductListItem[]>(
    `/api/v1/products${query({
      categoryId: product.categoryId,
      perPage: limit + 1,
      sort: "trending",
    })}`,
    [],
    { tags: [CACHE_TAGS.products] },
  );

  return data
    .filter((item) => item.id !== product.id)
    .slice(0, limit)
    .map(toProductFromListItem);
}

export async function searchProducts(searchQuery: string): Promise<Product[]> {
  const trimmed = searchQuery.trim();
  if (trimmed.length < 2) return [];

  /* Search results must never be served stale — a shopper searching for
     something that just sold out should see that.

     That freshness is also what makes this the cheapest way to make the shop do
     work: every distinct `?q=` is a full-text query that no cache absorbs, and
     the API exempts this server from its global limit precisely because it is
     infrastructure. So the shopper's own address travels with the request and
     the API bounds it per visitor — see the limiter on `/products/search`.
     Without the address that limit would be one allowance for the whole shop,
     which is worse than none: the first script to find it takes search away
     from every real customer. */
  const data = await apiRequestSafe<ApiProductListItem[]>(
    `/api/v1/products/search${query({ q: trimmed, perPage: 50 })}`,
    [],
    { revalidate: 0, headers: forwardClientHints(await headers()) },
  );

  return data.map(toProductFromListItem);
}

/** Brands and the price range of the visible catalogue, for filter UI. */
export async function getCatalogFacets(categoryId?: string): Promise<ApiFacets> {
  return apiRequestSafe<ApiFacets>(
    `/api/v1/products/facets${query({ categoryId })}`,
    { brands: [], priceRange: { min: 0, max: 0 } },
    { tags: [CACHE_TAGS.products] },
  );
}

/* -------------------------------------------------------------------------- */
/* Merchandising                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Homepage banners.
 *
 * Backed by the API and managed from the admin panel. They used to be a static
 * file that needed a deploy to change, which is unusable for a shop owner
 * running a weekend campaign.
 *
 * Nothing outside this function changed when the source moved — the repository
 * seam was put here for exactly this.
 */
export async function getBanners(): Promise<Banner[]> {
  /* Safe-with-fallback rather than required: an empty banner rail is a slightly
     plainer homepage, whereas a thrown error is no homepage at all. The rail is
     decoration, not the shop. */
  const data = await apiRequestSafe<{ banners: ApiBanner[] }>(
    "/api/v1/banners",
    { banners: [] },
    { tags: [CACHE_TAGS.banners] },
  );

  /* The API already filters to active and sorts by `sortOrder`. */
  return data.banners.map(toBanner);
}

