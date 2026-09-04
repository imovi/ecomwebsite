/**
 * Domain types for the gng storefront.
 *
 * Money rule: every currency value in this app is an INTEGER number of taka.
 * Never a float. Formatting to "৳12,500" happens only at the view layer via
 * `formatTaka`. This removes a whole class of rounding bugs from totals.
 */

export type Money = number;

/* -------------------------------------------------------------------------- */
/* Catalog                                                                    */
/* -------------------------------------------------------------------------- */

export interface Category {
  id: string;
  name: string;
  slug: string;
  /** Key into the icon registry in `components/ui/Icon`. */
  icon: string;
  /**
   * Custom artwork, when the shop uploaded some. Takes precedence over `icon` —
   * an operator who bothered to upload a picture meant it to be used.
   */
  imageUrl?: string | undefined;
  sortOrder: number;
}

/**
 * A variant axis name, e.g. "Color", "Storage", "Size", "Model".
 *
 * Deliberately `string` rather than a closed union: the axes are defined per
 * product in the admin panel, so the catalogue — not this file — decides what
 * they are. A union here would reject a legitimate "Size" or "Length" the
 * moment a merchant created one.
 */
export type VariantOptionName = string;

/** One selectable axis on a product, e.g. Storage: 128GB / 256GB. */
export interface VariantOption {
  name: VariantOptionName;
  values: string[];
  /**
   * Whether the shopper picks by reading a word or by looking at a picture.
   *
   * Per axis, because a phone in three colours and two storage tiers wants
   * both: swatches for Colour, where "Midnight Green" means nothing until you
   * see it, and text for Storage, where a photograph of 256GB does not exist.
   *
   * Absent means text. Every product saved before this existed has no such
   * value and must keep rendering exactly as it does today.
   */
  display?: "text" | "image";
}

/**
 * A concrete purchasable combination. `options` maps every option name on the
 * parent product to one of its values, so the picker can resolve a selection
 * to exactly one variant.
 */
export interface Variant {
  id: string;
  sku: string;
  options: Partial<Record<VariantOptionName, string>>;
  price: Money;
  oldPrice?: Money;
  stock: number;
  /** Index into the parent product's `images`, shown when this is selected. */
  imageIndex?: number;
}

export type ProductStatus = "active" | "draft" | "archived";

