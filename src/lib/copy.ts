/**
 * Every user-facing string in the storefront lives here.
 *
 * The UI ships in English. Switching to Bangla — or adding a toggle — means
 * duplicating this object and swapping the export, not touching 60 components.
 * Components must never hardcode display text.
 */

export const copy = {
  brand: {
    /**
     * Fallback only.
     *
     * The real name is the one in Settings → Store, which the header, footer,
     * invoices, page titles and Telegram alerts all read. This is what shows if
     * the API cannot be reached at render time, so it should stay in step with
     * the configured name rather than being the source of it.
     */
    name: "HINAR",
    tagline: "Gadgets, delivered.",
  },

  nav: {
    search: "Search",
    searchPlaceholder: "Search gadgets, brands…",
    cart: "Cart",
    home: "Home",
    categories: "Categories",
    trackOrder: "Track order",
    close: "Close",
    back: "Back",
    menu: "Menu",
  },

  home: {
    categoriesTitle: "Shop by category",
    newArrivals: "New arrivals",
    trending: "Trending now",
    viewAll: "View all",
    announcement: "Cash on delivery all over Bangladesh",
  },

  product: {
    addToCart: "Add to Cart",
    buyNow: "Buy Now",
    inStock: "In stock",
    outOfStock: "Out of stock",
    lowStock: (n: number) => `Only ${n} left`,
    quantity: "Quantity",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    description: "Description",
    specifications: "Specifications",
    included: "What's included",
    related: "You may also like",
    selectPrompt: (option: string) => `Select ${option}`,
    /**
     * Names what is missing rather than saying "an option".
     *
     * Nothing is pre-selected on a product with variants, so this is the
     * message that stands between a customer and checkout. "Please choose an
     * option first" makes them hunt for which one; on a two-axis product they
     * frequently pick the axis they already chose.
     */
    selectRequired: (axes: string[]) =>
      axes.length === 1
        ? `Please choose a ${axes[0]} first`
        : `Please choose ${axes.slice(0, -1).join(", ")} and ${axes[axes.length - 1]} first`,
    /** Sits under the axis itself, where the choice is actually made. */
    selectAxis: (axis: string) => `Choose a ${axis}`,
    priceFrom: "From",
    save: (amount: string) => `Save ${amount}`,
    off: (percent: number) => `${percent}% OFF`,
    gallery: "Product images",
    imageOf: (i: number, total: number) => `Image ${i} of ${total}`,
    addedToast: "Added to cart",
    viewCart: "View cart",
    viewDetails: "View Details",
    /**
     * The listing card's quick-add button shows only an icon, so this is the
     * whole of its accessible name. It carries the product title because a grid
     * of two dozen buttons all announcing "Add to cart" tells a screen-reader
     * user which control they are on but not which product.
     */
    quickAdd: (title: string) => `Add ${title} to cart`,
    /* Shown in the quick-add sheet when the product lookup fails. It does not
       guess at a cause — the shopper cannot act on "the API is down" — and
       points at the product page, which handles a missing product properly. */
    quickAddFailed: "Couldn't load the options for this product.",
  },

  trust: {
    cod: "Cash on Delivery",
    /**
     * The word is appended only when it is missing.
     *
     * The admin field takes free text and its placeholder reads "1 year
     * official warranty", so most products already carry the word — and
     * appending unconditionally produced "2 years replacement warranty
     * warranty" on the badge. A bare "1 year" still needs the noun, so
     * dropping the suffix outright is not the fix either.
     */
    warranty: (period: string) =>
      /warranty\s*$/i.test(period) ? period : `${period} warranty`,
    replacement: "7-day replacement",
    fastDelivery: "24–48h delivery in Dhaka",
  },

  cart: {
    title: "Cart",
    empty: "Your cart is empty",
    emptyAction: "Start shopping",
    remove: "Remove",
    removed: "Removed from cart",
    subtotal: "Subtotal",
    checkout: "Checkout",
    deliveryNote: "Delivery charge calculated at checkout",
    itemCount: (n: number) => `${n} ${n === 1 ? "item" : "items"}`,
  },

  checkout: {
    title: "Checkout",
    contactHeading: "Delivery details",
    fullName: "Full name",
    fullNamePlaceholder: "e.g. Rahim Uddin",
    phone: "Phone number",
    phonePlaceholder: "01XXXXXXXXX",
    phoneHint: "We'll call this number to confirm your order",
    address: "Full address",
    addressPlaceholder: "House / road / block, landmark",
    area: "Area / Thana / District",
    areaPlaceholder: "e.g. Dhanmondi, Dhaka",
    zoneHeading: "Delivery area",
    zoneInside: "Inside Dhaka",
    zoneOutside: "Outside Dhaka",
    zoneSuggested: (area: string) => `Matched “${area}”. Change it if wrong.`,
    zoneManual: "Choose your delivery area",
    couponPlaceholder: "Coupon code",
    couponApply: "Apply",
    couponRemove: "Remove",
    couponApplied: (code: string) => `${code} applied`,
    paymentHeading: "Payment",
    cod: "Cash on Delivery",
    codHint: "Pay the courier when your order arrives",
    summaryHeading: "Order summary",
    productSubtotal: "Subtotal",
    deliveryCharge: "Delivery charge",
    discount: "Discount",
    freeDelivery: "Free",
    total: "Total",
    placeOrder: "Place Order",
    placingOrder: "Placing order…",
    required: "This field is required",
    invalidPhone: "Enter a valid 11-digit mobile number",
    invalidName: "Enter your full name",
    shortAddress: "Please enter a complete address",
    emptyCart: "There's nothing to check out",
  },

  success: {
    heading: "Order placed successfully",
    orderIdLabel: "Order ID",
    message:
      "We'll call you shortly to confirm your order. Please keep your phone nearby.",
    codNote: "Pay the courier on delivery.",
    continue: "Continue shopping",
    track: "Track this order",
    saveIdHint: "Save your Order ID — you'll need it to track your order.",
  },

  track: {
    title: "Track your order",
    intro: "Enter your order ID and the phone number you ordered with.",
    orderId: "Order ID",
    orderIdPlaceholder: "HINAR-10247",
    phone: "Phone number",
    submit: "Track order",
    notFound: "No order found with that ID and phone number.",
    placedOn: "Placed on",
    statusLabel: "Status",
  },

  orderStatus: {
    pending: "Pending confirmation",
    confirmed: "Confirmed",
    processing: "Processing",
    packed: "Packed",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    returned: "Returned",
  },

  search: {
    title: "Search",
    resultsFor: (q: string) => `Results for “${q}”`,
    noResults: (q: string) => `No products match “${q}”`,
    noResultsHint: "Try a shorter or more general search term.",
    countResults: (n: number) => `${n} ${n === 1 ? "product" : "products"}`,
  },

  category: {
    empty: "No products in this category yet.",
    sortLabel: "Sort",
    sortNewest: "Newest",
    sortPriceLow: "Price: low to high",
    sortPriceHigh: "Price: high to low",
  },

  contact: {
    whatsapp: "Chat on WhatsApp",
    call: "Call us",
    help: "Need help?",
  },

  footer: {
    help: "Help",
    about: "About",
    /* Takes the shop name so a renamed store is not still crediting the old one. */
    rights: (year: number, shopName: string) =>
      `© ${year} ${shopName}. All rights reserved.`,
  },

  common: {
    loading: "Loading…",
    retry: "Try again",
    notFoundTitle: "Page not found",
    notFoundBody: "The page you're looking for doesn't exist or has moved.",
    goHome: "Go to homepage",
    errorTitle: "Something went wrong",
    errorBody: "Please try again in a moment.",
  },
} as const;

export type Copy = typeof copy;
