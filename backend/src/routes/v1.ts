import { Router } from "express";
import { sendSuccess } from "../core/response.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { teamAdminRouter } from "../modules/admins/admin.routes.js";
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
import { storefrontRouter } from "../modules/orders/storefront.routes.js";
import { customerAdminRouter } from "../modules/customers/customer.routes.js";
import { overviewAdminRouter } from "../modules/overview/overview.routes.js";
import { fraudAdminRouter } from "../modules/fraud/fraud.routes.js";
import {
  bannerAdminRouter,
  bannerPublicRouter,
} from "../modules/banners/banner.routes.js";
import { integrationsAdminRouter } from "../modules/integrations/integrations.routes.js";
import { expensesAdminRouter } from "../modules/reports/expense.routes.js";
import { reportsAdminRouter } from "../modules/reports/profit.routes.js";
import {
  abandonedAdminRouter,
  abandonedPublicRouter,
} from "../modules/orders/abandoned.routes.js";
import { courierAdminRouter } from "../modules/courier/courier.routes.js";
import { webhookRouter } from "../modules/courier/webhook.routes.js";
import { marketingAdminRouter } from "../modules/marketing/marketing.routes.js";
import { settingsAdminRouter } from "../modules/settings/settings.routes.js";
import { blockedIpAdminRouter } from "../modules/security/blocked-ip.routes.js";

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
v1Router.use("/banners", bannerPublicRouter);
v1Router.use("/categories", categoryPublicRouter);
v1Router.use("/products", productPublicRouter);

v1Router.use("/admin/banners", bannerAdminRouter);
v1Router.use("/admin/categories", categoryAdminRouter);
v1Router.use("/admin/products", productAdminRouter);

/* --- Orders (Phase 3) -----------------------------------------------------
   Checkout is the only public WRITE surface in the API. Public order tracking
   exists but requires both the order number and its matching phone number,
   returns a narrow projection, and is rate limited — see storefront.routes.ts. */
v1Router.use("/checkout", checkoutPublicRouter);

/* Incomplete checkouts. Public, because it is the storefront recording a
   customer who is still typing — same trust level as the quote endpoint. */
v1Router.use("/checkout", abandonedPublicRouter);

/* Public storefront reads: delivery pricing, contact details, and order
   tracking that requires BOTH the order number and its matching phone. */
v1Router.use("/storefront", storefrontRouter);

v1Router.use("/admin/orders", orderAdminRouter);

/* --- Customers -----------------------------------------------------------
   Not a table. Derived from orders, grouped by phone, because the phone number
   IS the customer identity on a shop nobody registers for — see the module.
   `manager` and above: this is the order desk's call list and return history. */
v1Router.use("/admin/customers", customerAdminRouter);

/* --- The dashboard -------------------------------------------------------
   One summary rather than the five requests the screen would otherwise make on
   every load. `manager` and above; the takings are withheld below `admin`
   inside the service, so the order desk gets its work and not the accounts. */
v1Router.use("/admin/overview", overviewAdminRouter);

/* --- Has this number taken delivery before? ------------------------------
   Asks the couriers' own merchant panels. Reading is `manager` — it is the
   confirmation call's job. Configuring is `super_admin`: these are the shop's
   real courier passwords, not a scoped API key. See the module. */
v1Router.use("/admin/fraud", fraudAdminRouter);

/* --- Refusing an address --------------------------------------------------
   The block list behind the order page's "block this address" button. `admin`
   and above — see the router. Read the schema before touching it: in this
   country one address can be a carrier's worth of real customers. */
v1Router.use("/admin/ips", blockedIpAdminRouter);
v1Router.use("/admin/settings", settingsAdminRouter);

/* --- Team ----------------------------------------------------------------
   Managing who can sign in is `super_admin` only — see the router. */
v1Router.use("/admin/team", teamAdminRouter);

/* --- Marketing -----------------------------------------------------------
   Tracking configuration lives in store settings; this router adds the
   connection status and the diagnostic test event the dashboard needs. */
v1Router.use("/admin/marketing", marketingAdminRouter);

/* --- Money out -----------------------------------------------------------
   Ads, rent, salaries: the costs that never pass through an order and without
   which "profit" is only gross margin. */
/* --- The call list -------------------------------------------------------
   Customers who started a checkout and left. `manager` and above: this is the
   order desk's daily work, not a commercial setting. */
v1Router.use("/admin/abandoned", abandonedAdminRouter);

/* --- Courier -------------------------------------------------------------
   Handing parcels over and reading their status back. `manager` and above:
   this is the order desk's job, right after the confirmation call. */
v1Router.use("/admin/courier", courierAdminRouter);

/* Inbound from the courier itself — public, and the only unauthenticated route
   here that can move an order. Guarded by a bearer secret set in the panel; see
   webhook.routes.ts for why it answers in the courier's response shape rather
   than this API's envelope. */
v1Router.use("/webhooks", webhookRouter);

v1Router.use("/admin/expenses", expensesAdminRouter);

/* --- Profit and loss -----------------------------------------------------
   Reads only. Margins and buying prices are the shop's most sensitive
   commercial numbers, so this sits at `admin`, not `manager`. */
v1Router.use("/admin/reports", reportsAdminRouter);

/* --- Order integrations --------------------------------------------------
   Telegram alerts and the Google Sheets export. Configured in store settings;
   this router adds status and the diagnostic buttons. */
v1Router.use("/admin/integrations", integrationsAdminRouter);
