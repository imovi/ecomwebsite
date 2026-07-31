import { Header } from "@/components/shop/Header";
import { Footer } from "@/components/shop/Footer";
import { WhatsAppButton } from "@/components/shop/WhatsAppButton";
import { FloatingCart } from "@/components/shop/FloatingCart";
import { getSettings } from "@/lib/data/settings";
import { MetaPixel } from "@/lib/analytics/pixel";
import { GoogleTagManager } from "@/lib/analytics/gtm";

/**
 * Storefront shell. The admin panel lives in its own route group with its own
 * chrome, so neither has to defensively hide the other's UI.
 *
 * The Meta Pixel and GTM are mounted HERE rather than in the root layout: from the
 * root they would also load on `/admin`, and an owner working the order queue
 * would spend the day sending PageView and ViewContent events about their own
 * catalogue — teaching the ad algorithm to target people who behave like the
 * shopkeeper, and inflating their own GA4 numbers.
 */
export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSettings();

  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppButton phone={settings.whatsappNumber} />
      <FloatingCart />
      <MetaPixel />
      <GoogleTagManager />
    </>
  );
}
