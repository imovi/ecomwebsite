"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { ProductCard } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

interface TrendingSectionProps {
  products: Product[];
  initialCount?: number;
}

export function TrendingSection({ products, initialCount = 4 }: TrendingSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!products || products.length === 0) return null;

  const visibleProducts = expanded ? products : products.slice(0, initialCount);
  const hasMore = products.length > initialCount;

  return (
    <div className="flex flex-col gap-6">
      <div
        className={cn(
          "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
        )}
      >
        {visibleProducts.map((product, i) => (
          <ProductCard
            key={product.id}
            product={product}
            priority={i < 2}
          />
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setExpanded(!expanded)}
            className="group flex items-center gap-2 rounded-full border border-line bg-white px-6 shadow-xs hover:border-ink hover:bg-surface active:scale-95"
          >
            <span>
              {expanded
                ? "Show less"
                : "See more trending products"}
            </span>
            <span
              className={cn(
                "transition-transform duration-200",
                expanded ? "rotate-180" : "group-hover:translate-y-0.5",
              )}
            >
              <Icon name="chevronDown" size={15} />
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
