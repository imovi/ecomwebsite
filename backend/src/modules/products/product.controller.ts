import type { Request, RequestHandler } from "express";
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from "../../core/response.js";
import { ForbiddenError, ValidationError } from "../../core/errors.js";
import { ErrorCode } from "../../core/http-status.js";
import { validated } from "../../middleware/validate.js";
import * as productService from "./product.service.js";
import * as variantService from "./variant.service.js";
import * as imageService from "./image.service.js";
import type { ProductFilters } from "./product.repository.js";
import type {
  AdminListProductsQuery,
  CreateProductInput,
  CreateVariantInput,
  ListProductsQuery,
  ReorderImagesInput,
  ReorderProductsInput,
  UpdateProductInput,
  UpdateVariantInput,
  UploadImageStateInput,
} from "./product.validation.js";

/**
 * Product HTTP layer. Translation only.
 */

/** Maps the validated query string onto repository filters. */
function toFilters(query: ListProductsQuery & { status?: AdminListProductsQuery["status"] }): ProductFilters {
  const filters: ProductFilters = {};

  if (query.q) filters.search = query.q;
  if (query.categoryId) filters.categoryId = query.categoryId;
  if (query.category) filters.categorySlug = query.category;
  if (query.brand?.length) filters.brands = query.brand;
  if (query.tags?.length) filters.tags = query.tags;
  if (query.minPrice !== undefined) filters.minPrice = query.minPrice;
  if (query.maxPrice !== undefined) filters.maxPrice = query.maxPrice;
  if (query.stockStatus) filters.stockStatus = query.stockStatus;
  if (query.inStock) filters.inStockOnly = true;
  if (query.onSale) filters.onlyDiscounted = true;
  if (query.status) filters.status = query.status;

  return filters;
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/products — list, filter and sort. */
export const listPublic: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListProductsQuery>(req);

  const result = await productService.list({
    filters: toFilters(query),
    sort: query.sort,
    page: query.page,
    perPage: query.perPage,
    scope: "public",
  });

  sendPaginated(res, result.items, result.pagination);
};

/**
 * GET /api/v1/products/search?q=…
 *
 * A distinct endpoint rather than a flag on the listing: search results are
 * ranked by relevance, are never cached the same way, and are excluded from
 * indexing by the storefront. Keeping them separate makes those differences
 * explicit instead of conditional.
 */
export const search: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, { q: string; page: number; perPage: number; sort: ListProductsQuery["sort"] }>(req);

  const result = await productService.list({
    filters: { search: query.q },
    sort: query.sort,
    page: query.page,
    perPage: query.perPage,
    scope: "public",
  });

  sendPaginated(res, result.items, result.pagination);
};

/** GET /api/v1/products/new-arrivals */
export const newArrivals: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, { limit: number }>(req);

  const result = await productService.list({
    filters: {},
    sort: "newest",
    page: 1,
    perPage: query.limit,
    scope: "public",
  });

  sendSuccess(res, { products: result.items });
};

/**
 * GET /api/v1/products/trending
 *
 * Reads the precomputed popularity score. Nothing here is operator-controlled
 * — see `metrics.service.ts`.
 */
export const trending: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, { limit: number }>(req);

  const result = await productService.list({
    filters: {},
    sort: "trending",
    page: 1,
    perPage: query.limit,
    scope: "public",
  });

  sendSuccess(res, { products: result.items });
};

/** GET /api/v1/products/facets — filter options for the storefront UI. */
export const facets: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, { categoryId?: string }>(req);
  const data = await productService.facets(query.categoryId);
  sendSuccess(res, data);
};

/** GET /api/v1/products/:identifier — uuid or slug. */
export const detailPublic: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { identifier: string }>(req);
  const product = await productService.getByIdentifier(params.identifier, { scope: "public" });
  sendSuccess(res, { product });
};

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/admin/products — includes drafts and archived products. */
export const listAdmin: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, AdminListProductsQuery>(req);

  const result = await productService.list({
    filters: toFilters(query),
    sort: query.sort,
    page: query.page,
    perPage: query.perPage,
    scope: "admin",
  });

  sendPaginated(res, result.items, result.pagination);
};

/** GET /api/v1/admin/products/:id */
export const detailAdmin: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  const product = await productService.getByIdentifier(params.id, {
    scope: "admin",
    countView: false,
  });
  sendSuccess(res, { product });
};

/** POST /api/v1/admin/products */
export const create: RequestHandler = async (req, res) => {
  const { body } = validated<CreateProductInput>(req);
  const product = await productService.create(body);
  sendCreated(res, { product }, `/api/v1/products/${product.slug}`);
};

