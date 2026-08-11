import { getDb } from "../../db/client.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { getStorage } from "../../lib/storage/index.js";
import { generateUniqueSlug, normalizeSlug } from "../../lib/validation/slug.js";
import { assertCategoryExists } from "../categories/category.service.js";
import {
  deleteProductRow,
  findProductById,
  findProductDetail,
  getCatalogFacets,
  insertProduct,
  listProducts,
  productFieldExists,
  syncProductStockFromVariants,
  updateProductRow,
  type ProductFilters,
} from "./product.repository.js";
import {
  deleteVariantsForProduct,
  insertVariants,
  listVariants,
} from "./variant.repository.js";
import { listStorageKeys } from "./image.repository.js";
import { createMetricsRow, recordView } from "./metrics.service.js";
import { toListItemDto, toProductDto, type ProductDto, type ProductListItemDto } from "./product.types.js";
import type { CreateProductInput, UpdateProductInput } from "./product.validation.js";
import type { ProductOptionDefinition } from "../../db/schema/products.js";
import type { ProductSort, StockStatus } from "../../db/schema/catalog-enums.js";

/**
 * Product use cases.
 *
 * Writes that touch more than one table run inside a transaction — a product
 * with nine variants must either exist completely or not at all. A partially
 * created product is worse than a failed request: it shows up in the admin
 * list looking fine and sells at the wrong price.
 */

const log = createLogger("products");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface ListResult {
  items: ProductListItemDto[];
  pagination: { page: number; perPage: number; total: number };
}

export async function list(options: {
  filters: ProductFilters;
  sort: ProductSort;
  page: number;
  perPage: number;
  scope: "public" | "admin";
}): Promise<ListResult> {
  const { rows, total } = await listProducts(options);

  return {
    items: rows.map((row) =>
      toListItemDto(row.product, {
        category: row.category,
        featuredImage: row.featuredImage,
        includeAdminFields: options.scope === "admin",
      }),
    ),
    pagination: { page: options.page, perPage: options.perPage, total },
  };
}

/**
 * Product detail by uuid or slug.
 *
 * Views are counted only for public reads — an admin opening a product to edit
 * it is not demand, and letting the admin panel inflate the trending score
 * would make Trending reflect staff activity.
 */
export async function getByIdentifier(
  identifier: string,
  options: { scope: "public" | "admin"; countView?: boolean } = { scope: "public" },
): Promise<ProductDto> {
  const detail = await findProductDetail(
    UUID_PATTERN.test(identifier) ? { id: identifier } : { slug: identifier },
    { scope: options.scope },
  );

  if (!detail) throw new NotFoundError("Product not found.");

  if (options.scope === "public" && options.countView !== false) {
    recordView(detail.product.id);
  }

  return toProductDto(detail.product, {
    category: detail.category,
    images: detail.images,
    variants: detail.variants,
    metrics: detail.metrics,
    includeAdminFields: options.scope === "admin",
  });
}

