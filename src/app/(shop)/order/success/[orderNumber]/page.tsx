import type { Metadata } from "next";
import { getSettings } from "@/lib/data/settings";
import { copy } from "@/lib/copy";
import { Container } from "@/components/ui/Layout";
import { OrderConfirmation } from "@/components/checkout/OrderConfirmation";

export const metadata: Metadata = {
  title: copy.success.heading,
  /* Never indexed: a confirmation page in search results would be both useless
     and a privacy problem. */
  robots: { index: false, follow: false },
};

/**
 * Order confirmation.
 *
 * Keyed on the order NUMBER rather than an internal id, so the URL shows the
 * customer the reference they will be asked for on the phone.
 *
 * There is no order lookup here. Nothing is fetched about the order at all —
 * the number comes from the route and the itemised summary from the stash
 * checkout left in the browser. That is deliberate: a page that fetched an
 * order by its number alone would let anyone read other people's orders by
 * incrementing a digit.
 */
export default async function OrderSuccessPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const [{ orderNumber }, settings] = await Promise.all([params, getSettings()]);

  return (
    <Container className="flex flex-col items-center py-10 text-center">
      <OrderConfirmation
        orderNumber={decodeURIComponent(orderNumber)}
        hotline={settings.hotline}
      />
    </Container>
  );
}
