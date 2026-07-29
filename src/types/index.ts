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
  sortOrder: number;
}

export type VariantOptionName = "Color" | "Storage" | "Model";

/** One selectable axis on a product, e.g. Storage: 128GB / 256GB. */
export interface VariantOption {
  name: VariantOptionName;
  values: string[];
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

export interface Product {
  id: string;
  slug: string;
  title: string;
  brand: string;
  categoryId: string;
  /** Fallback price shown when a product has no variants. */
  price: Money;
  oldPrice?: Money;
  images: string[];
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
  /** Taller crop for phones. Falls back to `image` when absent. */
  imageMobile?: string;
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
  /** Short, speakable over the phone, e.g. "GNG-10247". */
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
}
