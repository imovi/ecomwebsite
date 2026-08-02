import { getStorage } from "../../lib/storage/index.js";
import type { ProductRow, ProductSpec, ProductOptionDefinition } from "../../db/schema/products.js";
import type { ProductImageRow } from "../../db/schema/product-images.js";
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

export interface ProductImageDto {
  id: string;
  url: string;
  alt: string | null;
  width: number;
  height: number;
  isFeatured: boolean;
  sortOrder: number;
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
  createdAt: string;
}

export interface ProductDto extends Omit<ProductListItemDto, "featuredImage"> {
  shortDescription: string | null;
  description: string | null;
  specifications: ProductSpec[];
  whatsIncluded: string[];
  warranty: string | null;
  variantOptions: ProductOptionDefinition[];
  featuredImage: ProductImageDto | null;
  images: ProductImageDto[];
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

export function toImageDto(row: ProductImageRow): ProductImageDto {
  return {
    id: row.id,
    url: getStorage().url(row.storageKey),
    alt: row.alt,
    width: row.width,
    height: row.height,
    isFeatured: row.isFeatured,
    sortOrder: row.sortOrder,
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
    variants?: ProductVariantRow[];
    metrics?: ProductMetricsRow | null;
    includeAdminFields?: boolean;
  } = {},
): ProductDto {
  const images = [...(options.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const featured = images.find((image) => image.isFeatured) ?? images[0] ?? null;

  const dto: ProductDto = {
    ...baseFields(
      product,
      options.category
        ? { id: options.category.id, name: options.category.name, slug: options.category.slug }
        : null,
    ),
    shortDescription: product.shortDescription,
    description: product.description,
    specifications: product.specifications,
    whatsIncluded: product.whatsIncluded,
    warranty: product.warranty,
    variantOptions: product.variantOptions,
    featuredImage: featured ? toImageDto(featured) : null,
    images: images.map(toImageDto),
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
