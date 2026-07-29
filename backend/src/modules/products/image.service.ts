import { getDb } from "../../db/client.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { optimizeImage } from "../../lib/images/optimizer.js";
import { getStorage } from "../../lib/storage/index.js";
import type { StoredFile } from "../../lib/storage/index.js";
import { findProductById } from "./product.repository.js";
import {
  applyImageOrder,
  deleteImageRow,
  findImageById,
  imagesBelongToProduct,
  insertImages,
  listImages,
  maxSortOrder,
  promoteFirstImageToFeatured,
  setFeaturedImage,
} from "./image.repository.js";
import { toImageDto, type ProductImageDto } from "./product.types.js";
import type { ReorderImagesInput } from "./product.validation.js";

/**
 * Product image use cases.
 *
 * The upload path is: buffer → optimise → store → persist row. Each step can
 * fail, and the ordering matters — bytes are only written to storage once the
 * image is known to be genuine and decodable, and any object written during a
 * request that later fails is removed before the error propagates. An orphaned
 * file costs nothing but is impossible to attribute later, so the cleanup is
 * worth the few lines.
 */

const log = createLogger("product-images");

/** Hard ceiling per product, independent of how many arrive per request. */
const MAX_IMAGES_PER_PRODUCT = 12;

export async function list(productId: string): Promise<ProductImageDto[]> {
  const product = await findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  const images = await listImages(productId);
  return images.map(toImageDto);
}

export async function upload(
  productId: string,
  files: { buffer: Buffer; originalname: string }[],
  options: { alt?: string } = {},
): Promise<ProductImageDto[]> {
  const product = await findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  if (files.length === 0) {
    throw new ValidationError([
      { field: "images", message: 'Attach at least one file in the "images" field.' },
    ]);
  }

  const existing = await listImages(productId);
  if (existing.length + files.length > MAX_IMAGES_PER_PRODUCT) {
    throw new ConflictError(
      `A product may have at most ${MAX_IMAGES_PER_PRODUCT} images. ` +
        `This product has ${existing.length}; you tried to add ${files.length}.`,
      ErrorCode.CONFLICT,
    );
  }

  const storage = getStorage();
  const stored: (StoredFile & { width: number; height: number })[] = [];

  try {
    /* Sequential: sharp saturates the libuv thread pool, and processing a
       batch concurrently starves every other async operation in the process,
       database queries included. */
    for (const file of files) {
      const optimized = await optimizeImage(file.buffer, { label: file.originalname });

      const object = await storage.put({
        folder: "products",
        buffer: optimized.buffer,
        mimeType: optimized.mimeType,
        originalName: file.originalname,
      });

      stored.push({ ...object, width: optimized.width, height: optimized.height });
    }
  } catch (error) {
    await Promise.allSettled(stored.map((object) => storage.delete(object.key)));
    throw error;
  }

  const startOrder = (await maxSortOrder(productId)) + 1;
  /* The first image ever uploaded becomes featured automatically — a product
     with a gallery but no featured image renders as a blank card. */
  const shouldFeatureFirst = existing.length === 0;

  try {
    await getDb().transaction(async (tx) => {
      await insertImages(
        stored.map((object, index) => ({
          productId,
          storageKey: object.key,
          alt: options.alt ?? product.name,
          width: object.width,
          height: object.height,
          size: object.size,
          mimeType: object.mimeType,
          checksum: object.checksum,
          isFeatured: shouldFeatureFirst && index === 0,
          sortOrder: startOrder + index,
        })),
        tx,
      );
    });
  } catch (error) {
    await Promise.allSettled(stored.map((object) => storage.delete(object.key)));
    throw error;
  }

  log.info({ productId, count: stored.length }, "Product images uploaded");
  return list(productId);
}

/**
 * Deletes an image and its stored object.
 *
 * If the featured image is removed, the next image is promoted so the product
 * never ends up with a gallery and no featured image.
 */
export async function remove(productId: string, imageId: string): Promise<ProductImageDto[]> {
  const image = await findImageById(imageId);
  if (!image || image.productId !== productId) {
    throw new NotFoundError("Image not found on this product.");
  }

  await getDb().transaction(async (tx) => {
    await deleteImageRow(imageId, tx);
    if (image.isFeatured) {
      await promoteFirstImageToFeatured(productId, tx);
    }
  });

  /* Storage last: a failed row delete must not leave a live image row
     pointing at bytes that no longer exist. */
  await getStorage()
    .delete(image.storageKey)
    .catch((error: unknown) => {
      log.error({ err: error, key: image.storageKey }, "Failed to delete image object");
    });

  log.info({ productId, imageId }, "Product image deleted");
  return list(productId);
}

export async function reorder(
  productId: string,
  input: ReorderImagesInput,
): Promise<ProductImageDto[]> {
  const product = await findProductById(productId);
  if (!product) throw new NotFoundError("Product not found.");

  /* Every id must belong to this product — otherwise a caller could reorder
     another product's gallery by guessing ids. */
  const ids = input.order.map((entry) => entry.id);
  if (!(await imagesBelongToProduct(productId, ids))) {
    throw new ValidationError([
      { field: "body.order", message: "One or more images do not belong to this product." },
    ]);
  }

  await applyImageOrder(productId, input.order);
  return list(productId);
}

export async function setFeatured(
  productId: string,
  imageId: string,
): Promise<ProductImageDto[]> {
  const image = await findImageById(imageId);
  if (!image || image.productId !== productId) {
    throw new NotFoundError("Image not found on this product.");
  }

  /* Both statements in one transaction: the partial unique index allows only
     one featured row per product, so clearing and setting must be atomic. */
  await getDb().transaction(async (tx) => {
    const ok = await setFeaturedImage(productId, imageId, tx);
    if (!ok) throw new NotFoundError("Image not found on this product.");
  });

  log.info({ productId, imageId }, "Featured image changed");
  return list(productId);
}
