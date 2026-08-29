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

/** An alternate version of a gallery photo — the same shot, lamp switched off. */
export interface ApiProductImageState {
  key: string;
  label: string;
  url: string;
  width: number;
  height: number;
}

export interface ApiProductImage {
  id: string;
  url: string;
  alt: string | null;
  width: number;
  height: number;
  isFeatured: boolean;
  sortOrder: number;
  /** Empty for every photo without one, which is every photo by default. */
  states: ApiProductImageState[];
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
  /**
   * What THIS product costs to ship and to box. Admin responses only.
   *
   * Null means "use the shop default", which is a different state from 0 — zero
   * would claim the item ships free.
   */
  courierCostInsideDhaka?: number | null;
  courierCostOutsideDhaka?: number | null;
  packagingCost?: number | null;
  createdAt: string;
}

export interface ApiProduct extends Omit<ApiProductListItem, "featuredImage"> {
  shortDescription: string | null;
  description: string | null;
  specifications: { label: string; value: string }[];
  whatsIncluded: string[];
  warranty: string | null;
  /** `display` absent means text — see `VariantOption` in `@/types`. */
  variantOptions: { name: string; values: string[]; display?: "text" | "image" }[];
  featuredImage: ApiProductImage | null;
  images: ApiProductImage[];
  /**
   * Whether the storefront offers this product's alternate image states.
   *
   * Independent of whether any state image exists — the shop can upload the
   * unlit photos, look at them, and switch this on afterwards.
   */
  interactiveEnabled: boolean;
  variants: ApiProductVariant[];
  lowStockThreshold: number;
  publishedAt: string | null;
  updatedAt: string;
}

/**
 * A customer, aggregated from their orders.
 *
 * There is no customers table: the phone number is the identity on a shop nobody
 * registers for, so every field here is folded from that phone's orders. Name and
 * address come from the most recent one.
 */
export interface ApiCustomer {
  phone: string;
  name: string;
  address: string;
  areaText: string;
  deliveryZone: string;
  orderCount: number;
  deliveredCount: number;
  returnedCount: number;
  cancelledCount: number;
  /** Delivered orders only — what the shop actually took. */
  spent: number;
  /** Every order placed, delivered or not. */
  placedValue: number;
  /** Delivered vs settled, as a percentage. Null when nothing has settled yet. */
  successRate: number | null;
  firstOrderAt: string;
  lastOrderAt: string;
}

/**
 * The dashboard summary.
 *
 * `money` is absent — not zero, absent — for a `manager`, because the API omits
 * it below `admin` rather than sending numbers the screen then hides.
 */
export interface ApiOverview {
  money?: {
    today: ApiOverviewDay;
    yesterday: ApiOverviewDay;
  };
  sources: {
    windowDays: number;
    /** `source: null` is the storefront — the customer checked out unaided. */
    breakdown: { source: string | null; orders: number }[];
  };
  parcels: {
    inTransit: number;
    /** A subset of `inTransit` — never add this to it. */
    needsAttention: number;
    failing: number;
  };
  callList: { abandonedOpen: number };
  returns: { returned: number; settled: number; windowDays: number };
}

export interface ApiOverviewDay {
  delivered: number;
  deliveredOrders: number;
  placedOrders: number;
  placedValue: number;
}

/* -------------------------------------------------------------------------- */
/* Courier delivery record                                                    */
/* -------------------------------------------------------------------------- */

export type ApiFraudCourier = "steadfast" | "pathao" | "redx" | "paperfly" | "carrybee";

export interface ApiFraudCourierResult {
  courier: ApiFraudCourier;
  label: string;
  success: number;
  cancel: number;
  total: number;
  successRatio: number;
}

/**
 * A courier that was asked and did not answer.
 *
 * Kept apart from the results on purpose: a courier that failed must never be
 * read as a customer with nothing delivered.
 */
export interface ApiFraudFailure {
  courier: ApiFraudCourier;
  label: string;
  kind: "credentials" | "upstream";
  message: string;
}

export interface ApiFraudReport {
  phone: string;
  couriers: ApiFraudCourierResult[];
  failures: ApiFraudFailure[];
  aggregate: {
    success: number;
    cancel: number;
    total: number;
    successRatio: number;
    /** How many couriers the figures above actually come from. */
    answered: number;
    asked: number;
  };
  checkedAt: string;
}

