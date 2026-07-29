import { ConflictError, NotFoundError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { createLogger } from "../../core/logger.js";
import { getStorage } from "../../lib/storage/index.js";
import { optimizeImage } from "../../lib/images/optimizer.js";
import { generateUniqueSlug, normalizeSlug } from "../../lib/validation/slug.js";
import {
  applyCategoryOrder,
  categoryFieldExists,
  countProductsInCategory,
  deleteCategoryRow,
  findCategoryById,
  findCategoryBySlug,
  insertCategory,
  listCategories,
  updateCategoryRow,
} from "./category.repository.js";
import { toCategoryDto, type CategoryDto } from "./category.types.js";
import type {
  CreateCategoryInput,
  ReorderCategoriesInput,
  UpdateCategoryInput,
} from "./category.validation.js";

/**
 * Category use cases.
 *
 * Uniqueness is checked here for a readable 409, but the database's
 * case-insensitive unique indexes remain the real guarantee — a service check
 * alone loses to two concurrent requests, and the error handler already maps
 * a 23505 to ALREADY_EXISTS.
 */

const log = createLogger("categories");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function list(options: { includeInactive?: boolean }): Promise<CategoryDto[]> {
  const rows = await listCategories({ onlyActive: !options.includeInactive });
  return rows.map((row) => toCategoryDto(row.category, { productCount: row.productCount }));
}

/** Resolves by uuid or slug — both are stable public identifiers. */
export async function getByIdentifier(
  identifier: string,
  options: { includeInactive?: boolean } = {},
): Promise<CategoryDto> {
  const row = UUID_PATTERN.test(identifier)
    ? await findCategoryById(identifier)
    : await findCategoryBySlug(identifier);

  if (!row || (!options.includeInactive && !row.isActive)) {
    throw new NotFoundError("Category not found.");
  }

  return toCategoryDto(row);
}

export async function create(input: CreateCategoryInput): Promise<CategoryDto> {
  if (await categoryFieldExists("name", input.name)) {
    throw new ConflictError(
      `A category named "${input.name}" already exists.`,
      ErrorCode.ALREADY_EXISTS,
    );
  }

  const slug = input.slug
    ? normalizeSlug(input.slug)
    : await generateUniqueSlug(input.name, (candidate) =>
        categoryFieldExists("slug", candidate),
      );

  if (input.slug && (await categoryFieldExists("slug", slug))) {
    throw new ConflictError(`The slug "${slug}" is already in use.`, ErrorCode.ALREADY_EXISTS);
  }

  const row = await insertCategory({
    name: input.name,
    slug,
    description: input.description ?? null,
    icon: input.icon ?? null,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  });

  log.info({ categoryId: row.id, slug: row.slug }, "Category created");
  return toCategoryDto(row, { productCount: 0 });
}

export async function update(id: string, input: UpdateCategoryInput): Promise<CategoryDto> {
  const existing = await findCategoryById(id);
  if (!existing) throw new NotFoundError("Category not found.");

  if (input.name && (await categoryFieldExists("name", input.name, id))) {
    throw new ConflictError(
      `A category named "${input.name}" already exists.`,
      ErrorCode.ALREADY_EXISTS,
    );
  }

  const slug = input.slug ? normalizeSlug(input.slug) : undefined;
  if (slug && (await categoryFieldExists("slug", slug, id))) {
    throw new ConflictError(`The slug "${slug}" is already in use.`, ErrorCode.ALREADY_EXISTS);
  }

  const row = await updateCategoryRow(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(slug !== undefined ? { slug } : {}),
    ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    ...(input.icon !== undefined ? { icon: input.icon ?? null } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });

  if (!row) throw new NotFoundError("Category not found.");

  log.info({ categoryId: id }, "Category updated");
  return toCategoryDto(row);
}

export async function setActive(id: string, isActive: boolean): Promise<CategoryDto> {
  const row = await updateCategoryRow(id, { isActive });
  if (!row) throw new NotFoundError("Category not found.");

  log.info({ categoryId: id, isActive }, "Category visibility changed");
  return toCategoryDto(row);
}

/**
 * Deletes a category.
 *
 * Refused while products still reference it. The database enforces this with
 * ON DELETE RESTRICT; the pre-check exists to return a useful message naming
 * the number of products in the way, rather than a bare foreign-key 409.
 *
 * Disabling (`isActive: false`) is the right move for a category being retired
 * — it keeps the products and their history intact.
 */
export async function remove(id: string): Promise<void> {
  const existing = await findCategoryById(id);
  if (!existing) throw new NotFoundError("Category not found.");

  const productCount = await countProductsInCategory(id);
  if (productCount > 0) {
    throw new ConflictError(
      `Cannot delete "${existing.name}" — ${productCount} product(s) still belong to it. ` +
        `Move them to another category first, or disable this category instead.`,
      ErrorCode.CONFLICT,
    );
  }

  /* Remove the image only after the row is gone. The reverse order can delete
     a file and then fail the delete, leaving a category with a broken image. */
  const deleted = await deleteCategoryRow(id);
  if (!deleted) throw new NotFoundError("Category not found.");

  if (existing.imageKey) {
    await getStorage()
      .delete(existing.imageKey)
      .catch((error: unknown) => {
        /* An orphaned object costs a few KB; failing the request after the row
           is already gone would be worse. */
        log.error({ err: error, key: existing.imageKey }, "Failed to delete category image");
      });
  }

  log.info({ categoryId: id, name: existing.name }, "Category deleted");
}

export async function reorder(input: ReorderCategoriesInput): Promise<CategoryDto[]> {
  await applyCategoryOrder(input.order);
  log.info({ count: input.order.length }, "Categories reordered");
  return list({ includeInactive: true });
}

/**
 * Replaces the category image.
 *
 * The old object is removed only after the new key is committed, so a failure
 * mid-way leaves the category with its previous working image rather than none.
 */
export async function setImage(
  id: string,
  file: { buffer: Buffer; originalname: string },
): Promise<CategoryDto> {
  const existing = await findCategoryById(id);
  if (!existing) throw new NotFoundError("Category not found.");

  const optimized = await optimizeImage(file.buffer, { label: file.originalname });

  const stored = await getStorage().put({
    folder: "categories",
    buffer: optimized.buffer,
    mimeType: optimized.mimeType,
    originalName: file.originalname,
  });

  const row = await updateCategoryRow(id, { imageKey: stored.key });
  if (!row) {
    await getStorage().delete(stored.key).catch(() => undefined);
    throw new NotFoundError("Category not found.");
  }

  if (existing.imageKey && existing.imageKey !== stored.key) {
    await getStorage()
      .delete(existing.imageKey)
      .catch((error: unknown) => {
        log.error({ err: error, key: existing.imageKey }, "Failed to delete replaced image");
      });
  }

  log.info({ categoryId: id, key: stored.key }, "Category image updated");
  return toCategoryDto(row);
}

export async function removeImage(id: string): Promise<CategoryDto> {
  const existing = await findCategoryById(id);
  if (!existing) throw new NotFoundError("Category not found.");

  const row = await updateCategoryRow(id, { imageKey: null });
  if (!row) throw new NotFoundError("Category not found.");

  if (existing.imageKey) {
    await getStorage()
      .delete(existing.imageKey)
      .catch((error: unknown) => {
        log.error({ err: error, key: existing.imageKey }, "Failed to delete category image");
      });
  }

  return toCategoryDto(row);
}

/** Used by the product service to validate `categoryId` on write. */
export async function assertCategoryExists(id: string): Promise<void> {
  const row = await findCategoryById(id);
  if (!row) {
    throw new NotFoundError("The selected category does not exist.");
  }
}
