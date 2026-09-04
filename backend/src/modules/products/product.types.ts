import { getStorage } from "../../lib/storage/index.js";
import type { ProductRow, ProductSpec, ProductOptionDefinition, ProductFaq } from "../../db/schema/products.js";
import type { ProductImageRow } from "../../db/schema/product-images.js";
import type { ProductImageStateRow } from "../../db/schema/product-image-states.js";
import type { ProductVariantRow } from "../../db/schema/product-variants.js";
import type { ProductMetricsRow } from "../../db/schema/product-metrics.js";
import type { CategoryRow } from "../../db/schema/categories.js";
import type { ProductStatus, StockStatus } from "../../db/schema/catalog-enums.js";

/**
 * Product response shapes.
 *
 * Two distinct DTOs on purpose. A listing returns 20–100 products at a time,
 * and shipping full descriptions, specs and every gallery image for each one
 * is the single easiest way to make a catalogue feel slow on a mobile
 * connection. `ProductListItemDto` carries only what a product card renders.
 *
 * Storage keys never leave the API — clients receive resolved URLs, so the
 * bucket layout stays an implementation detail.
 */

/**
 * An alternate version of a gallery photo — the lamp unlit, in the same frame.
 *
 * The photo's own row is the primary state and is not repeated here: `url` on
 * `ProductImageDto` is it. So a gallery with no alternates serialises exactly
 * as it always has.
 */
export interface ProductImageStateDto {
  /** Machine name. `off` today; `warm`, `night`, `folded` are all just rows. */
  key: string;
  /** What the shopper is offered. Falls back to the key when unlabelled. */
  label: string;
  url: string;
  width: number;
  height: number;
}

export interface ProductImageDto {
  id: string;
  url: string;
  alt: string | null;
  width: number;
  height: number;
  isFeatured: boolean;
  sortOrder: number;
  /**
   * Empty for every photo that has no alternate — which is every photo in the
   * shop until somebody uploads one. Present rather than optional so a client
   * can map over it without a guard.
   */
  states: ProductImageStateDto[];
}

export interface ProductVariantDto {
  id: string;
  sku: string;
  options: Record<string, string>;
  price: number;
  oldPrice: number | null;
  discountPercent: number;
  stockQuantity: number;
  inStock: boolean;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  /**
   * Admin listings only, and it must stay that way.
   *
   * What the shop pays is commercially sensitive — a competitor reading it off
   * a public JSON response learns the supplier's price and the exact margin.
   * Gated behind `includeAdminFields` like status and visibility.
   */
  costPrice?: number | null;
}

export interface CategorySummaryDto {
  id: string;
  name: string;
  slug: string;
}

export interface ProductListItemDto {
  id: string;
  name: string;
  slug: string;
  sku: string;
  /** Null when the product has no meaningful brand. */
  brand: string | null;
  category: CategorySummaryDto | null;
  price: number;
  oldPrice: number | null;
  discountPercent: number;
  stockQuantity: number;
  stockStatus: StockStatus;
  inStock: boolean;
  isLowStock: boolean;
  featuredImage: ProductImageDto | null;
  tags: string[];
  /** Admin listings only. */
  status?: ProductStatus;
  isVisible?: boolean;
  /** Admin listings only — see the note on the variant DTO. */
  costPrice?: number | null;
  /**
   * Per-product shipping and boxing overrides. Admin only, and null means
   * "use the shop default" rather than "free".
   */
  courierCostInsideDhaka?: number | null;
  courierCostOutsideDhaka?: number | null;
  packagingCost?: number | null;
  sortOrder?: number;
  videoUrl?: string | null;
  createdAt: string;
}

export interface ProductDto extends Omit<ProductListItemDto, "featuredImage"> {
  shortDescription: string | null;
  description: string | null;
  videoUrl: string | null;
  specifications: ProductSpec[];
  whatsIncluded: string[];
  faqs: ProductFaq[];
  warranty: string | null;
  variantOptions: ProductOptionDefinition[];
  featuredImage: ProductImageDto | null;
  images: ProductImageDto[];
  /**
   * Whether the storefront should offer this product's alternate image states.
   *
   * Separate from whether any state exists: an admin can upload the unlit
   * photos and leave the feature off while they check them, and can switch it
   * off later without losing the uploads.
   */
  interactiveEnabled: boolean;
  variants: ProductVariantDto[];
  lowStockThreshold: number;
  publishedAt: string | null;
  updatedAt: string;
  /** Admin detail only. */
  metrics?: {
    viewCount: number;
    unitsSold: number;
    unitsSoldRecent: number;
    trendingScore: number;
    lastSoldAt: string | null;
  };
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                    */
/* -------------------------------------------------------------------------- */

export function toImageStateDto(row: ProductImageStateRow): ProductImageStateDto {
  return {
    key: row.stateKey,
    /* The key is a serviceable last resort. A row with no label is a data gap,
       not a reason to render an empty control. */
    label: row.label ?? row.stateKey,
    url: getStorage().url(row.storageKey),
    width: row.width,
    height: row.height,
  };
}

/**
 * `states` defaults to empty, so every existing caller keeps working and every
 * product without alternates serialises exactly as it did before this feature.
 */
export function toImageDto(
  row: ProductImageRow,
  states: ProductImageStateRow[] = [],
): ProductImageDto {
  return {
    id: row.id,
    url:
      row.storageKey.startsWith("http://") || row.storageKey.startsWith("https://")
        ? row.storageKey
        : getStorage().url(row.storageKey),
    alt: row.alt,
    width: row.width,
    height: row.height,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
    /* Sorted here rather than trusted from the caller: this is the order the
       storefront offers them in, and it should not depend on which query
       happened to load them. */
    states: [...states].sort((a, b) => a.sortOrder - b.sortOrder).map(toImageStateDto),
  };
}

/** Discount is derived here for variants — the generated column exists only on
 *  the parent product, and duplicating it per variant is not worth a column. */
export function toVariantDto(
  row: ProductVariantRow,
  imagesById: Map<string, ProductImageRow>,
  includeAdminFields = false,
): ProductVariantDto {
  const image = row.imageId ? imagesById.get(row.imageId) : undefined;
  const discountPercent =
    row.oldPrice && row.oldPrice > row.price
      ? Math.round(((row.oldPrice - row.price) / row.oldPrice) * 100)
      : 0;

  return {
    id: row.id,
    sku: row.sku,
    options: row.options,
    price: row.price,
    oldPrice: row.oldPrice,
    discountPercent,
    stockQuantity: row.stockQuantity,
    inStock: row.stockQuantity > 0,
    imageUrl: image ? getStorage().url(image.storageKey) : null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    ...(includeAdminFields ? { costPrice: row.costPrice } : {}),
  };
}

function baseFields(
  product: ProductRow,
  category: CategorySummaryDto | null,
): Omit<ProductListItemDto, "featuredImage"> {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    brand: product.brand,
    category,
    price: product.price,
    oldPrice: product.oldPrice,
    /* Generated column: null only if the row predates it, never in practice. */
    discountPercent: product.discountPercent ?? 0,
    stockQuantity: product.stockQuantity,
    stockStatus: product.stockStatus,
    inStock: product.stockStatus === "in_stock" && product.stockQuantity > 0,
    isLowStock:
      product.stockQuantity > 0 && product.stockQuantity <= product.lowStockThreshold,
    tags: product.tags,
    sortOrder: product.sortOrder,
    videoUrl: product.videoUrl ?? null,
    createdAt: product.createdAt.toISOString(),
  };
}

