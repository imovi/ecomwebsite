import type { RequestHandler } from "express";
import { BadRequestError } from "../../core/errors.js";
import { sendCreated, sendNoContent, sendSuccess } from "../../core/response.js";
import { validated } from "../../middleware/validate.js";
import * as service from "./category.service.js";
import type {
  CreateCategoryInput,
  ReorderCategoriesInput,
  UpdateCategoryInput,
} from "./category.validation.js";

/**
 * Category HTTP layer.
 *
 * Translation only — no rules, no database access. Everything meaningful lives
 * in `category.service.ts`, which is why it can be exercised without an HTTP
 * server.
 */

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/categories */
export const listPublic: RequestHandler = async (_req, res) => {
  const categories = await service.list({ includeInactive: false });
  sendSuccess(res, { categories });
};

/** GET /api/v1/categories/:identifier — accepts a uuid or a slug. */
export const detailPublic: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { identifier: string }>(req);
  const category = await service.getByIdentifier(params.identifier);
  sendSuccess(res, { category });
};

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/admin/categories — includes disabled categories. */
export const listAdmin: RequestHandler = async (_req, res) => {
  const categories = await service.list({ includeInactive: true });
  sendSuccess(res, { categories });
};

/** GET /api/v1/admin/categories/:id */
export const detailAdmin: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  const category = await service.getByIdentifier(params.id, { includeInactive: true });
  sendSuccess(res, { category });
};

/** POST /api/v1/admin/categories */
export const create: RequestHandler = async (req, res) => {
  const { body } = validated<CreateCategoryInput>(req);
  const category = await service.create(body);
  sendCreated(res, { category }, `/api/v1/categories/${category.slug}`);
};

/** PATCH /api/v1/admin/categories/:id */
export const update: RequestHandler = async (req, res) => {
  const { body, params } = validated<UpdateCategoryInput, unknown, { id: string }>(req);
  const category = await service.update(params.id, body);
  sendSuccess(res, { category });
};

/** PATCH /api/v1/admin/categories/:id/status */
export const setStatus: RequestHandler = async (req, res) => {
  const { body, params } = validated<{ isActive: boolean }, unknown, { id: string }>(req);
  const category = await service.setActive(params.id, body.isActive);
  sendSuccess(res, { category });
};

/**
 * PATCH /api/v1/admin/categories/reorder
 *
 * Mounted before `/:id` so the literal path is not captured by the parameter
 * route — Express matches in declaration order.
 */
export const reorder: RequestHandler = async (req, res) => {
  const { body } = validated<ReorderCategoriesInput>(req);
  const categories = await service.reorder(body);
  sendSuccess(res, { categories });
};

/** DELETE /api/v1/admin/categories/:id */
export const remove: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  await service.remove(params.id);
  sendNoContent(res);
};

/** POST /api/v1/admin/categories/:id/image — multipart, field name `image`. */
export const uploadImage: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);

  if (!req.file) {
    throw new BadRequestError('No file received. Send one file in the "image" field.');
  }

  const category = await service.setImage(params.id, {
    buffer: req.file.buffer,
    originalname: req.file.originalname,
  });
  sendSuccess(res, { category });
};

/** DELETE /api/v1/admin/categories/:id/image */
export const removeImage: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, { id: string }>(req);
  const category = await service.removeImage(params.id);
  sendSuccess(res, { category });
};
