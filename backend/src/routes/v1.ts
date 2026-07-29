import { Router } from "express";
import { sendSuccess } from "../core/response.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import {
  categoryAdminRouter,
  categoryPublicRouter,
} from "../modules/categories/category.routes.js";
import {
  productAdminRouter,
  productPublicRouter,
} from "../modules/products/product.routes.js";
import {
  checkoutPublicRouter,
  orderAdminRouter,
} from "../modules/orders/order.routes.js";
import { settingsAdminRouter } from "../modules/settings/settings.routes.js";

/**
 * API v1.
 *
 * Versioning is by URL prefix (`/api/v1`) rather than a header. It is
 * greppable in logs and access rules, trivially cacheable, and a support
 * engineer can see the version in a URL a customer pasted. Header-based
 * negotiation is more elegant and, in practice, harder to operate.
 *
 * The versioning contract:
 *   - Additive changes (new endpoint, new optional field, new response field)
 *     ship inside v1.
 *   - Breaking changes (removing or renaming a field, changing a type,
 *     tightening validation) require v2, with v1 kept alive until clients move.
 *
 * Future phases mount their routers here — one line per module.
 */
export const v1Router: Router = Router();

/** Cheap discovery endpoint; also proves routing works without auth. */
v1Router.get("/", (_req, res) => {
  sendSuccess(res, {
    name: "gng API",
    version: "v1",
    documentation: "/api/v1/docs",
  });
});

v1Router.use("/auth", authRouter);

/* --- Catalog (Phase 2) ---------------------------------------------------
   Public routers are read-only and unauthenticated. Everything under /admin
   is authenticated and role-guarded by the router itself, so the security
   boundary is legible from this file alone. */
v1Router.use("/categories", categoryPublicRouter);
v1Router.use("/products", productPublicRouter);

v1Router.use("/admin/categories", categoryAdminRouter);
v1Router.use("/admin/products", productAdminRouter);

/* --- Orders (Phase 3) -----------------------------------------------------
   Checkout is the only public write surface in the API. There is no public
   order-lookup route by design: order numbers are sequential and an order
   record holds a name, a phone number and a home address. */
v1Router.use("/checkout", checkoutPublicRouter);

v1Router.use("/admin/orders", orderAdminRouter);
v1Router.use("/admin/settings", settingsAdminRouter);
