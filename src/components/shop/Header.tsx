import Image from "next/image";
import Link from "next/link";
import { getCategories } from "@/lib/data/catalog";
import { getSettings } from "@/lib/data/settings";
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
  const [categories, settings] = await Promise.all([getCategories(), getSettings()]);

  const shopName = settings.storeName || copy.brand.name;

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
            className="flex shrink-0 items-center"
            aria-label={`${shopName} — ${copy.nav.home}`}
          >
            {settings.logoUrl ? (
              /* Sized from the logo's OWN dimensions rather than a fixed box.
                 `width`/`height` are the real pixel size, so the browser reserves
                 the correct space and the header does not jump as it loads; the
                 CSS then caps it to the bar's height and a sensible width, with
                 `object-contain` so nothing is ever stretched or cropped.
                 A wide wordmark fills the width, a square mark stays square.

                 `unoptimized` is deliberate — a logo is already small, and
                 re-encoding a transparent PNG through the optimiser costs more
                 than it saves. */
              <Image
                src={settings.logoUrl}
                alt={shopName}
                width={settings.logoWidth ?? 160}
                height={settings.logoHeight ?? 36}
                preload
                unoptimized
                className="h-auto max-h-10 w-auto max-w-[180px] object-contain object-left"
              />
            ) : (
              <span className="text-[1.375rem] font-semibold tracking-[-0.04em] text-ink">
                {shopName}
              </span>
            )}
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
