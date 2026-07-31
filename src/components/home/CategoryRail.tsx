import Image from "next/image";
import Link from "next/link";
import type { Category } from "@/types";
import { Icon } from "@/components/ui/Icon";

/**
 * Horizontal category strip.
 *
 * Scroll-snap rather than a wrapping grid: it keeps the homepage's vertical
 * budget for products, and the partially-visible next item is what tells a
 * customer the row scrolls at all.
 *
 * Each circle shows the category's uploaded artwork when it has some, and falls
 * back to a line icon otherwise. The image used to be ignored here entirely,
 * which meant an operator could upload one, see it in the admin list, and never
 * find it on the shop.
 */
export function CategoryRail({ categories }: { categories: Category[] }) {
  return (
    <nav aria-label="Categories">
      <ul className="snap-rail -mx-gutter gap-2.5 px-gutter">
        {categories.map((category) => (
          <li key={category.id} className="snap-item">
            <Link
              href={`/category/${category.slug}`}
              className="group flex w-[72px] flex-col items-center gap-2 text-center"
            >
              {category.imageUrl ? (
                /* Artwork fills the circle, so no hover recolour — inverting a
                   photograph on hover looks like a rendering fault. A ring gives
                   the same "this is tappable" feedback. */
                <span className="relative size-[60px] overflow-hidden rounded-full bg-surface ring-1 ring-line transition-all duration-150 ease-out group-hover:ring-2 group-hover:ring-ink">
                  <Image
                    src={category.imageUrl}
                    alt=""
                    fill
                    sizes="60px"
                    className="object-cover"
                  />
                </span>
              ) : (
                <span className="flex size-[60px] items-center justify-center rounded-full bg-surface text-ink-soft transition-colors duration-150 ease-out group-hover:bg-ink group-hover:text-white">
                  <Icon name={category.icon} size={25} />
                </span>
              )}
              <span className="text-micro font-medium leading-tight text-ink-soft">
                {category.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