export async function facets(categoryId?: string) {
  return getCatalogFacets(categoryId ? { categoryId } : {});
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                         */
/* -------------------------------------------------------------------------- */

async function assertUniqueIdentifiers(
  input: { slug?: string; sku?: string },
  excludeId?: string,
): Promise<void> {
  if (input.sku && (await productFieldExists("sku", input.sku, excludeId))) {
    throw new ConflictError(
      `SKU "${input.sku}" is already used by another product.`,
      ErrorCode.ALREADY_EXISTS,
    );
  }
  if (input.slug && (await productFieldExists("slug", input.slug, excludeId))) {
    throw new ConflictError(
      `The slug "${input.slug}" is already in use.`,
      ErrorCode.ALREADY_EXISTS,
    );
  }
}

/**
 * Checks every variant against the product's declared axes.
 *
 * Three ways a variant set can be wrong, all caught here rather than at the
 * point of sale:
 *   1. an option name that is not a declared axis
 *   2. a value that is not in that axis's allowed list
 *   3. two variants describing the same combination
 */
function validateVariantOptions(
  optionDefinitions: ProductOptionDefinition[],
  variants: { sku: string; options: Record<string, string> }[],
): void {
  if (variants.length === 0) return;

  const axes = new Map(
    optionDefinitions.map((option) => [
      option.name.toLowerCase(),
      new Set(option.values.map((value) => value.toLowerCase())),
    ]),
  );

  const seen = new Set<string>();

  variants.forEach((variant, index) => {
    const keys = Object.keys(variant.options);

    if (keys.length !== axes.size) {
      throw new ValidationError([
        {
          field: `body.variants[${index}].options`,
          message: `Provide a value for every option: ${optionDefinitions
            .map((option) => option.name)
            .join(", ")}.`,
        },
      ]);
    }

    for (const [name, value] of Object.entries(variant.options)) {
      const allowed = axes.get(name.toLowerCase());
      if (!allowed) {
        throw new ValidationError([
          {
            field: `body.variants[${index}].options.${name}`,
            message: `"${name}" is not a declared option for this product.`,
          },
        ]);
      }
      if (!allowed.has(value.toLowerCase())) {
        throw new ValidationError([
          {
            field: `body.variants[${index}].options.${name}`,
            message: `"${value}" is not an allowed value for ${name}.`,
          },
        ]);
      }
    }

    /* Canonical key so { Color, Storage } and { Storage, Color } collide. */
    const signature = Object.entries(variant.options)
      .map(([name, value]) => `${name.toLowerCase()}=${value.toLowerCase()}`)
      .sort()
      .join("|");

    if (seen.has(signature)) {
      throw new ValidationError([
        {
          field: `body.variants[${index}].options`,
          message: "Two variants describe the same combination of options.",
        },
      ]);
    }
    seen.add(signature);
  });

  /* SKUs must be unique within the payload too — the database would catch it,
     but a 409 naming the duplicate is far more useful than a constraint error. */
  const skus = new Set<string>();
  variants.forEach((variant, index) => {
    const key = variant.sku.toLowerCase();
    if (skus.has(key)) {
      throw new ValidationError([
        {
          field: `body.variants[${index}].sku`,
          message: `Duplicate SKU "${variant.sku}" in this request.`,
        },
      ]);
    }
    skus.add(key);
  });
}

/** Availability derived from quantity, unless an operator set a manual state. */
function deriveStockStatus(quantity: number, current?: StockStatus | null): StockStatus {
  if (current === "pre_order" || current === "discontinued") return current;
  return quantity > 0 ? "in_stock" : "out_of_stock";
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function create(input: CreateProductInput): Promise<ProductDto> {
  await assertCategoryExists(input.categoryId);

  const slug = input.slug
    ? normalizeSlug(input.slug)
    : await generateUniqueSlug(input.name, (candidate) =>
        productFieldExists("slug", candidate),
      );

  await assertUniqueIdentifiers({ slug, sku: input.sku });
  validateVariantOptions(input.variantOptions, input.variants);

  const hasVariants = input.variants.length > 0;
  const stockQuantity = hasVariants
    ? input.variants
        .filter((variant) => variant.isActive)
        .reduce((sum, variant) => sum + variant.stockQuantity, 0)
    : input.stockQuantity;

  /* One transaction: product, variants and the metrics row succeed together
     or the request leaves no trace. */
  const productId = await getDb().transaction(async (tx) => {
    const product = await insertProduct(
      {
        name: input.name,
        slug,
        sku: input.sku,
        brand: input.brand,
        categoryId: input.categoryId,
        shortDescription: input.shortDescription ?? null,
        description: input.description ?? null,
        specifications: input.specifications,
        whatsIncluded: input.whatsIncluded,
        warranty: input.warranty ?? null,
        tags: input.tags,
        variantOptions: input.variantOptions,
        price: input.price,
        oldPrice: input.oldPrice ?? null,
        costPrice: input.costPrice ?? null,
        /* Null is "use the shop default", not "free" — see the schema. */
        courierCostInsideDhaka: input.courierCostInsideDhaka ?? null,
        courierCostOutsideDhaka: input.courierCostOutsideDhaka ?? null,
        packagingCost: input.packagingCost ?? null,
        stockQuantity,
        stockStatus: deriveStockStatus(stockQuantity, input.stockStatus),
        lowStockThreshold: input.lowStockThreshold,
        status: input.status,
        isVisible: input.isVisible,
        publishedAt: input.status === "active" ? new Date() : null,
      },
      tx,
    );

    if (hasVariants) {
      await insertVariants(
        input.variants.map((variant, index) => ({
          productId: product.id,
          sku: variant.sku,
          options: variant.options,
          price: variant.price,
          oldPrice: variant.oldPrice ?? null,
          costPrice: variant.costPrice ?? null,
          stockQuantity: variant.stockQuantity,
          isActive: variant.isActive,
          sortOrder: variant.sortOrder || index,
          /* Always null here, and it has to be: photographs are uploaded
             against a product that already exists, so at the moment a product
             is created there is no image for a variant to point at. The swatch
             is assigned afterwards, through the variant update endpoint. */
          imageId: null,
        })),
        tx,
      );
    }

    await createMetricsRow(product.id, tx);
    return product.id;
  });

  log.info({ productId, sku: input.sku }, "Product created");
  return getByIdentifier(productId, { scope: "admin", countView: false });
}

export async function update(id: string, input: UpdateProductInput): Promise<ProductDto> {
  const existing = await findProductById(id);
  if (!existing) throw new NotFoundError("Product not found.");

  if (input.categoryId) await assertCategoryExists(input.categoryId);

  const slug = input.slug ? normalizeSlug(input.slug) : undefined;
  await assertUniqueIdentifiers({ slug, ...(input.sku ? { sku: input.sku } : {}) }, id);

  /* Narrowing the axes could orphan existing variants, so re-validate the
     stored ones against any new definition before accepting it. */
  if (input.variantOptions) {
    const variants = await listVariants(id);
    validateVariantOptions(
      input.variantOptions,
      variants.map((variant) => ({ sku: variant.sku, options: variant.options })),
    );
  }

  const quantity = input.stockQuantity ?? existing.stockQuantity;
  const nextStatus = input.status ?? existing.status;

  const row = await updateProductRow(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(slug !== undefined ? { slug } : {}),
    ...(input.sku !== undefined ? { sku: input.sku } : {}),
    ...(input.brand !== undefined ? { brand: input.brand } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.shortDescription !== undefined
      ? { shortDescription: input.shortDescription ?? null }
      : {}),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.specifications !== undefined ? { specifications: input.specifications } : {}),
    ...(input.whatsIncluded !== undefined ? { whatsIncluded: input.whatsIncluded } : {}),
    ...(input.warranty !== undefined ? { warranty: input.warranty ?? null } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.variantOptions !== undefined ? { variantOptions: input.variantOptions } : {}),
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.oldPrice !== undefined ? { oldPrice: input.oldPrice ?? null } : {}),
    ...(input.costPrice !== undefined ? { costPrice: input.costPrice ?? null } : {}),
    ...(input.courierCostInsideDhaka !== undefined
      ? { courierCostInsideDhaka: input.courierCostInsideDhaka ?? null }
      : {}),
    ...(input.courierCostOutsideDhaka !== undefined
      ? { courierCostOutsideDhaka: input.courierCostOutsideDhaka ?? null }
      : {}),
    ...(input.packagingCost !== undefined
      ? { packagingCost: input.packagingCost ?? null }
      : {}),
    ...(input.stockQuantity !== undefined ? { stockQuantity: input.stockQuantity } : {}),
    ...(input.lowStockThreshold !== undefined
      ? { lowStockThreshold: input.lowStockThreshold }
      : {}),
    stockStatus: deriveStockStatus(quantity, input.stockStatus ?? existing.stockStatus),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
    /* Stamp the first publication, and only the first. */
    ...(nextStatus === "active" && !existing.publishedAt ? { publishedAt: new Date() } : {}),
    ...(nextStatus === "archived" && !existing.archivedAt ? { archivedAt: new Date() } : {}),
  });

  if (!row) throw new NotFoundError("Product not found.");

  log.info({ productId: id }, "Product updated");
  return getByIdentifier(id, { scope: "admin", countView: false });
}