export interface ApiFraudAccount {
  provider: ApiFraudCourier;
  label: string;
  /** What this courier calls the thing you sign in with. */
  identifierLabel: string;
  identifier: string;
  /** Never the password — only whether one is stored. */
  hasSecret: boolean;
  enabled: boolean;
  lastOkAt: string | null;
  lastError: string;
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

/** What a recovery coupon does to a priced cart, or why it does nothing. */
export interface ApiCouponQuote {
  code: string;
  applied: boolean;
  /** The delivery charge it removed. 0 when delivery was already free. */
  saved: number;
  reason?: "unknown" | "used" | "expired" | "cancelled";
  message?: string;
}

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
  /** Present only when a code was sent. Null means none was. */
  coupon: ApiCouponQuote | null;
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
  /** When it was moved to the trash. Null on every live order. */
  deletedAt: string | null;
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

/** Another order that arrived from the same address. */
export interface ApiSameIpOrder {
  orderNumber: string;
  customerName: string;
  phone: string;
  status: ApiOrderStatus;
  grandTotal: number;
  createdAt: string;
}

export interface ApiBlockedIp {
  id: string;
  ip: string;
  reason: string;
  expiresAt: string | null;
  hitCount: number;
  lastHitAt: string | null;
  unblockedAt: string | null;
  createdAt: string;
  /** Neither lifted nor expired. */
  active: boolean;
}

export interface ApiOrderDetail extends ApiOrderListItem {
  address: string;
  /** Where the order came from. Admin responses only. */
  customerIp: string | null;
  /**
   * What else arrived from that address.
   *
   * `distinctPhones` is the number to read first: in Bangladesh one public
   * address fronts hundreds of real customers on carrier NAT, so four orders
   * from ONE phone is abuse and four orders from FOUR phones is a mobile tower.
   */
  sameIp: {
    total: number;
    distinctPhones: number;
    recent: ApiSameIpOrder[];
  } | null;
  /** The live block covering this address, if any. */
  blocked: { id: string; reason: string; expiresAt: string | null } | null;
  internalNotes: string | null;
  /**
   * Where the order came from, when the desk typed it in — "WhatsApp",
   * "Facebook page". Null means the customer checked out themselves.
   */
  source: string | null;
  cancellationReason: string | null;
  version: number;
  items: (ApiOrderItem & { id: string; productId: string | null; variantId: string | null })[];
  timeline: ApiOrderEvent[];
  allowedTransitions: ApiOrderStatus[];
  /**
   * Where "undo the last change" would put this order, or null when there is
   * nothing left to take back. Decided by the API, which owns the undo stack.
   */
  undoableTo: ApiOrderStatus | null;
  updatedAt: string;
}

export interface ApiStoreSettings {
  delivery: {
    insideDhaka: number;
    outsideDhaka: number;
    freeDeliveryThreshold: number;
  };
  /** What every NEW order number starts with. Existing orders keep theirs. */
  orderNumberPrefix: string;
  ordering: {
    minimumOrderValue: number;
    maxQuantityPerItem: number;
  };
  /** The rules behind the free-delivery offer sent to abandoned checkouts. */
  recovery: {
    couponMinCartValue: number;
    couponHours: number;
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
    /** Webhook secret state only — the value is never returned. */
    hasWebhookToken: boolean;
    webhookTokenHint: string;
  };
  store: {
    name: string;
    phone: string;
    email: string;
    address: string;
    invoiceFooter: string;
    /** Digits with country code. Empty hides the floating WhatsApp button. */
    whatsapp: string;
    /** Footer line under the shop's name. Empty means "use the built-in". */
    tagline: string;
    /** Free footer line under the copyright. Empty means "show nothing". */
    footerNote: string;
    /** Empty means "use the built-in title/description". */
    seoTitle: string;
    seoDescription: string;
    /** Resolved URL of the uploaded logo. Null means the header shows nothing. */
    logoUrl: string | null;
    logoWidth: number | null;
    logoHeight: number | null;
    /** Browser-tab icon. Null means "use the bundled favicon". */
    faviconUrl: string | null;
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
      /** One chat id, or several separated by commas — alerts go to all. */
      chatId: string;
      /** Where the nightly database backup goes. Empty means none is taken. */
      backupChatId: string;
      enabled: boolean;
      /**
       * Who may press the bot's buttons, comma separated. Not a secret — these
       * are public Telegram user ids — so unlike the token it is returned.
       * Empty means everyone in the configured chat.
       */
      allowedUserIds: string;
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
