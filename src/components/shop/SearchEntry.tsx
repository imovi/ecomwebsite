"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import type { Category } from "@/types";

/**
 * Search is a compact entry point that expands into a sheet, rather than a
 * permanent full-width input.
 *
 * On a phone a search bar pinned above the fold costs roughly 15% of the first
 * screen — space that is worth more to the banner and the first row of
 * products. The affordance stays obvious; it just doesn't occupy the viewport
 * until it's wanted.
 */
export function SearchEntry({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q.length < 2) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <>
      {/* Phone: icon button. Tablet and up: a real (but still compact) field. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.nav.search}
        className="flex size-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface sm:hidden"
      >
        <Icon name="search" size={21} />
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        /* `max-w-full` so it gives way rather than pushing: it lives in one
           column of the header grid, and a pill wider than its share would
           move the centred logo off centre. */
        className="hidden h-10 w-64 max-w-full items-center gap-2.5 rounded-full bg-surface px-4 text-caption text-muted transition-colors hover:bg-line sm:flex lg:w-80"
      >
        <Icon name="search" size={17} className="shrink-0" />
        <span className="truncate">{copy.nav.searchPlaceholder}</span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={copy.search.title}>
        <div className="px-gutter pb-6">
          <form onSubmit={submit} role="search">
            <div className="flex items-center gap-2 rounded-sm border border-line bg-white px-3 focus-within:border-ink">
              <Icon name="search" size={19} className="text-muted" />
              <input
                type="search"
                name="q"
                data-autofocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={copy.nav.searchPlaceholder}
                aria-label={copy.nav.searchPlaceholder}
                enterKeyHint="search"
                className="h-12 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted"
              />
            </div>
          </form>

          <p className="mb-3 mt-6 text-caption font-medium text-muted">
            {copy.home.categoriesTitle}
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                onClick={() => setOpen(false)}
                className="rounded-full bg-surface px-3.5 py-2 text-caption font-medium text-ink transition-colors hover:bg-line"
              >
                {category.name}
              </Link>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  );
}
