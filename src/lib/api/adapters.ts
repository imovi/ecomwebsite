import type {
  ApiBanner,
  ApiCategory,
  ApiProduct,
  ApiProductImage,
  ApiProductListItem,
} from "./types";
import type { Banner, Category, Product, ProductStatus, Variant } from "@/types";

/**
 * Backend DTO → storefront domain model.
 *
 * This file exists so that wiring the storefront to a real API changed no
 * component. The UI was built and visually verified against the mock model;
 * translating at the boundary keeps that work intact and puts the entire
 * coupling to the API in one reviewable place. When the API changes shape, this
 * is the file that fails to compile.
 */

/**
 * Shown when a product has no images yet.
 *
 * Not hypothetical: a merchant adding stock in a hurry will publish before
 * uploading photos, and `next/image` with an undefined `src` throws — taking
 * the whole listing down rather than showing one grey tile.
 */
export const PLACEHOLDER_IMAGE = "/placeholder-product.svg";

/**
 * Orders images the way the storefront expects: featured first, then by
 * `sortOrder`.
 *
 * The gallery treats index 0 as the primary image and variants address images
 * by index, so this ordering is load-bearing rather than cosmetic.
 */
function orderImages(images: ApiProductImage[]): ApiProductImage[] {
  return [...images].sort(
    (a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.sortOrder - b.sortOrder,
  );
}

function imageUrls(images: ApiProductImage[]): string[] {
  const urls = orderImages(images).map((image) => image.url);
  return urls.length > 0 ? urls : [PLACEHOLDER_IMAGE];
}

/** `null` is the API's "absent"; the storefront model uses `undefined`. */
function money(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

export function toCategory(category: ApiCategory): Category {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    /* The API stores an icon key; unknown keys fall through to a generic glyph
       in the Icon registry, so an unset icon is safe rather than broken. */
    icon: category.icon ?? "package",
    ...(category.imageUrl ? { imageUrl: category.imageUrl } : {}),
    sortOrder: category.sortOrder,
  };
}

export function toBanner(banner: ApiBanner): Banner {
  return {
    id: banner.id,
    image: banner.imageUrl,
    width: banner.imageWidth,
    height: banner.imageHeight,
    ...(banner.imageMobileUrl ? { imageMobile: banner.imageMobileUrl } : {}),
    ...(banner.imageMobileWidth ? { mobileWidth: banner.imageMobileWidth } : {}),
    ...(banner.imageMobileHeight ? { mobileHeight: banner.imageMobileHeight } : {}),
    alt: banner.alt,
    href: banner.href,
    sortOrder: banner.sortOrder,
    active: banner.isActive,
  };
}

function toVariants(product: ApiProduct, orderedImages: ApiProductImage[]): Variant[] {
  /* Map url → index once, so resolving each variant's image is O(1) rather
     than a scan per variant. */
  const indexByUrl = new Map(orderedImages.map((image, index) => [image.url, index]));

  return product.variants
    .filter((variant) => variant.isActive)
    .map((variant) => {
      const imageIndex = variant.imageUrl ? indexByUrl.get(variant.imageUrl) : undefined;

      return {
        id: variant.id,
        sku: variant.sku,
        options: variant.options,
        price: variant.price,
        ...(money(variant.oldPrice) !== undefined ? { oldPrice: variant.oldPrice! } : {}),
        stock: variant.stockQuantity,
        ...(imageIndex !== undefined ? { imageIndex } : {}),
      } satisfies Variant;
    });
}

/**
 * Full product, for the detail page.
 *
 * `description` falls back to the short description: the storefront always
 * renders a description block, and an empty one looks like a broken page
 * rather than a deliberate omission.
 */
export function toProduct(product: ApiProduct): Product {
  const ordered = orderImages(product.images);

  return {
    id: product.id,
    slug: product.slug,
    title: product.name,
    sku: product.sku,
    brand: product.brand,
    categoryId: product.category?.id ?? "",
    price: product.price,
    ...(money(product.oldPrice) !== undefined ? { oldPrice: product.oldPrice! } : {}),
    images: imageUrls(product.images),
    /**
     * The unlit twin of each photo, positionally aligned with `images` above —
     * both are built from `orderImages`, so index `n` here is the alternate for
     * index `n` there.
     *
     * Derived from `ordered` rather than from the raw list, and left empty when
     * the product has no photos at all: `imageUrls` substitutes a placeholder in
     * that case, and pairing a state to a placeholder would attach an unlit lamp
     * to a grey square.
     */
    imageStates: ordered.map(
      (image) => image.states.find((state) => state.key === "off") ?? null,
    ),
    interactiveEnabled: product.interactiveEnabled,
    description: product.description ?? product.shortDescription ?? "",
    specs: product.specifications,
    included: product.whatsIncluded,
    warranty: product.warranty ?? "",
    options: product.variantOptions,
    variants: toVariants(product, ordered),
    status: (product.status ?? "active") as ProductStatus,
    createdAt: product.createdAt,
  };
}

/**
 * Listing row → product card model.
 *
 * A list response carries no variants, specs or gallery, so the resulting
 * object is intentionally thinner than `toProduct` produces. The card only
 * reads title, price, discount, stock and the featured image — but `minPrice`
 * and `isInStock` in `catalog-utils` derive from `variants`, so the
 * already-computed list figures are projected into a single synthetic variant.
 * Without that, every card would show the base price and read as in stock.
 */
export function toProductFromListItem(item: ApiProductListItem): Product {
  const hasStock = item.inStock && item.stockQuantity > 0;

  return {
    id: item.id,
    slug: item.slug,
    title: item.name,
    sku: item.sku,
    brand: item.brand,
    categoryId: item.category?.id ?? "",
    price: item.price,
    ...(money(item.oldPrice) !== undefined ? { oldPrice: item.oldPrice! } : {}),
    images: item.featuredImage ? [item.featuredImage.url] : [PLACEHOLDER_IMAGE],
    /* A listing carries no gallery and no states, and a product card has
       nowhere to put a switch — so this is empty by fact, not by omission. */
    imageStates: [],
    interactiveEnabled: false,
    description: "",
    specs: [],
    included: [],
    warranty: "",
    options: [],
    /* One synthetic variant carrying the list's own price and stock, so the
       shared helpers report the same numbers the API already computed. */
    variants: [
      {
        id: `${item.id}-summary`,
        sku: item.sku,
        options: {},
        price: item.price,
        ...(money(item.oldPrice) !== undefined ? { oldPrice: item.oldPrice! } : {}),
        stock: hasStock ? Math.max(item.stockQuantity, 1) : 0,
      },
    ],
    status: (item.status ?? "active") as ProductStatus,
    createdAt: item.createdAt,
  };
}