export function toListItemDto(
  product: ProductRow,
  options: {
    category?: Pick<CategoryRow, "id" | "name" | "slug"> | null;
    featuredImage?: ProductImageRow | null;
    includeAdminFields?: boolean;
  } = {},
): ProductListItemDto {
  const dto: ProductListItemDto = {
    ...baseFields(
      product,
      options.category
        ? { id: options.category.id, name: options.category.name, slug: options.category.slug }
        : null,
    ),
    featuredImage: options.featuredImage ? toImageDto(options.featuredImage) : null,
  };

  if (options.includeAdminFields) {
    dto.status = product.status;
    dto.isVisible = product.isVisible;
    dto.costPrice = product.costPrice;
    dto.courierCostInsideDhaka = product.courierCostInsideDhaka;
    dto.courierCostOutsideDhaka = product.courierCostOutsideDhaka;
    dto.packagingCost = product.packagingCost;
  }

  return dto;
}

export function toProductDto(
  product: ProductRow,
  options: {
    category?: Pick<CategoryRow, "id" | "name" | "slug"> | null;
    images?: ProductImageRow[];
    /** Alternate versions, for every image on this product. Grouped below. */
    imageStates?: ProductImageStateRow[];
    variants?: ProductVariantRow[];
    metrics?: ProductMetricsRow | null;
    includeAdminFields?: boolean;
  } = {},
): ProductDto {
  const images = [...(options.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const featured = images.find((image) => image.isFeatured) ?? images[0] ?? null;

  const statesByImage = new Map<string, ProductImageStateRow[]>();
  for (const state of options.imageStates ?? []) {
    const existing = statesByImage.get(state.productImageId);
    if (existing) existing.push(state);
    else statesByImage.set(state.productImageId, [state]);
  }
  const statesFor = (imageId: string): ProductImageStateRow[] =>
    statesByImage.get(imageId) ?? [];

  const dto: ProductDto = {
    ...baseFields(
      product,
      options.category
        ? { id: options.category.id, name: options.category.name, slug: options.category.slug }
        : null,
    ),
    shortDescription: product.shortDescription,
    description: product.description,
    videoUrl: product.videoUrl ?? null,
    specifications: product.specifications,
    whatsIncluded: product.whatsIncluded,
    faqs: product.faqs ?? [],
    warranty: product.warranty,
    variantOptions: product.variantOptions,
    featuredImage: featured ? toImageDto(featured, statesFor(featured.id)) : null,
    /* Not `images.map(toImageDto)`: `map` passes the index as the second
       argument, which `toImageDto` now reads as the state list. */
    images: images.map((image) => toImageDto(image, statesFor(image.id))),
    interactiveEnabled: product.interactiveEnabled,
    variants: (options.variants ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((variant) => toVariantDto(variant, imagesById, options.includeAdminFields)),
    lowStockThreshold: product.lowStockThreshold,
    publishedAt: product.publishedAt?.toISOString() ?? null,
    updatedAt: product.updatedAt.toISOString(),
  };

  if (options.includeAdminFields) {
    dto.status = product.status;
    dto.isVisible = product.isVisible;
    dto.costPrice = product.costPrice;
    dto.courierCostInsideDhaka = product.courierCostInsideDhaka;
    dto.courierCostOutsideDhaka = product.courierCostOutsideDhaka;
    dto.packagingCost = product.packagingCost;

    if (options.metrics) {
      dto.metrics = {
        viewCount: options.metrics.viewCount,
        unitsSold: options.metrics.unitsSold,
        unitsSoldRecent: options.metrics.unitsSoldRecent,
        trendingScore: options.metrics.trendingScore,
        lastSoldAt: options.metrics.lastSoldAt?.toISOString() ?? null,
      };
    }
  }

  return dto;
}
