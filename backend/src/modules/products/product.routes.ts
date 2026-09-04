import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { config } from "../../config/index.js";
import { TooManyRequestsError } from "../../core/errors.js";
import { authenticate, requireRole } from "../../middleware/authenticate.js";
import { customerKey } from "../../middleware/rate-limit.js";
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
  updateProductImageSchema,
  productImageStateParamSchema,
  uploadImageStateSchema,
  productStatusSchema,
  productVariantParamSchema,
  reorderImagesSchema,
  reorderProductsSchema,
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

/**
 * The one public read that no cache stands in front of.
 *
 * Every other listing here is served to the storefront through an ISR window,
 * so a burst of identical requests costs one query. Search deliberately is not
 * — a shopper looking for something that just sold out has to see that — which
 * means every distinct `?q=` reaches the database, and the storefront's own
 * calls are exempt from the global limit because they arrive from the private
 * network as infrastructure. Between those two facts, walking random query
 * strings was an unbounded way to make this shop run full-text searches until
 * it fell over, from one machine, with no login.
 *
 * Keyed by the SHOPPER, like the quote and the checkout: keyed on the
 * connection it would be one allowance for the whole shop, and the first script
 * to spend it would take search away from every real customer. The quote budget
 * is reused because the shape of the traffic is the same — a person typing,
 * repeatedly, on one page.
 */
const searchRateLimit: RequestHandler = rateLimit({
  windowMs: config.rateLimit.checkout.windowMs,
  limit: config.rateLimit.checkout.quoteMax,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `search:${customerKey(req)}`,
  handler: (_req, _res, next) => {
    next(new TooManyRequestsError(Math.ceil(config.rateLimit.checkout.windowMs / 1000)));
  },
});

productPublicRouter.get(
  "/",
  validate({ query: listProductsQuerySchema }),
  controller.listPublic,
);

productPublicRouter.get(
  "/search",
  searchRateLimit,
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

productAdminRouter.patch(
  "/reorder",
  validate({ body: reorderProductsSchema }),
  controller.reorder,
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

productAdminRouter.patch(
  "/:id/images/:imageId",
  validate({ params: productImageParamSchema, body: updateProductImageSchema }),
  controller.updateImage,
);

/* Declared BEFORE the catch-all delete below, which would otherwise match
   `/images/:imageId` and swallow the state path's first segment. */
productAdminRouter.post(
  "/:id/images/:imageId/states",
  /* Same note as the gallery upload: multer parses the multipart body first,
     and `req.params` is populated by the router either way. */
  uploadImages("image"),
  validate({ params: productImageParamSchema, body: uploadImageStateSchema }),
  controller.uploadImageState,
);

productAdminRouter.delete(
  "/:id/images/:imageId/states/:stateKey",
  validate({ params: productImageStateParamSchema }),
  controller.removeImageState,
);

productAdminRouter.delete(
  "/:id/images/:imageId",
  validate({ params: productImageParamSchema }),
  controller.removeImage,
);
