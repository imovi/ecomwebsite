import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../../db/client.js";
import {
  productImages,
  type NewProductImageRow,
  type ProductImageRow,
} from "../../db/schema/product-images.js";
import {
  productImageStates,
  type NewProductImageStateRow,
  type ProductImageStateRow,
} from "../../db/schema/product-image-states.js";

/** Product image data access. */

export async function listImages(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageRow[]> {
  return executor
    .select()
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
}

export async function findImageById(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageRow | undefined> {
  const rows = await executor
    .select()
    .from(productImages)
    .where(eq(productImages.id, id))
    .limit(1);
  return rows[0];
}

export async function insertImages(
  input: NewProductImageRow[],
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageRow[]> {
  if (input.length === 0) return [];
  return executor.insert(productImages).values(input).returning();
}

export async function deleteImageRow(
  id: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageRow | undefined> {
  const rows = await executor.delete(productImages).where(eq(productImages.id, id)).returning();
  return rows[0];
}

/** Highest existing sort order, so appended images land at the end. */
export async function maxSortOrder(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  const rows = await executor
    .select({ max: sql<number>`coalesce(max(${productImages.sortOrder}), -1)`.mapWith(Number) })
    .from(productImages)
    .where(eq(productImages.productId, productId));
  return rows[0]?.max ?? -1;
}

/**
 * Moves the featured flag to one image.
 *
 * Two statements inside the caller's transaction, and the order matters: the
 * partial unique index permits only one featured row per product, so the old
 * flag must be cleared before the new one is set or the second statement
 * violates the constraint.
 */
export async function setFeaturedImage(
  productId: string,
  imageId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  await executor
    .update(productImages)
    .set({ isFeatured: false })
    .where(and(eq(productImages.productId, productId), eq(productImages.isFeatured, true)));

  const rows = await executor
    .update(productImages)
    .set({ isFeatured: true })
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
    .returning({ id: productImages.id });

  return rows.length === 1;
}

/**
 * Promotes the lowest-ordered remaining image to featured.
 *
 * Called after deleting the featured image, so a product is never left with a
 * gallery but no featured image — which would show a blank card in listings.
 */
export async function promoteFirstImageToFeatured(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<void> {
  await executor.execute(sql`
    update ${productImages}
    set is_featured = true
    where id = (
      select id from ${productImages}
      where product_id = ${productId}
      order by sort_order asc, created_at asc
      limit 1
    )
    and not exists (
      select 1 from ${productImages}
      where product_id = ${productId} and is_featured
    )
  `);
}

/**
 * Applies a new gallery order in one statement.
 *
 * Same pattern as category reordering: a single UPDATE ... FROM (VALUES ...)
 * so the whole gallery moves atomically and in one round trip.
 */
export async function applyImageOrder(
  productId: string,
  order: { id: string; sortOrder: number }[],
  executor: DatabaseExecutor = getDb(),
): Promise<number> {
  if (order.length === 0) return 0;

  const values = sql.join(
    order.map((entry) => sql`(${entry.id}::uuid, ${entry.sortOrder}::int)`),
    sql`, `,
  );

  const result = await executor.execute(sql`
    update ${productImages} as i
    set sort_order = v.sort_order
    from (values ${values}) as v(id, sort_order)
    where i.id = v.id and i.product_id = ${productId}
  `);

  return result.rowCount ?? 0;
}

/** Verifies every id belongs to the product before a reorder is applied. */
export async function imagesBelongToProduct(
  productId: string,
  imageIds: string[],
  executor: DatabaseExecutor = getDb(),
): Promise<boolean> {
  if (imageIds.length === 0) return true;

  const rows = await executor
    .select({ id: productImages.id })
    .from(productImages)
    .where(and(eq(productImages.productId, productId), inArray(productImages.id, imageIds)));

  return rows.length === imageIds.length;
}

/**
 * Storage keys for a product, used to clean up objects on hard delete.
 *
 * Alternate states are included. They are separate objects in storage, and the
 * row that points at them is removed by the cascade from `product_images` — so
 * leaving them out here would delete the pointer and keep the file, orphaning
 * an unlit photo per gallery frame with nothing left to find it by.
 */
export async function listStorageKeys(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<string[]> {
  const rows = await executor
    .select({ storageKey: productImages.storageKey })
    .from(productImages)
    .where(eq(productImages.productId, productId));

  const stateRows = await executor
    .select({ storageKey: productImageStates.storageKey })
    .from(productImageStates)
    .innerJoin(productImages, eq(productImages.id, productImageStates.productImageId))
    .where(eq(productImages.productId, productId));

  return [...rows, ...stateRows].map((row) => row.storageKey);
}

/* -------------------------------------------------------------------------- */
/* Alternate image states                                                     */
/* -------------------------------------------------------------------------- */

/** Every alternate state on a product, flat. The DTO mapper groups them. */
export async function listStatesForProduct(
  productId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageStateRow[]> {
  const rows = await executor
    .select({ state: productImageStates })
    .from(productImageStates)
    .innerJoin(productImages, eq(productImages.id, productImageStates.productImageId))
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sortOrder), asc(productImageStates.sortOrder));

  return rows.map((row) => row.state);
}

export async function listStatesForImage(
  imageId: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageStateRow[]> {
  return executor
    .select()
    .from(productImageStates)
    .where(eq(productImageStates.productImageId, imageId))
    .orderBy(asc(productImageStates.sortOrder));
}

/**
 * Writes one state, replacing any previous upload for the same key.
 *
 * `onConflictDoUpdate` against the (image, key) unique index rather than a
 * delete-then-insert: re-uploading the unlit photo is a correction, and it
 * should not be able to leave the product with no state at all if the second
 * statement fails.
 *
 * Returns the previous storage key when one was replaced, so the caller can
 * delete the object it no longer points at.
 */
export async function upsertState(
  input: NewProductImageStateRow,
  executor: DatabaseExecutor = getDb(),
): Promise<{ row: ProductImageStateRow; replacedKey: string | null }> {
  const existing = await executor
    .select({ storageKey: productImageStates.storageKey })
    .from(productImageStates)
    .where(
      and(
        eq(productImageStates.productImageId, input.productImageId),
        eq(productImageStates.stateKey, input.stateKey),
      ),
    )
    .limit(1);

  const rows = await executor
    .insert(productImageStates)
    .values(input)
    .onConflictDoUpdate({
      target: [productImageStates.productImageId, productImageStates.stateKey],
      set: {
        label: input.label ?? null,
        storageKey: input.storageKey,
        width: input.width,
        height: input.height,
        size: input.size,
        mimeType: input.mimeType,
        checksum: input.checksum,
      },
    })
    .returning();

  const previous = existing[0]?.storageKey ?? null;

  return {
    row: rows[0]!,
    /* Only when the bytes actually changed. Re-uploading an identical file
       produces the same content-addressed key, and deleting it would remove
       the object the surviving row points at. */
    replacedKey: previous && previous !== input.storageKey ? previous : null,
  };
}

/** Removes one state. Returns the row so the caller can drop its object. */
export async function deleteState(
  imageId: string,
  stateKey: string,
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageStateRow | undefined> {
  const rows = await executor
    .delete(productImageStates)
    .where(
      and(
        eq(productImageStates.productImageId, imageId),
        eq(productImageStates.stateKey, stateKey),
      ),
    )
    .returning();
  return rows[0];
}

export async function updateImageMeta(
  productId: string,
  imageId: string,
  data: { alt?: string | null },
  executor: DatabaseExecutor = getDb(),
): Promise<ProductImageRow | undefined> {
  const rows = await executor
    .update(productImages)
    .set(data)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
    .returning();
  return rows[0];
}
