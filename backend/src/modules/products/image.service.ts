import { getDb } from "../../db/client.js";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { optimizeImage } from "../../lib/images/optimizer.js";
import { detectFileType, getStorage } from "../../lib/storage/index.js";
import type { StoredFile } from "../../lib/storage/index.js";
import { findProductById } from "./product.repository.js";
import {
  applyImageOrder,
  deleteImageRow,
  deleteState,
  findImageById,
  upsertState,
  imagesBelongToProduct,
  insertImages,
  listImages,
  listStatesForProduct,
  maxSortOrder,
  promoteFirstImageToFeatured,
  setFeaturedImage,
  updateImageMeta,
} from "./image.repository.js";
import type { ProductImageStateRow } from "../../db/schema/product-image-states.js";
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
  const states = await listStatesForProduct(productId);

  const byImage = new Map<string, ProductImageStateRow[]>();
  for (const state of states) {
    const existing = byImage.get(state.productImageId);
    if (existing) existing.push(state);
    else byImage.set(state.productImageId, [state]);
  }

  /* Not `images.map(toImageDto)`: `map` passes the index as the second
     argument, which `toImageDto` reads as the state list. */
  return images.map((image) => toImageDto(image, byImage.get(image.id) ?? []));
}

export async function upload(
  productId: string,
  files: { buffer: Buffer; originalname: string; mimetype?: string }[],
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
      const detected = detectFileType(file.buffer);
      const isVideo =
        detected?.mimeType.startsWith("video/") ||
        file.mimetype?.startsWith("video/") ||
        /\.(mp4|webm|mov)$/i.test(file.originalname);

      if (isVideo) {
        const mimeType = detected?.mimeType ?? file.mimetype ?? "video/mp4";
        const object = await storage.put({
          folder: "products",
          buffer: file.buffer,
          mimeType,
          originalName: file.originalname,
        });

        stored.push({ ...object, width: 1080, height: 1080 });
      } else {
        const optimized = await optimizeImage(file.buffer, { label: file.originalname });

        const object = await storage.put({
          folder: "products",
          buffer: optimized.buffer,
          mimeType: optimized.mimeType,
          originalName: file.originalname,
        });

        stored.push({ ...object, width: optimized.width, height: optimized.height });
      }
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

/* -------------------------------------------------------------------------- */
/* Alternate image states                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Uploads the other version of one gallery photo — the lamp unlit.
 *
 * Same pipeline as a gallery image, deliberately: decode, validate, resize and
 * re-encode to WebP through `optimizeImage`, then store, then persist. So the
 * shop uploads whatever came off the camera or the supplier's site — JPEG, PNG,
 * anything sharp can read — and never has to think about size or format.
 *
 * Replacing an existing state deletes the object it used to point at, but only
 * after the row has been updated. The other order loses the picture if the
 * write fails.
 */
export async function uploadState(
  productId: string,
  imageId: string,
  input: { stateKey: string; label?: string; file: { buffer: Buffer; originalname: string } },
): Promise<ProductImageDto[]> {
  const image = await findImageById(imageId);
  if (!image || image.productId !== productId) {
    throw new NotFoundError("Image not found on this product.");
  }

  const optimized = await optimizeImage(input.file.buffer, {
    label: input.file.originalname,
  });

  const storage = getStorage();
  const object = await storage.put({
    folder: "products",
    buffer: optimized.buffer,
    mimeType: optimized.mimeType,
    originalName: input.file.originalname,
  });

  let replacedKey: string | null = null;

  try {
    const result = await upsertState({
      productImageId: imageId,
      stateKey: input.stateKey,
      label: input.label ?? null,
      storageKey: object.key,
      width: optimized.width,
      height: optimized.height,
      size: object.size,
      mimeType: object.mimeType,
      checksum: object.checksum,
    });
    replacedKey = result.replacedKey;
  } catch (error) {
    /* The row never landed, so nothing points at these bytes. */
    await storage.delete(object.key).catch(() => undefined);
    throw error;
  }

  if (replacedKey) {
    /* Best effort. A file left behind costs a few kilobytes; failing the
       request after the row is already correct would be worse. */
    await storage.delete(replacedKey).catch(() => undefined);
  }

  log.info({ productId, imageId, stateKey: input.stateKey }, "Image state uploaded");
  return list(productId);
}

/** Removes one alternate state and the object behind it. */
export async function removeState(
  productId: string,
  imageId: string,
  stateKey: string,
): Promise<ProductImageDto[]> {
  const image = await findImageById(imageId);
  if (!image || image.productId !== productId) {
    throw new NotFoundError("Image not found on this product.");
  }

  const removed = await deleteState(imageId, stateKey);
  if (!removed) throw new NotFoundError("That image has no such state.");

  await getStorage().delete(removed.storageKey).catch(() => undefined);

  log.info({ productId, imageId, stateKey }, "Image state removed");
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

export async function updateImage(
  productId: string,
  imageId: string,
  data: { alt?: string | null },
): Promise<ProductImageDto[]> {
  const image = await findImageById(imageId);
  if (!image || image.productId !== productId) {
    throw new NotFoundError("Image not found on this product.");
  }

  await updateImageMeta(productId, imageId, data);
  return list(productId);
}
