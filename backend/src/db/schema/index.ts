/**
 * Schema barrel.
 *
 * Drizzle needs one object containing every table to build the typed query
 * API and to diff for migrations, so new tables must be re-exported here.
 */

/* Phase 1 — identity */
export * from "./enums.js";
export * from "./admins.js";
export * from "./refresh-tokens.js";
export * from "./admin-password-resets.js";
export * from "./blocked-ips.js";

/* Phase 2 — catalog */
export * from "./catalog-enums.js";
export * from "./categories.js";
export * from "./products.js";
export * from "./product-images.js";
export * from "./product-image-states.js";
export * from "./product-variants.js";
export * from "./product-metrics.js";

/* Phase 3 — orders */
export * from "./order-enums.js";
export * from "./banners.js";
export * from "./store-settings.js";
export * from "./orders.js";
export * from "./order-items.js";
export * from "./order-events.js";

/* Phase 4 — profit and loss */
export * from "./expenses.js";
/* Campaigns the shop has registered, so their spend can be read back. */
export * from "./ad-campaigns.js";

/* Phase 5 — recovering incomplete checkouts */
export * from "./abandoned-checkouts.js";
export * from "./abandoned-checkout-events.js";
export * from "./recovery-coupons.js";
export * from "./coupon-redemptions.js";

/* Phase 6 — courier hand-off */
export * from "./courier-shipments.js";

export * from "./relations.js";

/* Checking a phone number's delivery record with the couriers. */
export * from "./courier-fraud.js";
