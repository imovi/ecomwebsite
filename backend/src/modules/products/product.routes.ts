import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { uploadImages } from "../../middleware/upload.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./product.controller.js";
import {
  adminListProductsQuerySchema,
  createProductSchema,
  createVariantSchema,
  deleteProductQuerySchema,
  facetsQuerySchema,
  homepageQuerySchema,
  listProductsQuerySchema,
  productIdParamSchema,
  productIdentifierParamSchema,
  productImageParamSchema,
  productStatusSchema,
  productVariantParamSchema,
  reorderImagesSchema,
  searchQuerySchema,
  updateProductSchema,
  updateVariantSchema,
} from "./product.validation.js";

/**
 * Product routes.
 *
 * Two routers, one visible security boundary:
 *
 *   /api/v1/products        public, read-only
 *   /api/v1/admin/products  authenticated, all writes
 *
 * Route ordering matters throughout — Express matches in declaration order, so
 * every literal path is registered before the `/:identifier` catch-all. With
 * the order reversed, `/products/trending` would be looked up as a product
 * whose slug is "trending".
 */

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export const productPublicRouter: Router = Router();

productPublicRouter.get(
  "/",
  validate({ query: listProductsQuerySchema }),
  controller.listPublic,
);

productPublicRouter.get(
  "/search",
  validate({ query: searchQuerySchema }),
  controller.search,
);

productPublicRouter.get(
  "/new-arrivals",
  validate({ query: homepageQuerySchema }),
  controller.newArrivals,
);

productPublicRouter.get(
  "/trending",
  validate({ query: homepageQuerySchema }),
  controller.trending,
);

productPublicRouter.get(
  "/facets",
  validate({ query: facetsQuerySchema }),
  controller.facets,
);

/* Catch-all last. */
productPublicRouter.get(
  "/:identifier",
  validate({ params: productIdentifierParamSchema }),
  controller.detailPublic,
);

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export const productAdminRouter: Router = Router();

/* Every route below requires a valid access token and at least `manager`.
   Catalogue upkeep is daily work; permanent deletion is separately gated to
   super_admin inside the controller. */
productAdminRouter.use(authenticate, requireRole("manager"));

productAdminRouter.get(
  "/",
  validate({ query: adminListProductsQuerySchema }),
  controller.listAdmin,
);

productAdminRouter.post(
  "/",
  validate({ body: createProductSchema }),
  controller.create,
);

productAdminRouter.get(
  "/:id",
  validate({ params: productIdParamSchema }),
  controller.detailAdmin,
);

productAdminRouter.patch(
  "/:id",
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  controller.update,
);

productAdminRouter.patch(
  "/:id/status",
  validate({ params: productIdParamSchema, body: productStatusSchema }),
  controller.setStatus,
);

productAdminRouter.delete(
  "/:id",
  validate({ params: productIdParamSchema, query: deleteProductQuerySchema }),
  controller.remove,
);

/* --- Variants ------------------------------------------------------------- */

productAdminRouter.get(
  "/:id/variants",
  validate({ params: productIdParamSchema }),
  controller.listVariants,
);

productAdminRouter.post(
  "/:id/variants",
  validate({ params: productIdParamSchema, body: createVariantSchema }),
  controller.createVariant,
);

productAdminRouter.patch(
  "/:id/variants/:variantId",
  validate({ params: productVariantParamSchema, body: updateVariantSchema }),
  controller.updateVariant,
);

productAdminRouter.delete(
  "/:id/variants/:variantId",
  validate({ params: productVariantParamSchema }),
  controller.removeVariant,
);

/* --- Images --------------------------------------------------------------- */

productAdminRouter.get(
  "/:id/images",
  validate({ params: productIdParamSchema }),
  controller.listImages,
);

/* Multer parses the multipart body before validation can look at `req.params`,
   which is populated by the router either way. */
productAdminRouter.post(
  "/:id/images",
  uploadImages("images"),
  validate({ params: productIdParamSchema }),
  controller.uploadImages,
);

productAdminRouter.patch(
  "/:id/images/reorder",
  validate({ params: productIdParamSchema, body: reorderImagesSchema }),
  controller.reorderImages,
);

productAdminRouter.patch(
  "/:id/images/:imageId/featured",
  validate({ params: productImageParamSchema }),
  controller.setFeaturedImage,
);

productAdminRouter.delete(
  "/:id/images/:imageId",
  validate({ params: productImageParamSchema }),
  controller.removeImage,
);
