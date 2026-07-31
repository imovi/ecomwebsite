/**
 * Backend response shapes.
 *
 * A hand-written mirror of the API's DTOs rather than a shared package: the
 * storefront and the API deploy independently, and a compile-time coupling
 * between them would mean neither can ship without the other. These types are
 * the contract; the adapters in `./adapters.ts` are where drift shows up as a
 * type error instead of a runtime surprise.
 *
 * Kept in sync with the DTO files under `backend/src/modules`.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: {
    pagination?: {
      page: number;
      perPage: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
  requestId: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string }[];
  };
  requestId: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/* -------------------------------------------------------------------------- */
/* Catalog                                                                    */
/* -------------------------------------------------------------------------- */

export interface ApiCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiProductImage {
  id: string;
  url: string;
  alt: string | null;
  width: number;
  height: number;
  isFeatured: boolean;
  sortOrder: number;
}

export interface ApiProductVariant {
  id: string;
  sku: string;
  options: Record<string, string>;
  price: number;
  oldPrice: number | null;
  discountPercent: number;
  stockQuantity: number;
  inStock: boolean;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  /** Admin responses only — see `costPrice` on the product. */
  costPrice?: number | null;
}

export interface ApiCategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface ApiProductListItem {
  id: string;
  name: string;
  slug: string;
  sku: string;
  /** Null when the product has no meaningful brand. */
  brand: string | null;
  category: ApiCategorySummary | null;
  price: number;
  oldPrice: number | null;
  discountPercent: number;
  stockQuantity: number;
  stockStatus: "in_stock" | "out_of_stock" | "pre_order" | "discontinued";
  inStock: boolean;
  isLowStock: boolean;
  featuredImage: ApiProductImage | null;
  tags: string[];
  status?: "draft" | "active" | "archived";
  isVisible?: boolean;
  /**
   * What the shop pays for one unit. Admin responses only — the API omits it
   * entirely for the storefront, so this is optional rather than nullable-only.
   */
  costPrice?: number | null;
  createdAt: string;
}

export interface ApiProduct extends Omit<ApiProductListItem, "featuredImage"> {
  shortDescription: string | null;
  description: string | null;
  specifications: { label: string; value: string }[];
  whatsIncluded: string[];
  warranty: string | null;
  variantOptions: { name: string; values: string[] }[];
  featuredImage: ApiProductImage | null;
  images: ApiProductImage[];
  variants: ApiProductVariant[];
  lowStockThreshold: number;
  publishedAt: string | null;
  updatedAt: string;
}

