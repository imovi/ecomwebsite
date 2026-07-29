"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

const OPTIONS = [
  { value: "newest", label: copy.category.sortNewest },
  { value: "price_asc", label: copy.category.sortPriceLow },
  { value: "price_desc", label: copy.category.sortPriceHigh },
] as const;

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("sort") ?? "newest";

  return (
    <div className="relative">
      <select
        aria-label={copy.category.sortLabel}
        value={current}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("sort", e.target.value);
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }}
        className="h-10 appearance-none rounded-full bg-surface pl-4 pr-9 text-caption font-medium text-ink outline-none transition-colors hover:bg-line"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="chevronDown"
        size={15}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
