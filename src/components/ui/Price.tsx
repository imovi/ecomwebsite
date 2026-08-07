import { cn, discountPercent, formatTaka } from "@/lib/utils";
import { Badge } from "./Badge";
import { copy } from "@/lib/copy";

const priceSizes = {
  card: { current: "text-body font-semibold", old: "text-caption" },
  page: { current: "text-[1.5rem] font-semibold", old: "text-body" },
  row: { current: "text-body font-semibold", old: "text-caption" },
} as const;

interface PriceProps {
  price: number;
  oldPrice?: number;
  size?: keyof typeof priceSizes;
  /** Show the "-25%" badge inline after the old price. */
  showBadge?: boolean;
  /** Small leading word — "From", when the figure is the cheapest of several. */
  prefix?: string;
  className?: string;
}

/**
 * The single source of truth for how money is presented.
 *
 * Discount percentage is computed from the two prices rather than read from a
 * stored field, so a price edit can never leave a stale badge behind.
 */
export function Price({
  price,
  oldPrice,
  size = "card",
  showBadge = false,
  prefix,
  className,
}: PriceProps) {
  const s = priceSizes[size];
  const percent = discountPercent(price, oldPrice);
  const discounted = percent > 0;

  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}>
      {prefix && <span className="text-caption text-muted">{prefix}</span>}

      <span
        className={cn("tnum tracking-tight", s.current, discounted ? "text-sale" : "text-ink")}
      >
        {formatTaka(price)}
      </span>

      {discounted && (
        <span className={cn("tnum text-muted line-through", s.old)}>
          {formatTaka(oldPrice!)}
        </span>
      )}

      {discounted && showBadge && (
        <Badge tone="saleSoft">{copy.product.off(percent)}</Badge>
      )}
    </div>
  );
}
