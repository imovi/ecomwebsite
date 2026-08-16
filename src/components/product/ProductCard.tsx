import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types";
import { minOldPrice, minPrice, isInStock } from "@/lib/catalog-utils";
import { cn, discountPercent } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { Badge } from "@/components/ui/Badge";
import { Price } from "@/components/ui/Price";

/**
 * Product card.
 *
 * One deliberate deviation from the brief: the "View Details" affordance is
 * rendered as *part of the card link*, not as a separate button. A button
 * nested inside a link is invalid HTML, creates two tap targets that do the
 * same thing, and makes people hesitate about whether tapping the image does
 * something different. This keeps the visual affordance and makes the entire
 * card a single, large, unambiguous target — which is what converts on a phone.
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

  return (
    <Link
      href={`/product/${product.slug}`}
      className="group flex flex-col outline-offset-4"
    >
      <div className="relative aspect-square overflow-hidden rounded-md bg-surface">
        <Image
          src={product.images[0]}
          alt={product.title}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 260px"
          /* Eager, but deliberately not preloaded and not `fetchPriority`.
             A first row is two to six cards depending on the breakpoint, so
             there is no single card that is the LCP element — marking them all
             as the important one just makes them compete with each other, and
             the preload links this used to emit carried no priority anyway.
             Dropping the lazy deferral is the whole win here. */
          loading={priority ? "eager" : "lazy"}
          className={cn(
            "object-cover transition-transform duration-300 ease-out",
            "group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100",
            !available && "opacity-55",
          )}
        />

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
      </div>

      <div className="flex flex-1 flex-col gap-1.5 pt-2.5">
        <h3 className="clamp-2 min-h-[2.7em] text-caption leading-[1.35] text-ink-soft">
          {product.title}
        </h3>

        <Price price={price} oldPrice={oldPrice} size="card" />

        {/* Styled as a button, but it is text inside the card's own link. */}
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
    </Link>
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
