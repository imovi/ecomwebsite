import type { Metadata } from "next";
import { getAllProducts } from "@/lib/data/catalog";
import { toCatalogMap } from "@/lib/catalog-utils";
import { copy } from "@/lib/copy";
import { Container } from "@/components/ui/Layout";
import { CartView } from "@/components/cart/CartView";

export const metadata: Metadata = {
  title: copy.cart.title,
  robots: { index: false, follow: false },
};

/**
 * The cart itself lives in the browser, but the *catalog* is rendered on the
 * server and handed down as a trimmed projection. That keeps prices and stock
 * authoritative without shipping the full product objects to the client.
 */
export default async function CartPage() {
  const products = await getAllProducts();

  return (
    <Container className="py-6 pb-32 md:pb-6">
      <h1 className="mb-4 text-display text-ink">{copy.cart.title}</h1>
      <CartView catalog={toCatalogMap(products)} />
    </Container>
  );
}
