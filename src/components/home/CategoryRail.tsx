import Link from "next/link";
import type { Category } from "@/types";
import { Icon } from "@/components/ui/Icon";

/**
 * Horizontal category strip.
 *
 * Scroll-snap rather than a wrapping grid: it keeps the homepage's vertical
 * budget for products, and the partially-visible next item is what tells a
 * customer the row scrolls at all.
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
              <span className="flex size-[60px] items-center justify-center rounded-full bg-surface text-ink-soft transition-colors duration-150 ease-out group-hover:bg-ink group-hover:text-white">
                <Icon name={category.icon} size={25} />
              </span>
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
