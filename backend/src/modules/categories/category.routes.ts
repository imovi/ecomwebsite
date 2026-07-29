import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { uploadImage } from "../../middleware/upload.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./category.controller.js";
import {
  categoryIdParamSchema,
  categoryIdentifierSchema,
  categoryStatusSchema,
  createCategorySchema,
  reorderCategoriesSchema,
  updateCategorySchema,
} from "./category.validation.js";

/**
 * Category routes.
 *
 * Split into two routers so the security boundary is visible in the URL:
 * everything under `/admin` is authenticated, everything else is public and
 * read-only. A reviewer can confirm the boundary by reading the mount points
 * rather than auditing every handler.
 */

/* -------------------------------------------------------------------------- */
/* Public — read only                                                         */
/* -------------------------------------------------------------------------- */

export const categoryPublicRouter: Router = Router();

categoryPublicRouter.get("/", controller.listPublic);

categoryPublicRouter.get(
  "/:identifier",
  validate({ params: categoryIdentifierSchema }),
  controller.detailPublic,
);

/* -------------------------------------------------------------------------- */
/* Admin — authenticated writes                                               */
/* -------------------------------------------------------------------------- */

export const categoryAdminRouter: Router = Router();

/* Applied to every route below. `manager` is the floor: catalogue upkeep is
   day-to-day work, not something that should require the owner's account. */
categoryAdminRouter.use(authenticate, requireRole("manager"));

categoryAdminRouter.get("/", controller.listAdmin);

/* Literal paths before parameterised ones — Express matches in declaration
   order, and `/:id` would otherwise swallow `/reorder`. */
categoryAdminRouter.patch(
  "/reorder",
  validate({ body: reorderCategoriesSchema }),
  controller.reorder,
);

categoryAdminRouter.post(
  "/",
  validate({ body: createCategorySchema }),
  controller.create,
);

categoryAdminRouter.get(
  "/:id",
  validate({ params: categoryIdParamSchema }),
  controller.detailAdmin,
);

categoryAdminRouter.patch(
  "/:id",
  validate({ params: categoryIdParamSchema, body: updateCategorySchema }),
  controller.update,
);

categoryAdminRouter.patch(
  "/:id/status",
  validate({ params: categoryIdParamSchema, body: categoryStatusSchema }),
  controller.setStatus,
);

categoryAdminRouter.delete(
  "/:id",
  validate({ params: categoryIdParamSchema }),
  controller.remove,
);

/* Multer runs before validation: `req.params` is available either way, and the
   multipart body must be parsed before anything can inspect it. */
categoryAdminRouter.post(
  "/:id/image",
  uploadImage("image"),
  validate({ params: categoryIdParamSchema }),
  controller.uploadImage,
);

categoryAdminRouter.delete(
  "/:id/image",
  validate({ params: categoryIdParamSchema }),
  controller.removeImage,
);
