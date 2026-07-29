import { getDb } from "../../db/client.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { findProductById, syncProductStockFromVariants } from "./product.repository.js";
import {
  deleteVariantRow,
  findVariantById,
  insertVariants,
  listVariants,
  updateVariantRow,
  variantSkuExists,
} from "./variant.repository.js";
import { listImages } from "./image.repository.js";
import { toVariantDto, type ProductVariantDto } from "./product.types.js";
import type { CreateVariantInput, UpdateVariantInput } from "./product.validation.js";
import type { ProductOptionDefinition } from "../../db/schema/products.js";

/**
 * Variant use cases.
 *
 * Every mutation ends by re-deriving the parent's denormalised stock inside
 * the same transaction, so `products.stock_quantity` can never drift from the
 * sum of its variants.
 */

const log = createLogger("product-variants");

async function toDtos(productId: string): Promise<ProductVariantDto[]> {
  const [variants, images] = await Promise.all([listVariants(productId), listImages(productId)]);
  const imagesById = new Map(images.map((image) => [image.id, image]));
  return variants.map((variant) => toVariantDto(variant, imagesById));
}

/** Validates one variant's options against the parent's declared axes. */
function assertOptionsMatch(
  definitions: ProductOptionDefinition[],
  options: Record<string, string>,
  field: string,
): void {
  if (definitions.length === 0) {
    throw new ValidationError([
      {
        field: "body.options",
        message: "This product has no variant options declared. Add them to the product first.",
      },
    ]);
  }

  const axes = new Map(
    definitions.map((definition) => [
      definition.name.toLowerCase(),
      new Set(definition.values.map((value) => value.toLowerCase())),
    ]),
  );

  if (Object.keys(options).length !== axes.size) {
    throw new ValidationError([
      {
        field,
        message: `Provide a value for every option: ${definitions
          .map((definition) => definition.name)
          .join(", ")}.`,
      },
    ]);
  }

  for (const [name, value] of Object.entries(options)) {
    const allowed = axes.get(name.toLowerCase());
    if (!allowed) {
      throw new ValidationError([
        { field, message: `"${name}" is not a declared option for this product.` },
      ]);
    }
    if (!allowed.has(value.toLowerCase())) {
      throw new ValidationError([
        { field, message: `"${value}" is not an allowed value for ${name}.` },
      ]);
    }
  }
}

function signature(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([name, value]) => `${name.toLowerCase()}=${value.toLowerCase()}`)
    .sort()
    .join("|");
}

export async function list(productId: string): Promise<ProductVariantDto[]> {
  const product = await findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return toDtos(productId);
}

export async function create(
  productId: string,
  input: CreateVariantInput,
): Promise<ProductVariantDto[]> {
  const product = await findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  assertOptionsMatch(product.variantOptions, input.options, "body.options");

  if (await variantSkuExists(input.sku)) {
    throw new ConflictError(
      `SKU "${input.sku}" is already used by another variant.`,
      ErrorCode.ALREADY_EXISTS,
    );
  }

  const existing = await listVariants(productId);
  const wanted = signature(input.options);
  if (existing.some((variant) => signature(variant.options) === wanted)) {
    throw new ConflictError(
      "A variant with this combination of options already exists.",
      ErrorCode.ALREADY_EXISTS,
    );
  }

  await getDb().transaction(async (tx) => {
    await insertVariants(
      [
        {
          productId,
          sku: input.sku,
          options: input.options,
          price: input.price,
          oldPrice: input.oldPrice ?? null,
          stockQuantity: input.stockQuantity,
          isActive: input.isActive,
          sortOrder: input.sortOrder || existing.length,
        },
      ],
      tx,
    );
    await syncProductStockFromVariants(productId, tx);
  });

  log.info({ productId, sku: input.sku }, "Variant created");
  return toDtos(productId);
}

export async function update(
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
): Promise<ProductVariantDto[]> {
  const product = await findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  const variant = await findVariantById(variantId);
  if (!variant || variant.productId !== productId) {
    throw new NotFoundError("Variant not found on this product.");
  }

  if (input.options) {
    assertOptionsMatch(product.variantOptions, input.options, "body.options");

    const wanted = signature(input.options);
    const siblings = await listVariants(productId);
    if (
      siblings.some(
        (sibling) => sibling.id !== variantId && signature(sibling.options) === wanted,
      )
    ) {
      throw new ConflictError(
        "Another variant already uses this combination of options.",
        ErrorCode.ALREADY_EXISTS,
      );
    }
  }

  if (input.sku && (await variantSkuExists(input.sku, variantId))) {
    throw new ConflictError(
      `SKU "${input.sku}" is already used by another variant.`,
      ErrorCode.ALREADY_EXISTS,
    );
  }

  /* Guard against a partial price update that inverts the discount. */
  const nextPrice = input.price ?? variant.price;
  const nextOldPrice = input.oldPrice === undefined ? variant.oldPrice : input.oldPrice;
  if (nextOldPrice !== null && nextOldPrice <= nextPrice) {
    throw new ValidationError([
      { field: "body.oldPrice", message: "Old price must be greater than the current price." },
    ]);
  }

  await getDb().transaction(async (tx) => {
    await updateVariantRow(
      variantId,
      {
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.oldPrice !== undefined ? { oldPrice: input.oldPrice ?? null } : {}),
        ...(input.stockQuantity !== undefined ? { stockQuantity: input.stockQuantity } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
      tx,
    );
    await syncProductStockFromVariants(productId, tx);
  });

  log.info({ productId, variantId }, "Variant updated");
  return toDtos(productId);
}

export async function remove(productId: string, variantId: string): Promise<ProductVariantDto[]> {
  const variant = await findVariantById(variantId);
  if (!variant || variant.productId !== productId) {
    throw new NotFoundError("Variant not found on this product.");
  }

  await getDb().transaction(async (tx) => {
    await deleteVariantRow(variantId, tx);
    await syncProductStockFromVariants(productId, tx);
  });

  log.info({ productId, variantId }, "Variant deleted");
  return toDtos(productId);
}
