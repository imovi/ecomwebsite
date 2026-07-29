import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getAllProducts,
  getProductBySlug,
  getRelatedProducts,
} from "@/lib/data/catalog";
import { minPrice, totalStock } from "@/lib/catalog-utils";
import { copy } from "@/lib/copy";
import { Container, Divider, SectionHeader } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";
import { ProductPurchase } from "@/components/product/ProductPurchase";
import { ProductRail } from "@/components/product/ProductCard";

/** Statically rendered, refreshed every 5 minutes. Prices and stock still get
 *  re-validated server-side at order placement, so a slightly stale page can
 *  never produce a wrong order. */
export const revalidate = 300;

export async function generateStaticParams() {
  const products = await getAllProducts();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: copy.common.notFoundTitle };

  const description = product.description.slice(0, 155);

  return {
    title: product.title,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: product.title,
      description,
      type: "website",
      images: [{ url: product.images[0], width: 400, height: 400, alt: product.title }],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const related = await getRelatedProducts(product);
  const inStock = totalStock(product) > 0;

  /* Product structured data. Reviews are deliberately absent from the store,
     so no aggregateRating is emitted — claiming one without reviews is exactly
     the kind of thing that gets rich results revoked. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    image: product.images,
    description: product.description,
    brand: { "@type": "Brand", name: product.brand },
    sku: product.variants[0]?.sku ?? product.id,
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: minPrice(product),
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: `https://gng.com.bd/product/${product.slug}`,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Container className="pb-10 pt-5">
        <ProductPurchase product={product} />
      </Container>

      <Container className="flex flex-col gap-8 pb-4">
        <Divider />

        <section>
          <h2 className="text-title text-ink">{copy.product.description}</h2>
          <p className="mt-3 max-w-2xl whitespace-pre-line text-body leading-relaxed text-ink-soft">
            {product.description}
          </p>
        </section>

        <section>
          <h2 className="text-title text-ink">{copy.product.specifications}</h2>
          <dl className="mt-3 max-w-2xl">
            {product.specs.map((spec, i) => (
              <div
                key={spec.label}
                className={`flex gap-4 py-2.5 text-caption ${
                  i > 0 ? "border-t border-line" : ""
                }`}
              >
                <dt className="w-32 shrink-0 text-muted sm:w-40">{spec.label}</dt>
                <dd className="min-w-0 flex-1 text-ink-soft">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h2 className="text-title text-ink">{copy.product.included}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {product.included.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-body text-ink-soft">
                <Icon
                  name="check"
                  size={16}
                  className="mt-1 shrink-0 text-positive"
                />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </Container>

      {related.length > 0 && (
        <Container className="mt-12">
          <SectionHeader title={copy.product.related} className="mb-4" />
          <ProductRail products={related} />
        </Container>
      )}
    </>
  );
}
