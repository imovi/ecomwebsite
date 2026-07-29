import type { Banner, Coupon, StoreSettings } from "@/types";

export const settings: StoreSettings = {
  deliveryInsideDhaka: 80,
  deliveryOutsideDhaka: 130,
  /** Above this subtotal delivery is free. Set to 0 to disable the rule. */
  freeDeliveryThreshold: 20000,
  whatsappNumber: "8801700000000",
  hotline: "09612000000",
};

/**
 * Max three slides, by design.
 *
 * Carousels have poor click-through and the first slide is almost always the
 * LCP element — more slides is more weight for traffic that never sees them.
 * Slide 1 is preloaded; slides 2 and 3 lazy-load.
 */
export const banners: Banner[] = [
  {
    id: "b-1",
    image: "/banners/banner-1.svg",
    imageMobile: "/banners/banner-1-mobile.svg",
    alt: "iPhone 15 Pro Max now in stock with cash on delivery nationwide",
    href: "/product/iphone-15-pro-max",
    sortOrder: 1,
    active: true,
  },
  {
    id: "b-2",
    image: "/banners/banner-2.svg",
    imageMobile: "/banners/banner-2-mobile.svg",
    alt: "Up to 25% off audio — AirPods, Sony and Soundcore",
    href: "/category/audio",
    sortOrder: 2,
    active: true,
  },
  {
    id: "b-3",
    image: "/banners/banner-3.svg",
    imageMobile: "/banners/banner-3-mobile.svg",
    alt: "Free delivery on orders over 20,000 taka",
    href: "/category/laptops",
    sortOrder: 3,
    active: true,
  },
];

export const coupons: Coupon[] = [
  {
    code: "GNG100",
    type: "fixed",
    value: 100,
    minOrder: 1500,
    maxDiscount: 0,
    usageLimit: 500,
    usedCount: 138,
    expiresAt: "2026-12-31T23:59:59.000Z",
    active: true,
  },
  {
    code: "EIDSALE",
    type: "percent",
    value: 5,
    minOrder: 5000,
    maxDiscount: 2000,
    usageLimit: 1000,
    usedCount: 402,
    expiresAt: "2026-09-30T23:59:59.000Z",
    active: true,
  },
  {
    code: "NEW50",
    type: "fixed",
    value: 50,
    minOrder: 800,
    maxDiscount: 0,
    usageLimit: 2000,
    usedCount: 917,
    expiresAt: "2026-10-31T23:59:59.000Z",
    active: true,
  },
  {
    code: "WINTER10",
    type: "percent",
    value: 10,
    minOrder: 10000,
    maxDiscount: 3000,
    usageLimit: 300,
    usedCount: 300,
    expiresAt: "2026-02-28T23:59:59.000Z",
    active: false,
  },
];
