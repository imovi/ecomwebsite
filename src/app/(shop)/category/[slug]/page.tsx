import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  getAllProducts,
  getCategories,
  getCategoryBySlug,
  getProductsByCategory,
} from "@/lib/data/catalog";
import { minPrice } from "@/lib/catalog-utils";
import { copy } from "@/lib/copy";
import { Container, EmptyState } from "@/components/ui/Layout";
import { ProductGrid } from "@/components/product/ProductCard";
import { CategoryRail } from "@/components/home/CategoryRail";
import { SortSelect } from "@/components/shop/SortSelect";
import type { Product } from "@/types";

export const revalidate = 300;

type Sort = "newest" | "price_asc" | "price_desc";

/** `all` is a virtual category so "View all" from the homepage has somewhere
 *  to land without inventing a separate /products route. */
const ALL = "all";

export async function generateStaticParams() {
  const categories = await getCategories();
  return [{ slug: ALL }, ...categories.map((c) => ({ slug: c.slug }))];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (slug === ALL) {
    return {
      title: "All Products — Smart Gadgets & Lifestyle Store in BD",
      description:
        "Explore all smart gadgets, rechargeable LED lights, lifestyle accessories and everyday tech essentials in Bangladesh. Best prices with cash on delivery at HINAR.",
      alternates: { canonical: "/category/all" },
      openGraph: {
        title: "All Products — Smart Gadgets & Lifestyle Store in BD | HINAR",
        description:
          "Explore all smart gadgets, rechargeable LED lights, lifestyle accessories and everyday tech essentials in Bangladesh. Best prices with cash on delivery at HINAR.",
      },
    };
  }

  const category = await getCategoryBySlug(slug);
  if (!category) return { title: copy.common.notFoundTitle };

  return {
    title: `${category.name} Price in BD`,
    description: `Shop original ${category.name.toLowerCase()} at best prices in Bangladesh. Enjoy fast nationwide cash on delivery, easy returns & genuine quality from HINAR.`,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: {
      title: `${category.name} in Bangladesh | HINAR`,
      description: `Shop original ${category.name.toLowerCase()} at best prices in Bangladesh with cash on delivery.`,
    },
  };
}

function sortProducts(products: Product[], sort: Sort): Product[] {
  switch (sort) {
    case "price_asc":
      return [...products].sort((a, b) => minPrice(a) - minPrice(b));
    case "price_desc":
      return [...products].sort((a, b) => minPrice(b) - minPrice(a));
    default:
      return [...products].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const [{ slug }, { sort }] = await Promise.all([params, searchParams]);
  const activeSort = (sort as Sort) ?? "newest";

  const categories = await getCategories();
  const category = slug === ALL ? null : await getCategoryBySlug(slug);
  if (slug !== ALL && !category) notFound();

  const products =
    slug === ALL
      ? sortProducts(await getAllProducts(), activeSort)
      : await getProductsByCategory(category!.id, activeSort);

  return (
    <div className="flex flex-col gap-6 py-5">
      <Container>
        <CategoryRail categories={categories} />
      </Container>

      <Container>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-display text-ink">
              {category?.name ?? "All products"}
            </h1>
            <p className="mt-0.5 text-caption text-muted">
              {copy.search.countResults(products.length)}
            </p>
          </div>
          {products.length > 1 && (
            /* useSearchParams needs a Suspense boundary during prerender. */
            <Suspense fallback={<div className="h-10 w-32" />}>
              <SortSelect />
            </Suspense>
          )}
        </div>

        {products.length > 0 ? (
          <ProductGrid products={products} priorityCount={2} />
        ) : (
          <EmptyState icon="grid" title={copy.category.empty} />
        )}
      </Container>
    </div>
  );
}