export async function setStatus(
  id: string,
  input: { status?: "draft" | "active" | "archived"; isVisible?: boolean },
): Promise<ProductDto> {
  return update(id, input);
}

/**
 * Archives a product.
 *
 * The default delete is soft. Once orders exist they will reference products,
 * and a hard delete would orphan order history — an archived product keeps
 * every past order readable while disappearing from the storefront
 * immediately.
 */
export async function archive(id: string): Promise<void> {
  const existing = await findProductById(id);
  if (!existing) throw new NotFoundError("Product not found.");

  await updateProductRow(id, {
    status: "archived",
    isVisible: false,
    archivedAt: new Date(),
  });

  log.info({ productId: id, sku: existing.sku }, "Product archived");
}

/**
 * Permanently deletes a product and its stored images.
 *
 * Restricted to super_admin at the route. Variants, images and metrics go with
 * it via ON DELETE CASCADE; the storage objects are removed afterwards, since
 * a failed row delete must not leave a live product pointing at deleted files.
 */
export async function destroy(id: string): Promise<void> {
  const existing = await findProductById(id);
  if (!existing) throw new NotFoundError("Product not found.");

  const keys = await listStorageKeys(id);

  await getDb().transaction(async (tx) => {
    await deleteVariantsForProduct(id, tx);
    const deleted = await deleteProductRow(id, tx);
    if (!deleted) throw new NotFoundError("Product not found.");
  });

  const storage = getStorage();
  const results = await Promise.allSettled(keys.map((key) => storage.delete(key)));
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    log.error({ productId: id, failed }, "Some image objects could not be deleted");
  }

  log.warn({ productId: id, sku: existing.sku, images: keys.length }, "Product permanently deleted");
}

/** Re-derives the denormalised product stock after a variant change. */
export async function refreshStock(productId: string): Promise<void> {
  await syncProductStockFromVariants(productId);
}