export interface ApiBanner {
  id: string;
  imageUrl: string;
  /** Real size of the stored artwork. 0 for banners uploaded before this existed. */
  imageWidth: number;
  imageHeight: number;
  /** Null when no phone-specific crop was uploaded. */
  imageMobileUrl: string | null;
  imageMobileWidth: number | null;
  imageMobileHeight: number | null;
  alt: string;
  href: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiFacets {
  brands: { name: string; productCount: number }[];
  priceRange: { min: number; max: number };
}

/* -------------------------------------------------------------------------- */
/* Checkout and orders                                                        */
/* -------------------------------------------------------------------------- */

export type ApiDeliveryZone = "inside_dhaka" | "outside_dhaka";

export type ApiOrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

export interface ApiQuote {
  items: {
    productId: string;
    variantId: string | null;
    productName: string;
    variantLabel: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  deliveryZone: ApiDeliveryZone | null;
  zoneInferred: boolean;
  zoneMatchedOn: string | null;
  freeDeliveryThreshold: number;
  amountToFreeDelivery: number;
}

export interface ApiOrderItem {
  productName: string;
  productSlug: string;
  sku: string;
  variantLabel: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface ApiOrderConfirmation {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  areaText: string;
  deliveryZone: ApiDeliveryZone;
  status: ApiOrderStatus;
  paymentMethod: "cod";
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  items: ApiOrderItem[];
  placedAt: string;
}

/** Public tracking projection — deliberately narrower than the admin view. */
export interface ApiOrderTracking {
  orderNumber: string;
  status: ApiOrderStatus;
  placedAt: string;
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  paymentMethod: "cod";
  /**
   * Where the parcel is, once it has been handed to a courier.
   *
   * `status` is the shop's own vocabulary, never the courier's raw code — they
   * report things like `partial_delivered_return_pending` and change the
   * wording without notice.
   */
  courier?: {
    status:
      | "pending"
      | "picked_up"
      | "in_transit"
      | "out_for_delivery"
      | "delivered"
      | "returned"
      | "cancelled"
      | "unknown";
    trackingCode: string | null;
    provider: string;
  };
  items: Pick<ApiOrderItem, "productName" | "variantLabel" | "imageUrl" | "quantity">[];
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                     */
/* -------------------------------------------------------------------------- */

export interface ApiAdmin {
  id: string;
  email: string;
  name: string;
  role: "manager" | "admin" | "super_admin";
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface ApiLogin {
  admin: ApiAdmin;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export interface ApiOrderListItem {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  areaText: string;
  deliveryZone: ApiDeliveryZone;
  status: ApiOrderStatus;
  paymentMethod: "cod";
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
}

export interface ApiOrderEvent {
  id: string;
  type: string;
  field: string | null;
  previousValue: unknown;
  newValue: unknown;
  actorName: string;
  adminId: string | null;
  note: string | null;
  createdAt: string;
}

export interface ApiOrderDetail extends ApiOrderListItem {
  address: string;
  internalNotes: string | null;
  cancellationReason: string | null;
  version: number;
  items: (ApiOrderItem & { id: string; productId: string | null; variantId: string | null })[];
  timeline: ApiOrderEvent[];
  allowedTransitions: ApiOrderStatus[];
  updatedAt: string;
}

export interface ApiStoreSettings {
  delivery: {
    insideDhaka: number;
    outsideDhaka: number;
    freeDeliveryThreshold: number;
  };
  ordering: {
    minimumOrderValue: number;
    maxQuantityPerItem: number;
  };
  /**
   * What an order costs the shop, as opposed to what it charges for.
   *
   * `courier*` is what the courier bills, which is a different number from
   * `delivery.*` above — what the customer pays. The gap is a real cost.
   */
  costs: {
    courierInsideDhaka: number;
    courierOutsideDhaka: number;
    packagingPerOrder: number;
    returnPerOrder: number;
  };
  /**
   * Courier hand-off. The key and secret are never returned — same write-only
   * rule as every other credential.
   */
  courier: {
    provider: string;
    hasCredentials: boolean;
    apiKeyHint: string;
    storeId: string;
    baseUrl: string;
    enabled: boolean;
  };
  store: {
    name: string;
    phone: string;
    email: string;
    address: string;
    invoiceFooter: string;
    /** Resolved URL of the uploaded logo. Null means "use the wordmark". */
    logoUrl: string | null;
    logoWidth: number | null;
    logoHeight: number | null;
  };
  /**
   * Meta / Facebook tracking.
   *
   * The Conversions API token is deliberately absent — it is write-only. The API
   * returns only whether one is set and a masked hint, so a live credential
   * never travels back to a browser.
   */
  tracking: {
    pixelId: string;
    testEventCode: string;
    domainVerification: string;
    enabled: boolean;
    hasCapiToken: boolean;
    /** Last four characters, e.g. `••••4f2a`. Empty when unset. */
    capiTokenHint: string;
    /** Google Tag Manager container id, e.g. `GTM-ABC1234`. */
    gtmContainerId: string;
    gtmEnabled: boolean;
  };
  /**
   * Order integrations. The two credentials are absent by design — write-only,
   * so only "is one set" and a masked hint travel back.
   */
  integrations: {
    telegram: {
      hasBotToken: boolean;
      botTokenHint: string;
      chatId: string;
      enabled: boolean;
    };
    googleSheets: {
      hasCredentials: boolean;
      /** Public, and needed to share the sheet with the account. */
      serviceAccountEmail: string | null;
      sheetId: string;
      tab: string;
      enabled: boolean;
    };
  };
  updatedAt: string;
}
