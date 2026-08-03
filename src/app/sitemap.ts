import type { MetadataRoute } from "next";
import { getAllProducts, getCategories } from "@/lib/data/catalog";
import { policies } from "@/data/policies";
import { siteConfig } from "@/lib/api/config";

/**
 * The deployment's own origin, not a compiled-in one.
 *
 * This was a fixed domain, which meant every URL a search engine read here
 * pointed at a site this deployment is not — the one place where being wrong is
 * both invisible on screen and expensive.
 */
const BASE = siteConfig.url;

/**
 * Only pages worth indexing. Cart, checkout, order confirmation and search
 * results are excluded — they're either private, thin, or infinite.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([
    getAllProducts(),
    getCategories(),
  ]);

  return [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/category/all`, changeFrequency: "daily", priority: 0.8 },
    { url: `${BASE}/track`, changeFrequency: "monthly", priority: 0.4 },

    ...categories.map((category) => ({
      url: `${BASE}/category/${category.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),

    ...products.map((product) => ({
      url: `${BASE}/product/${product.slug}`,
      lastModified: new Date(product.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),

    ...policies.map((policy) => ({
      url: `${BASE}/policies/${policy.slug}`,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
