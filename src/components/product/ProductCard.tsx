import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types";
import { minOldPrice, minPrice, isInStock } from "@/lib/catalog-utils";
import { cn, discountPercent } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Badge } from "@/components/ui/Badge";
import { Price } from "@/components/ui/Price";
import { QuickAddButton } from "./QuickAddButton";
import { parseVideoUrl } from "@/lib/video-embed";

/**
 * Product card.
 *
 * One deliberate deviation from the brief: the "View Details" affordance is
 * rendered as *part of the card link*, not as a separate button. A button
 * nested inside a link is invalid HTML, creates two tap targets that do the
 * same thing, and makes people hesitate about whether tapping the image does
 * something different. This keeps the visual affordance and makes the entire
 * card a single, large, unambiguous target — which is what converts on a phone.
 *
 * The quick-add button is the one exception, and it is why the link is now a
 * STRETCHED link rather than a wrapper: the anchor holds the title — which is
 * what a crawler and a screen reader should meet as the link's text — and a
 * pseudo element spreads its hit area over the whole card. The button is then
 * a sibling sitting above that pseudo element, so the markup stays valid and
 * the card keeps being one large target everywhere the button is not.
 *
 * This component stays a Server Component; only the button ships JavaScript,
 * and it receives a summary rather than the whole product.
 */
export function ProductCard({
  product,
  priority = false,
}: {
  product: Product;
  /** True for the first row above the fold only. */
  priority?: boolean;
}) {
  const price = minPrice(product);
  const oldPrice = minOldPrice(product);
  const percent = discountPercent(price, oldPrice);
  const available = isInStock(product);

  const primaryMedia = product.images[0] || "";
  const isContain = primaryMedia.includes("fit=contain");
  const isTop = primaryMedia.includes("pos=top");
  const isBottom = primaryMedia.includes("pos=bottom");
  const fitClass = isContain
    ? "object-contain bg-neutral-900"
    : isTop
      ? "object-cover object-top"
      : isBottom
        ? "object-cover object-bottom"
        : "object-cover object-center";

  const withoutHash = primaryMedia.split("#")[0] ?? "";
  const cleanPrimary = withoutHash.split("?")[0] ?? "";
  const embed = parseVideoUrl(withoutHash);
  const isPrimaryVideo =
    /\.(mp4|webm|mov|ogg|m3u8)$/i.test(cleanPrimary) || cleanPrimary.includes("video/");
  const isSocial = embed !== null && embed.type !== "direct" && embed.type !== "unknown";

  return (
    <div className="group relative flex flex-col">
      <div className="relative aspect-square overflow-hidden rounded-md bg-surface">
        {isPrimaryVideo ? (
          <video
            src={`${cleanPrimary}#t=0.5`}
            preload="metadata"
            muted
            loop
            autoPlay
            playsInline
            onLoadedMetadata={(e) => {
              if (e.currentTarget.currentTime < 0.1) {
                e.currentTarget.currentTime = 0.5;
              }
            }}
            className={cn(
              "h-full w-full transition-transform duration-300 ease-out",
              fitClass,
              "group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100",
              !available && "opacity-55",
            )}
          />
        ) : isSocial && embed?.type === "youtube" && embed.videoId ? (
          <div className="relative size-full">
            <Image
              src={`https://img.youtube.com/vi/${embed.videoId}/hqdefault.jpg`}
              alt={product.title}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
              loading={priority ? "eager" : "lazy"}
              className={cn(
                "transition-transform duration-300 ease-out",
                fitClass,
                "group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100",
                !available && "opacity-55",
              )}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <span className="flex size-9 items-center justify-center rounded-full bg-red-600 text-white shadow-md">
                <svg className="size-4 fill-current ml-0.5" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </div>
          </div>
        ) : isSocial ? (
          <div className="relative size-full flex flex-col items-center justify-center bg-neutral-900 text-white p-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-white/20 text-white shadow-sm mb-1">
              <svg className="size-5 fill-current ml-0.5" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="text-micro font-semibold text-white/90">
              {embed?.platformName}
            </span>
          </div>
        ) : (
          <Image
            src={cleanPrimary}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
            loading={priority ? "eager" : "lazy"}
            className={cn(
              "transition-transform duration-300 ease-out",
              fitClass,
              "group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100",
              !available && "opacity-55",
            )}
          />
        )}

        {percent > 0 && available && (
          <Badge tone="sale" className="absolute left-2 top-2">
            {copy.product.off(percent)}
          </Badge>
        )}

        {!available && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Badge tone="ink" size="md">
              {copy.product.outOfStock}
            </Badge>
          </div>
        )}

        {/* Sold out has nothing to add, so the control is absent rather than
            disabled — a dead button invites a tap that does nothing. */}
        {available && (
          <QuickAddButton
            /* A summary, not the product. The listing endpoint this card was
               rendered from returns no variants, so the button fetches the real
               ones when it opens — see QuickAddButton. */
            summary={{
              id: product.id,
              slug: product.slug,
              title: product.title,
              image: product.images[0],
              price,
              oldPrice,
            }}
            className="absolute bottom-2 right-2 z-20"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 pt-2.5">
        <h3 className="clamp-2 min-h-[2.7em] text-caption leading-[1.35] text-ink-soft">
          {/* The stretched link. Its `::after` covers the card, so the whole
              card is clickable while the anchor's text stays the title. */}
          <Link
            href={`/product/${product.slug}`}
            className="outline-offset-4 after:absolute after:inset-0 after:content-['']"
          >
            {product.title}
          </Link>
        </h3>

        <Price price={price} oldPrice={oldPrice} size="card" />

        {/* Styled as a button, but it is text covered by the card's own link. */}
        <span
          className={cn(
            "mt-1.5 inline-flex h-9 w-full items-center justify-center rounded-xs",
            "border border-line text-caption font-medium text-ink",
            "transition-colors duration-150 ease-out",
            "group-hover:border-ink group-hover:bg-ink group-hover:text-white",
          )}
        >
          {copy.product.viewDetails}
        </span>
      </div>
    </div>
  );
}

/** Responsive product grid. Two per row on mobile, exactly as specced. */
export function ProductGrid({
  products,
  priorityCount = 0,
  className,
}: {
  products: Product[];
  /** How many leading cards to preload — normally the first visible row. */
  priorityCount?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        /* Five and six across on wide monitors: with a 1600px page, stopping
           at four would just inflate every card rather than show more stock. */
        "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
        className,
      )}
    >
      {products.map((product, i) => (
        <ProductCard
          key={product.id}
          product={product}
          priority={i < priorityCount}
        />
      ))}
    </div>
  );
}

/**
 * Horizontal rail for "You may also like" — related products are a browsing
 * aid, not the page's purpose, so they shouldn't consume four rows of height
 * underneath the thing the customer came to buy.
 */
export function ProductRail({ products }: { products: Product[] }) {
  return (
    <div className="snap-rail -mx-gutter gap-3 px-gutter">
      {products.map((product) => (
        <div key={product.id} className="snap-item w-[44vw] max-w-[220px] sm:w-[230px]">
          <ProductCard product={product} />
        </div>
      ))}
    </div>
  );
}
