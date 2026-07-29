import Link from "next/link";
import { getCategories } from "@/lib/data/catalog";
import { copy } from "@/lib/copy";
import { Container } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";
import { CartButton } from "./CartButton";
import { SearchEntry } from "./SearchEntry";

/**
 * A single sticky row: logo, search, cart. Nothing else.
 *
 * The announcement strip above it is the one concession — "Cash on delivery"
 * is the objection most first-time BD buyers have, and answering it before
 * they scroll is worth 28 pixels.
 */
export async function Header() {
  const categories = await getCategories();

  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md">
      <div className="bg-ink text-white">
        <Container>
          <p className="flex items-center justify-center gap-1.5 py-1.5 text-micro font-medium tracking-wide">
            <Icon name="cash" size={13} />
            {copy.home.announcement}
          </p>
        </Container>
      </div>

      <Container>
        <div className="flex h-14 items-center gap-3 border-b border-line">
          <Link
            href="/"
            className="text-[1.375rem] font-semibold tracking-[-0.04em] text-ink"
            aria-label={`${copy.brand.name} — ${copy.nav.home}`}
          >
            {copy.brand.name}
          </Link>

          <div className="flex flex-1 items-center justify-end gap-1 sm:justify-between sm:pl-6">
            <SearchEntry categories={categories} />
            <div className="flex items-center gap-1">
              <Link
                href="/track"
                className="hidden rounded-full px-3 py-2 text-caption font-medium text-muted transition-colors hover:bg-surface hover:text-ink md:block"
              >
                {copy.nav.trackOrder}
              </Link>
              <CartButton />
            </div>
          </div>
        </div>
      </Container>
    </header>
  );
}
