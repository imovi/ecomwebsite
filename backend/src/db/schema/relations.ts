import { relations } from "drizzle-orm";
import { categories } from "./categories.js";
import { products } from "./products.js";
import { productImages } from "./product-images.js";
import { productImageStates } from "./product-image-states.js";
import { productVariants } from "./product-variants.js";
import { productMetrics } from "./product-metrics.js";
import { orders } from "./orders.js";
import { orderItems } from "./order-items.js";
import { orderEvents } from "./order-events.js";
import { admins } from "./admins.js";

/**
 * Relation graph.
 *
 * These declarations are what let a product detail read be a single round
 * trip: `db.query.products.findFirst({ with: { category, images, variants } })`
 * compiles to one statement with lateral joins instead of four sequential
 * queries. That matters most on the product page, which is the busiest read
 * in the catalogue.
 *
 *   categories 1 ──── n products
 *   products   1 ──── n product_images     (cascade delete)
 *   products   1 ──── n product_variants   (cascade delete)
 *   products   1 ──── 1 product_metrics    (cascade delete)
 *   product_variants n ──── 1 product_images (set null on image delete)
 */

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  variants: many(productVariants),
  metrics: one(productMetrics, {
    fields: [products.id],
    references: [productMetrics.productId],
  }),
}));

export const productImagesRelations = relations(productImages, ({ one, many }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
  /* Variants that display this image. */
  variants: many(productVariants),
  /* Alternate versions of this same shot — the lamp unlit, and whatever else
     the shop adds later. Empty for every image that has none. */
  states: many(productImageStates),
}));

export const productImageStatesRelations = relations(productImageStates, ({ one }) => ({
  image: one(productImages, {
    fields: [productImageStates.productImageId],
    references: [productImages.id],
  }),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
  image: one(productImages, {
    fields: [productVariants.imageId],
    references: [productImages.id],
  }),
}));

export const productMetricsRelations = relations(productMetrics, ({ one }) => ({
  product: one(products, {
    fields: [productMetrics.productId],
    references: [products.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Orders (Phase 3)                                                           */
/* -------------------------------------------------------------------------- */

/**
 *   orders 1 ──── n order_items    (cascade delete)
 *   orders 1 ──── n order_events   (cascade delete)
 *   order_items n ──── 1 products / product_variants   (SET NULL — a deleted
 *                     product must never delete the orders that contain it)
 *   order_events n ──── 1 admins   (RESTRICT — an audit entry keeps its author)
 *
 * Declaring these lets an order detail read — header, items and timeline —
 * compile to one statement instead of three sequential queries.
 */
export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
  events: many(orderEvents),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
  admin: one(admins, { fields: [orderEvents.adminId], references: [admins.id] }),
}));