/** An alternate version of a gallery photo — the same frame, light off. */
export interface ProductImageState {
  key: string;
  label: string;
  url: string;
  width: number;
  height: number;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  /** Stable merchant identifier. Doubles as the content id for ad tracking. */
  sku: string;
  /** Optional: plenty of stock has no meaningful brand. */
  brand: string | null;
  categoryId: string;
  /** Fallback price shown when a product has no variants. */
  price: Money;
  oldPrice?: Money;
  images: string[];
  /**
   * The same shots with the light off, positionally aligned with `images`.
   * `null` where a photo has no unlit version — which is most of them.
   */
  imageStates: (ProductImageState | null)[];
  /** Whether the shopper is offered the on/off switch on this product. */
  interactiveEnabled: boolean;
  description: string;
  /** Ordered spec rows, rendered as a definition list. */
  specs: { label: string; value: string }[];
  included: string[];
  warranty: string;
  options: VariantOption[];
  variants: Variant[];
  status: ProductStatus;
  /**
   * Manual override for the Trending rail. Lower sorts first, and always
   * outranks the computed sales score. Needed on day one, before any sales
   * data exists, and during campaigns.
   */
  pinnedRank?: number;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Merchandising                                                              */
/* -------------------------------------------------------------------------- */

export interface Banner {
  id: string;
  /** Wide crop for tablet/desktop. */
  image: string;
  /**
   * Real size of the wide crop, used to shape the slider to the artwork the shop
   * uploaded. 0 means unknown — banners created before this was recorded.
   */
  width: number;
  height: number;
  /** Taller crop for phones. Falls back to `image` when absent. */
  imageMobile?: string;
  mobileWidth?: number | undefined;
  mobileHeight?: number | undefined;
  alt: string;
  href: string;
  sortOrder: number;
  active: boolean;
}

export type CouponType = "percent" | "fixed";

export interface Coupon {
  code: string;
  type: CouponType;
  /** Percent (0-100) when type is "percent", taka when "fixed". */
  value: number;
  minOrder: Money;
  /** Caps the discount for percent coupons. 0 means uncapped. */
  maxDiscount: Money;
  usageLimit: number;
  usedCount: number;
  expiresAt: string;
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

export type DeliveryZone = "inside_dhaka" | "outside_dhaka";

/**
 * Explicit lifecycle. CONFIRMED exists so the confirmation phone call is a
 * tracked state transition rather than an informal habit — it is also the gate
 * that keeps unconfirmed COD orders out of revenue and trending numbers.
 */
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

export interface OrderItem {
  productId: string;
  variantId?: string;
  slug: string;
  /** Snapshots. Editing a product must never rewrite order history. */
  titleSnapshot: string;
  variantLabel?: string;
  priceSnapshot: Money;
  imageSnapshot: string;
  qty: number;
}

export interface Order {
  id: string;
  /** Short, speakable over the phone, e.g. "HINAR-10247". */
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  /** Free-text area/thana/district exactly as the customer typed it. */
  areaText: string;
  /** The customer's final selection — never re-derived after placement. */
  zone: DeliveryZone;
  items: OrderItem[];
  subtotal: Money;
  deliveryCharge: Money;
  discount: Money;
  couponCode?: string;
  total: Money;
  paymentMethod: "cod";
  status: OrderStatus;
  /** Free-text log of confirmation-call outcomes, newest last. */
  notes: string[];
  createdAt: string;
}

/** Derived from orders, keyed by phone. There are no customer accounts. */
export interface Customer {
  phone: string;
  name: string;
  ordersCount: number;
  deliveredCount: number;
  returnedCount: number;
  totalSpent: Money;
  lastOrderAt: string;
}

/* -------------------------------------------------------------------------- */
/* Cart                                                                       */
/* -------------------------------------------------------------------------- */

/** What the cart store holds. Prices are re-read from the catalog on render,
 *  so a stale localStorage cart can never show an outdated price. */
export interface CartLine {
  productId: string;
  variantId?: string;
  qty: number;
}

/* A cart line joined against the live catalog is `ResolvedLine`, defined in
   `lib/catalog-utils` — it works off the trimmed client projection rather than
   the full `Product`, so the cart doesn't ship descriptions and specs to the
   browser. */

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface StoreSettings {
  deliveryInsideDhaka: Money;
  deliveryOutsideDhaka: Money;
  /** Subtotal at or above which delivery is free. 0 disables the rule. */
  freeDeliveryThreshold: Money;
  whatsappNumber: string;
  hotline: string;
  /** Uploaded shop logo. Null falls back to the wordmark. */
  logoUrl?: string | undefined;
  /** Real logo size, so the header can size it by its own proportions. */
  logoWidth?: number | undefined;
  logoHeight?: number | undefined;
  /** Shop name, used as the logo's alt text and the wordmark itself. */
  storeName?: string | undefined;
  /** Uploaded browser-tab icon. Undefined falls back to the bundled one. */
  faviconUrl?: string | undefined;
  /** Footer line under the shop's name. Undefined uses the built-in tagline. */
  tagline?: string | undefined;
  /** Free footer line under the copyright. Undefined renders nothing. */
  footerNote?: string | undefined;
  /** Page title override. Undefined uses `<store name> — <tagline>`. */
  seoTitle?: string | undefined;
  /** Meta description override. Undefined uses the built-in sentence. */
  seoDescription?: string | undefined;
  /** Top announcement bar text. Undefined uses built-in default. */
  announcementText?: string | undefined;
  /** Whether the top announcement bar is visible. Undefined means visible. */
  announcementEnabled?: boolean | undefined;
  /** Optional link destination for the top announcement bar. */
  announcementLink?: string | undefined;
}
