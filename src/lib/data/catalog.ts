import "server-only";

import { categories } from "@/data/categories";
import { products } from "@/data/products";
import { orders } from "@/data/orders";
import { banners } from "@/data/store";
import type { Category, Product, Variant, Banner } from "@/types";

/**
 * Catalog repository.
 *
 * Every function is async and returns plain data even though the current
 * backing store is an in-memory array. That keeps call sites identical when
 * these bodies become Prisma queries — the seam is here and nowhere else.
 */

const activeOnly = (p: Product) => p.status === "active";

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function getCategories(): Promise<Category[]> {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  return categories.find((c) => c.slug === slug) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

export async function getAllProducts(): Promise<Product[]> {
  return products.filter(activeOnly);
}

/** Includes drafts and archived — admin only. */
export async function getAllProductsForAdmin(): Promise<Product[]> {
  return [...products];
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  return products.find((p) => p.slug === slug && activeOnly(p)) ?? null;
}

export async function getProductById(id: string): Promise<Product | null> {
  return products.find((p) => p.id === id) ?? null;
}

export async function getProductsByCategory(
  categoryId: string,
  sort: "newest" | "price_asc" | "price_desc" = "newest",
): Promise<Product[]> {
  const list = products.filter((p) => activeOnly(p) && p.categoryId === categoryId);

  switch (sort) {
    case "price_asc":
      return list.sort((a, b) => minPrice(a) - minPrice(b));
    case "price_desc":
      return list.sort((a, b) => minPrice(b) - minPrice(a));
    default:
      return list.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }
}

export async function getNewArrivals(limit = 8): Promise<Product[]> {
  return [...products]
    .filter(activeOnly)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Trending.
 *
 * Two decisions worth keeping when this moves to SQL:
 *
 *  1. Only DELIVERED orders count. On a cash-on-delivery store, counting
 *     *placed* orders means refused and prank orders decide what the homepage
 *     promotes.
 *  2. Exponential time decay (14-day half-life) so one large historical order
 *     can't pin a product to the top forever.
 *
 * `pinnedRank` always outranks the computed score — needed on day one when
 * there is no sales history at all, and during campaigns.
 */
export async function getTrending(limit = 8): Promise<Product[]> {
  const HALF_LIFE_DAYS = 14;
  const now = Date.now();
  const scores = new Map<string, number>();

  for (const order of orders) {
    if (order.status !== "delivered") continue;
    const daysAgo = (now - new Date(order.createdAt).getTime()) / 86_400_000;
    const weight = Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
    for (const item of order.items) {
      scores.set(item.productId, (scores.get(item.productId) ?? 0) + item.qty * weight);
    }
  }

  return [...products]
    .filter(activeOnly)
    .sort((a, b) => {
      // Pinned products first, in pin order.
      if (a.pinnedRank != null || b.pinnedRank != null) {
        return (a.pinnedRank ?? Infinity) - (b.pinnedRank ?? Infinity);
      }
      const diff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
      // Cold-start fallback: newest wins when nothing has sold yet.
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, limit);
}

export async function getRelatedProducts(
  product: Product,
  limit = 6,
): Promise<Product[]> {
  const sameCategory = products.filter(
    (p) => activeOnly(p) && p.categoryId === product.categoryId && p.id !== product.id,
  );

  // Closest price first — a customer looking at a ৳150k laptop is not served
  // by a ৳900 cable, even though they share a category in some stores.
  const target = minPrice(product);
  return sameCategory
    .sort((a, b) => Math.abs(minPrice(a) - target) - Math.abs(minPrice(b) - target))
    .slice(0, limit);
}

export async function searchProducts(query: string): Promise<Product[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const terms = q.split(/\s+/);

  return products
    .filter(activeOnly)
    .map((p) => {
      const haystack =
        `${p.title} ${p.brand} ${p.specs.map((s) => s.value).join(" ")}`.toLowerCase();
      // Title matches outrank spec matches; all terms must appear somewhere.
      const matchesAll = terms.every((t) => haystack.includes(t));
      if (!matchesAll) return null;
      const titleHits = terms.filter((t) => p.title.toLowerCase().includes(t)).length;
      return { product: p, score: titleHits };
    })
    .filter((r): r is { product: Product; score: number } => r !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.product);
}

/* -------------------------------------------------------------------------- */
/* Merchandising                                                              */
/* -------------------------------------------------------------------------- */

export async function getBanners(): Promise<Banner[]> {
  return banners.filter((b) => b.active).sort((a, b) => a.sortOrder - b.sortOrder);
}

/* -------------------------------------------------------------------------- */
/* Shared helpers (safe on the client too — see lib/catalog-utils)            */
/* -------------------------------------------------------------------------- */

function minPrice(product: Product): number {
  if (!product.variants.length) return product.price;
  return Math.min(...product.variants.map((v: Variant) => v.price));
}
