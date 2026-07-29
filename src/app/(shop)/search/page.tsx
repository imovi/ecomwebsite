import type { Metadata } from "next";
import { searchProducts } from "@/lib/data/catalog";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Container, EmptyState } from "@/components/ui/Layout";
import { ProductGrid } from "@/components/product/ProductCard";

/** Search results should never be indexed — they're thin, infinite and
 *  duplicate the category pages. */
export const metadata: Metadata = {
  title: copy.search.title,
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const products = query ? await searchProducts(query) : [];

  return (
    <Container className="py-6">
      <h1 className="text-display text-ink">
        {query ? copy.search.resultsFor(query) : copy.search.title}
      </h1>

      {query && products.length > 0 && (
        <p className="mt-0.5 text-caption text-muted">
          {copy.search.countResults(products.length)}
        </p>
      )}

      <div className="mt-6">
        {products.length > 0 ? (
          <ProductGrid products={products} priorityCount={2} />
        ) : query ? (
          <EmptyState
            icon="search"
            title={copy.search.noResults(query)}
            body={copy.search.noResultsHint}
          >
            <Button href="/category/all" variant="secondary">
              {copy.cart.emptyAction}
            </Button>
          </EmptyState>
        ) : null}
      </div>
    </Container>
  );
}
