import Image from "next/image";
import Link from "next/link";
import { getCategories } from "@/lib/data/catalog";
import { getSettings } from "@/lib/data/settings";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
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
            className={cn(
              "flex shrink-0 items-center",
              /* With no logo the link would collapse to zero width and the
                 header would lose its route home entirely. A small invisible
                 target keeps the top-left corner clickable — which is where
                 people reach for "home" by habit — without drawing anything. */
              !settings.logoUrl && "size-10",
            )}
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
              /* No logo means NO logo. This used to fall back to the shop name
                 as a wordmark, which read as "the logo would not delete" to
                 anyone who had just removed one.

                 The name is kept for screen readers and stays the link's
                 accessible label, so the header still has a working route home
                 — the link is simply given a tap target rather than a visible
                 mark, since a zero-width link cannot be clicked. */
              <span className="sr-only">{shopName}</span>
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