/** PATCH /api/v1/admin/products/reorder */
export const reorder: RequestHandler = async (req, res) => {
  const { body } = validated<ReorderProductsInput>(req);
  const result = await productService.reorder(body);
  sendSuccess(res, result);
};

/** PATCH /api/v1/admin/products/:id */
export const update: RequestHandler = async (req, res) => {
  const { body, params } = validated<UpdateProductInput, unknown, { id: string }>(req);
  const product = await productService.update(params.id, body);
  sendSuccess(res, { product });
};

/** PATCH /api/v1/admin/products/:id/status */
export const setStatus: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    { status?: "draft" | "active" | "archived"; isVisible?: boolean },
    unknown,
    { id: string }
  >(req);
  const product = await productService.setStatus(params.id, body);
  sendSuccess(res, { product });
};

/**
 * DELETE /api/v1/admin/products/:id
 *
 * Archives by default. `?permanent=true` really deletes, and is restricted to
 * super_admin here rather than at the router because the route itself is
 * legitimate for lower roles.
 */
export const remove: RequestHandler = async (req: Request, res) => {
  const { params, query } = validated<unknown, { permanent?: boolean }, { id: string }>(req);

  if (query.permanent) {
    if (req.auth?.role !== "super_admin") {
      throw new ForbiddenError(
        "Only a super administrator may permanently delete a product.",
        ErrorCode.INSUFFICIENT_ROLE,
      );
    }
    await productService.destroy(params.id);
  } else {
    await productService.archive(params.id);
  }

  sendNoContent(res);
};

/* --- Variants ------------------------------------------------------------- */

export const listVariants: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  const variants = await variantService.list(params.id);
  sendSuccess(res, { variants });
};

export const createVariant: RequestHandler = async (req, res) => {
  const { body, params } = validated<CreateVariantInput, unknown, { id: string }>(req);
  const variants = await variantService.create(params.id, body);
  sendCreated(res, { variants });
};

export const updateVariant: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    UpdateVariantInput,
    unknown,
    { id: string; variantId: string }
  >(req);
  const variants = await variantService.update(params.id, params.variantId, body);
  sendSuccess(res, { variants });
};

export const removeVariant: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string; variantId: string }>(req);
  const variants = await variantService.remove(params.id, params.variantId);
  sendSuccess(res, { variants });
};

/* --- Images --------------------------------------------------------------- */

export const listImages: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  const images = await imageService.list(params.id);
  sendSuccess(res, { images });
};

/** POST /api/v1/admin/products/:id/images — multipart, field name `images`. */
export const uploadImages: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  const files = Array.isArray(req.files) ? req.files : [];

  const images = await imageService.upload(
    params.id,
    files.map((file) => ({ buffer: file.buffer, originalname: file.originalname })),
  );
  sendCreated(res, { images });
};

export const removeImage: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string; imageId: string }>(req);
  const images = await imageService.remove(params.id, params.imageId);
  sendSuccess(res, { images });
};

export const reorderImages: RequestHandler = async (req, res) => {
  const { body, params } = validated<ReorderImagesInput, unknown, { id: string }>(req);
  const images = await imageService.reorder(params.id, body);
  sendSuccess(res, { images });
};

export const setFeaturedImage: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string; imageId: string }>(req);
  const images = await imageService.setFeatured(params.id, params.imageId);
  sendSuccess(res, { images });
};

/**
 * POST /api/v1/admin/products/:id/images/:imageId/states
 *
 * Multipart, field name `image`. One file: this is the other version of one
 * photograph, not a batch.
 */
export const uploadImageState: RequestHandler = async (req, res) => {
  const { body, params } = validated<
    UploadImageStateInput,
    unknown,
    { id: string; imageId: string }
  >(req);

  const files = Array.isArray(req.files) ? req.files : [];
  const file = files[0];

  if (!file) {
    throw new ValidationError([
      { field: "image", message: 'Attach one file in the "image" field.' },
    ]);
  }

  const images = await imageService.uploadState(params.id, params.imageId, {
    stateKey: body.stateKey,
    ...(body.label !== undefined ? { label: body.label } : {}),
    file: { buffer: file.buffer, originalname: file.originalname },
  });

  sendCreated(res, { images });
};

export const removeImageState: RequestHandler = async (req, res) => {
  const { params } = validated<
    unknown,
    unknown,
    { id: string; imageId: string; stateKey: string }
  >(req);

  const images = await imageService.removeState(params.id, params.imageId, params.stateKey);
  sendSuccess(res, { images });
};
