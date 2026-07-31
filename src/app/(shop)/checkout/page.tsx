import type { Metadata } from "next";
import { Suspense } from "react";
import { getSettings } from "@/lib/data/settings";
import { copy } from "@/lib/copy";
import { Container, Skeleton } from "@/components/ui/Layout";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";

export const metadata: Metadata = {
  title: copy.checkout.title,
  robots: { index: false, follow: false },
};

/**
 * Checkout.
 *
 * Settings are passed in for the zone selector's displayed charges; every
 * figure the customer actually pays comes from the API's quote endpoint at
 * render time and is recomputed again at order placement.
 */
export default async function CheckoutPage() {
  const settings = await getSettings();

  return (
    <Container className="py-6 pb-32 lg:pb-10">
      <h1 className="mb-5 text-display text-ink">{copy.checkout.title}</h1>

      {/* CheckoutForm reads `mode=buynow` via useSearchParams. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <CheckoutForm settings={settings} />
      </Suspense>
    </Container>
  );
}
