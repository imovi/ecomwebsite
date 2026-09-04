import type { Metadata } from "next";
import {
  getBanners,
  getCategories,
  getNewArrivals,
  getTrending,
} from "@/lib/data/catalog";
import { getSettings } from "@/lib/data/settings";
import { copy } from "@/lib/copy";
import { Container, SectionHeader } from "@/components/ui/Layout";
import { BannerSlider } from "@/components/home/BannerSlider";
import { CategoryRail } from "@/components/home/CategoryRail";
import { TrendingSection } from "@/components/home/TrendingSection";
import { ProductGrid } from "@/components/product/ProductCard";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const name = settings.storeName || copy.brand.name;
  const title =
    settings.seoTitle ||
    `${name} — Online Gadget Shop & Smart Lifestyle Store in Bangladesh`;
  const description =
    settings.seoDescription ||
    "Shop smart gadgets, rechargeable desk lamps, unique lifestyle accessories & everyday electronics at best price in Bangladesh. Fast nationwide cash on delivery.";

  return {
    title: {
      absolute: title,
    },
    description,
    openGraph: {
      title,
      description,
    },
  };
}

/**
 * Six sections, no more:
 * logo + search (header), banner, categories, trending, new arrivals.
 *
 * Everything a shopper needs to either search, browse a category, or tap a
 * product is inside the first two screens. Nothing else earns its place.
 */
export default async function HomePage() {
  const [banners, categories, newArrivals, trending] = await Promise.all([
    getBanners(),
    getCategories(),
    getNewArrivals(8),
    getTrending(12),
  ]);

  return (
    <div className="flex flex-col gap-10 pb-4 pt-4">
      <Container>
        <BannerSlider banners={banners} />
      </Container>

      <Container>
        <CategoryRail categories={categories} />
      </Container>

      {/* Trending first, deliberately. What other people are buying sells
          harder than what arrived most recently — a shopper landing from an ad
          has no idea what is new here, but "everyone is buying this" needs no
          context. New arrivals still get a section; they just do not get the
          first one. */}
      <Container>
        <SectionHeader
          title={copy.home.trending}
          href="/category/all"
          action={copy.home.viewAll}
          className="mb-4"
        />
        <TrendingSection products={trending} initialCount={4} />
      </Container>

      <Container>
        <SectionHeader
          title={copy.home.newArrivals}
          href="/category/all?sort=newest"
          action={copy.home.viewAll}
          className="mb-4"
        />
        <ProductGrid products={newArrivals} />
      </Container>
    </div>
  );
}
