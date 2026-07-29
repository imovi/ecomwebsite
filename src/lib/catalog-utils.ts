import type { Money, Product, Variant, VariantOptionName } from "@/types";

/**
 * Pure catalog helpers that are safe on both server and client.
 *
 * Kept separate from `lib/data/catalog.ts` (which is `server-only`) so the
 * cart and product-page client components can share this logic without
 * dragging the data layer into the browser bundle.
 */

export function minPrice(product: Product): Money {
  if (!product.variants.length) return product.price;
  return Math.min(...product.variants.map((v) => v.price));
}

export function minOldPrice(product: Product): Money | undefined {
  if (!product.variants.length) return product.oldPrice;
  const cheapest = product.variants.reduce((a, b) => (a.price <= b.price ? a : b));
  return cheapest.oldPrice;
}

export function totalStock(product: Product): number {
  if (!product.variants.length) return product.price > 0 ? 99 : 0;
  return product.variants.reduce((sum, v) => sum + v.stock, 0);
}

export function isInStock(product: Product): boolean {
  return totalStock(product) > 0;
}

/** Resolves a full option selection to exactly one variant, if it exists. */
export function findVariant(
  product: Product,
  selection: Partial<Record<VariantOptionName, string>>,
): Variant | undefined {
  if (!product.variants.length) return undefined;
  return product.variants.find((variant) =>
    product.options.every((opt) => variant.options[opt.name] === selection[opt.name]),
  );
}

/** True when every option axis on the product has a chosen value. */
export function isSelectionComplete(
  product: Product,
  selection: Partial<Record<VariantOptionName, string>>,
): boolean {
  return product.options.every((opt) => Boolean(selection[opt.name]));
}

/**
 * Whether a given option value can still produce an in-stock variant, taking
 * the rest of the current selection into account. Used to grey out sold-out
 * combinations instead of letting the customer hit a dead end.
 */
export function isOptionValueAvailable(
  product: Product,
  optionName: VariantOptionName,
  value: string,
  selection: Partial<Record<VariantOptionName, string>>,
): boolean {
  if (!product.variants.length) return true;

  return product.variants.some((variant) => {
    if (variant.options[optionName] !== value) return false;
    if (variant.stock <= 0) return false;
    // Every *other* axis that is already chosen must still match.
    return product.options.every((opt) => {
      if (opt.name === optionName) return true;
      const chosen = selection[opt.name];
      return !chosen || variant.options[opt.name] === chosen;
    });
  });
}

export function variantLabel(variant: Variant | undefined): string | undefined {
  if (!variant) return undefined;
  const values = Object.values(variant.options).filter(Boolean);
  return values.length ? values.join(" · ") : undefined;
}

/** Default selection: the cheapest in-stock variant, so the page never opens
 *  on a sold-out combination. */
export function defaultSelection(
  product: Product,
): Partial<Record<VariantOptionName, string>> {
  const inStock = product.variants.filter((v) => v.stock > 0);
  const target = inStock.length
    ? inStock.reduce((a, b) => (a.price <= b.price ? a : b))
    : product.variants[0];
  return target ? { ...target.options } : {};
}

/* -------------------------------------------------------------------------- */
/* Client projection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The slice of a product the cart and checkout actually need.
 *
 * Shipping the full catalog (descriptions, specs, all images) to the client
 * would be ~30KB of dead weight on every cart render. This is under 2KB for
 * the whole store.
 */
export interface CatalogEntry {
  id: string;
  slug: string;
  title: string;
  image: string;
  price: Money;
  oldPrice?: Money;
  stock: number;
  variants: {
    id: string;
    label: string;
    price: Money;
    oldPrice?: Money;
    stock: number;
    image: string;
  }[];
}

export function toCatalogEntry(product: Product): CatalogEntry {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    image: product.images[0],
    price: product.price,
    oldPrice: product.oldPrice,
    stock: product.variants.length ? totalStock(product) : 99,
    variants: product.variants.map((v) => ({
      id: v.id,
      label: variantLabel(v) ?? "",
      price: v.price,
      oldPrice: v.oldPrice,
      stock: v.stock,
      image: product.images[v.imageIndex ?? 0] ?? product.images[0],
    })),
  };
}

export type CatalogMap = Record<string, CatalogEntry>;

export function toCatalogMap(products: Product[]): CatalogMap {
  return Object.fromEntries(products.map((p) => [p.id, toCatalogEntry(p)]));
}

/** A stored cart line joined against the current catalog, ready to render. */
export interface ResolvedLine {
  productId: string;
  variantId?: string;
  qty: number;
  slug: string;
  title: string;
  image: string;
  variantLabel?: string;
  unitPrice: Money;
  oldUnitPrice?: Money;
  lineTotal: Money;
  /** Live stock ceiling for this exact variant. */
  maxQty: number;
  /** True when the stored qty had to be clamped, or stock hit zero. */
  adjusted: boolean;
}

/**
 * Joins stored lines to live catalog data.
 *
 * Lines whose product or variant has disappeared are dropped rather than
 * rendered as a broken row — the customer can't act on a product that no
 * longer exists, and a silent drop is less alarming than an error state.
 */
export function resolveLines(
  catalog: CatalogMap,
  lines: { productId: string; variantId?: string; qty: number }[],
): ResolvedLine[] {
  const resolved: ResolvedLine[] = [];

  for (const line of lines) {
    const entry = catalog[line.productId];
    if (!entry) continue;

    const variant = line.variantId
      ? entry.variants.find((v) => v.id === line.variantId)
      : undefined;
    if (line.variantId && !variant) continue;

    const maxQty = variant ? variant.stock : entry.stock;
    const qty = Math.max(0, Math.min(line.qty, maxQty));
    const unitPrice = variant?.price ?? entry.price;

    resolved.push({
      productId: entry.id,
      variantId: variant?.id,
      qty,
      slug: entry.slug,
      title: entry.title,
      image: variant?.image ?? entry.image,
      variantLabel: variant?.label || undefined,
      unitPrice,
      oldUnitPrice: variant?.oldPrice ?? entry.oldPrice,
      lineTotal: unitPrice * qty,
      maxQty,
      adjusted: qty !== line.qty,
    });
  }

  return resolved;
}
