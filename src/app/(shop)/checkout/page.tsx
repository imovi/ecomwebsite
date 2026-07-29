import type { Metadata } from "next";
import { Suspense } from "react";
import { getAllProducts } from "@/lib/data/catalog";
import { getSettings } from "@/lib/data/orders";
import { toCatalogMap } from "@/lib/catalog-utils";
import { copy } from "@/lib/copy";
import { Container, Skeleton } from "@/components/ui/Layout";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";

export const metadata: Metadata = {
  title: copy.checkout.title,
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const [products, settings] = await Promise.all([getAllProducts(), getSettings()]);

  return (
    <Container className="py-6 pb-32 lg:pb-10">
      <h1 className="mb-5 text-display text-ink">{copy.checkout.title}</h1>

      {/* CheckoutForm reads `mode=buynow` via useSearchParams. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <CheckoutForm catalog={toCatalogMap(products)} settings={settings} />
      </Suspense>
    </Container>
  );
}
