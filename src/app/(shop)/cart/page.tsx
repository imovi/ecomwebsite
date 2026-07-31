import type { Metadata } from "next";
import { copy } from "@/lib/copy";
import { Container } from "@/components/ui/Layout";
import { CartView } from "@/components/cart/CartView";

export const metadata: Metadata = {
  title: copy.cart.title,
  robots: { index: false, follow: false },
};

/**
 * Cart.
 *
 * A shell only. The cart lives in the browser, so its contents are resolved
 * against the API by a server action once the client knows what they are —
 * shipping the whole catalogue down to resolve two lines would be both slower
 * and, because listing rows carry no real variant ids, wrong.
 */
export default function CartPage() {
  return (
    <Container className="py-6 pb-32 md:pb-6">
      <h1 className="mb-4 text-display text-ink">{copy.cart.title}</h1>
      <CartView />
    </Container>
  );
}
