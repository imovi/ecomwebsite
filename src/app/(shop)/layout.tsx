import { Header } from "@/components/shop/Header";
import { Footer } from "@/components/shop/Footer";
import { WhatsAppButton } from "@/components/shop/WhatsAppButton";
import { getSettings } from "@/lib/data/orders";

/**
 * Storefront shell. The admin panel lives in its own route group with its own
 * chrome, so neither has to defensively hide the other's UI.
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
    </>
  );
}
