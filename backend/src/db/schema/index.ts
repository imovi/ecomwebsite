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

/* Phase 2 — catalog */
export * from "./catalog-enums.js";
export * from "./categories.js";
export * from "./products.js";
export * from "./product-images.js";
export * from "./product-variants.js";
export * from "./product-metrics.js";

/* Phase 3 — orders */
export * from "./order-enums.js";
export * from "./store-settings.js";
export * from "./orders.js";
export * from "./order-items.js";
export * from "./order-events.js";

export * from "./relations.js";
