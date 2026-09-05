/**
 * Policy pages.
 *
 * These are not filler. Facebook Business verification and ad account reviews
 * check for a reachable returns policy, contact details and privacy notice —
 * and for a COD store, the returns and delivery pages are what a hesitant
 * first-time buyer reads before ordering.
 *
 * Content is structured data rather than markdown so no parser ships to the
 * browser. Replace the copy with the merchant's real terms before launch.
 *
 * `{shop}` stands in for the shop's name and is substituted at render time from
 * store settings. Hardcoding it here would mean a rename in the admin panel
 * left the old name sitting in the terms and the About page — the two places a
 * shopper looks when deciding whether the business is real.
 */

export interface PolicySection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface Policy {
  slug: string;
  title: string;
  summary: string;
  sections: PolicySection[];
}

export const policies: Policy[] = [
  {
    slug: "delivery",
    title: "Delivery & Shipping Policy",
    summary: "Fast, reliable nationwide cash on delivery across all 64 districts in Bangladesh with real-time tracking.",
    sections: [
      {
        heading: "Nationwide Coverage & Delivery Timelines",
        paragraphs: [
          "{shop} provides seamless doorstep delivery across all 64 districts and Upazilas in Bangladesh. In collaboration with the country's most dependable logistics partners—such as Steadfast, Pathao, and Paperfly—we guarantee that your parcel reaches your hands quickly and securely.",
        ],
        bullets: [
          "Inside Dhaka City: Delivered within 24 to 48 hours after phone/WhatsApp order verification.",
          "Dhaka Suburbs (Gazipur, Savar, Keraniganj, Narayanganj): Delivered within 24 to 48 hours.",
          "Outside Dhaka & Nationwide: Delivered within 2 to 4 business days directly to your home or nearest courier point.",
          "Orders placed after 6:00 PM are verified and dispatched the next business morning.",
        ],
      },
      {
        heading: "Delivery Charges & Transparent Rates",
        paragraphs: [
          "We maintain complete transparency with no surprise surcharges at your doorstep. The shipping fee is computed and displayed clearly on the checkout page before placing your order:",
        ],
        bullets: [
          "Inside Dhaka Metropolitan Area: ৳80 flat rate.",
          "Outside Dhaka & All Districts: ৳130 flat rate.",
          "Free Shipping Campaigns: Certain promotional campaigns and product bundles include 100% free delivery across Bangladesh.",
        ],
      },
      {
        heading: "Order Verification & Safe Packaging",
        paragraphs: [
          "To ensure accurate delivery instructions and minimize failed delivery attempts, our customer care team will call or message you on WhatsApp to confirm your address and availability. Once confirmed, each order is carefully checked and wrapped in multi-layer bubble wrap before dispatch from our warehouse.",
          "If our team cannot reach you after 3 separate attempts over 48 hours, the order is cancelled to release the inventory for other waiting customers.",
        ],
      },
      {
        heading: "Real-Time Tracking & SMS Updates",
        paragraphs: [
          "Once your package is handed over to the courier partner, an automated SMS containing your unique Tracking Code and live link is sent to your mobile phone. You can also track your parcel at any time via the Track Order link on our website.",
        ],
      },
    ],
  },
  {
    slug: "returns",
    title: "Returns & Refund Policy",
    summary: "Inspect parcel before payment, 7-day hassle-free replacement, and 100% money-back guarantee.",
    sections: [
      {
        heading: "Open-Box Inspection (Check Before You Pay)",
        paragraphs: [
          "We want you to shop with total confidence. For all Cash on Delivery shipments, you have the right and are actively encouraged to open the parcel and inspect the product in the presence of the courier delivery rider before completing your payment.",
          "If the item inside is broken, physically damaged during transit, or different from what you ordered, you can refuse the package on the spot without paying a single Taka.",
        ],
      },
      {
        heading: "7-Day Easy Replacement Guarantee",
        paragraphs: [
          "If any manufacturing defect or performance failure is discovered within 7 days of receiving your order, {shop} provides an instant one-to-one product replacement with a brand new unit.",
        ],
        bullets: [
          "Contact our customer support hotline or WhatsApp within 7 calendar days of delivery.",
          "Share your Order ID (e.g., HINAR-XXXXX) and a brief photo or video showing the fault.",
          "Please preserve the original product packaging box, manuals, and bundled accessories.",
          "Upon receiving and inspecting the returned item at our service desk, the replacement unit will be dispatched to you within 24 to 48 hours.",
        ],
      },
      {
        heading: "Return Eligibility & Exclusions",
        paragraphs: [
          "To ensure fair service for all customers, returns must comply with standard consumer electronic guidelines:",
        ],
        bullets: [
          "Physical damage, drops, broken body, burnt ICs due to high voltage, or liquid damage caused after delivery acceptance are not covered.",
          "Products with removed, scratched, or altered warranty security stickers are void of return.",
          "Change of mind after accepting and using an undamaged, working product is not eligible for return.",
        ],
      },
      {
        heading: "Refund Process & Payment Methods",
        paragraphs: [
          "In the rare event that an exact replacement unit is permanently out of stock or discontinued, {shop} will promptly issue a 100% refund of the product purchase price.",
          "Refunds are disbursed via bKash, Nagad, or direct Bangladeshi Bank Transfer within 3 to 5 business days after the returned product has been inspected and approved by our team.",
        ],
      },
    ],
  },
  {
    slug: "warranty",
    title: "Warranty Policy",
    summary: "Comprehensive brand and service warranty for authentic smart gadgets purchased from {shop}.",
    sections: [
      {
        heading: "Authentic Products with Genuine Warranty",
        paragraphs: [
          "All electronics and smart devices available on {shop} are 100% original and accompanied by warranty protection. The specific warranty duration—ranging from 7-day replacement warranty to 6-month or 1-year service/brand warranty—is clearly highlighted on each product page and stated on your invoice.",
        ],
        bullets: [
          "Official Brand Warranty: Serviced directly by official brand distribution partners and authorized service points in Bangladesh.",
          "Shop Service Warranty: Serviced promptly by the internal {shop} technical engineering team.",
        ],
      },
      {
        heading: "Step-by-Step Warranty Claim Process",
        paragraphs: [
          "Claiming warranty assistance at {shop} is fast and straightforward:",
        ],
        bullets: [
          "1. Contact our customer care hotline or message our WhatsApp team with your Order ID and description of the problem.",
          "2. Send or bring the defective item with its original box and accessories to our central hub via courier or in-person.",
          "3. Our technicians diagnose and resolve the issue. Servicing or component replacement typically requires 5 to 10 working days.",
          "4. Once repaired or replaced, your product is safely delivered back to your home address.",
        ],
      },
      {
        heading: "Warranty Coverage & Exclusions",
        paragraphs: [
          "The warranty covers internal circuitry failures, manufacturing defects, and non-working components under standard consumer usage. The warranty is void under the following conditions:",
        ],
        bullets: [
          "Physical breakage, denting, or cracked displays caused by rough handling or drops.",
          "Water, liquid, moisture ingress, or exposure to excessive heat or fire.",
          "Circuit burns resulting from incompatible charging adapters or sudden electrical surges.",
          "Products opened, tampered with, or serviced by unauthorized local third-party technicians.",
          "Normal battery capacity decline and minor cosmetic wear resulting from continuous daily usage.",
        ],
      },
    ],
  },
  {
    slug: "about",
    title: "About {shop}",
    summary: "Leading online gadget and lifestyle tech brand in Bangladesh committed to original products and customer trust.",
    sections: [
      {
        heading: "Who We Are",
        paragraphs: [
          "{shop} is a premier e-commerce destination in Bangladesh specializing in curated smart gadgets, lifestyle tech, desk lighting, bike accessories, and modern everyday essentials.",
          "Founded with a passion for quality and customer satisfaction, our mission is to eliminate online shopping worries in Bangladesh. We believe that buying gadgets online should be exciting, transparent, and completely free of unpleasant surprises. That is why we sell only 100% original products, disclose accurate specifications, and stand behind every single item with genuine warranty support.",
        ],
      },
      {
        heading: "Why Customers Choose {shop}",
        paragraphs: [
          "From student study desks to modern homes and daily motorcycle commuters, thousands of happy customers nationwide rely on {shop}:",
        ],
        bullets: [
          "100% Original & Quality Checked: Every unit is individually inspected and tested before packaging.",
          "Nationwide Cash on Delivery: Order from any district or village in Bangladesh and pay only when the parcel reaches your hands.",
          "Open-Box Parcel Inspection: Check your package in front of the delivery courier rider before paying.",
          "Zero Hidden Fees: Honest pricing with delivery charges clearly displayed upfront.",
          "Friendly Human Support: Real customer support specialists available six days a week via phone call and WhatsApp.",
        ],
      },
      {
        heading: "Our Commitment to Bangladesh",
        paragraphs: [
          "We continuously work to bring the latest international lifestyle gadgets and productivity gear to Bangladesh at competitive local prices. Whether you are in Dhaka, Chattogram, Sylhet, Rajshahi, Khulna, Barishal, Rangpur, Mymensingh, or the furthest Upazila, {shop} delivers directly to your door with unmatched reliability.",
        ],
      },
    ],
  },
  {
    slug: "contact",
    title: "Contact Us",
    summary: "We are always here to assist you. Speak directly with our customer care team.",
    sections: [
      {
        heading: "Customer Support Hours",
        paragraphs: [
          "Saturday to Thursday: 10:00 AM – 8:00 PM (Friday Closed).",
          "Our phone line and WhatsApp chat support are actively monitored during business hours. Inquiries sent after hours or on Friday are addressed with priority on the following business morning.",
        ],
      },
      {
        heading: "Direct Communication Channels",
        paragraphs: [
          "Feel free to get in touch with us through any of the convenient methods below:",
        ],
        bullets: [
          "Phone Hotline: Call our official hotline for quick order confirmation and phone support.",
          "WhatsApp Support: Chat directly with our team for fast text help, product photos, videos, and tracking updates.",
          "Online Order Tracking: View the real-time shipping status of your parcel 24/7 on our Track Order page.",
        ],
      },
      {
        heading: "Helpful Tip Before You Call",
        paragraphs: [
          "If you are calling or messaging regarding an existing order, please keep your Order ID (e.g., HINAR-10247) ready. This allows our representatives to retrieve your order details instantly and resolve your inquiry efficiently.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms & Conditions",
    summary: "Clear rules and service terms governing your orders and use of {shop}.",
    sections: [
      {
        heading: "1. Acceptance of Terms",
        paragraphs: [
          "By accessing, browsing, or placing an order on the {shop} website, you agree to be legally bound by these Terms and Conditions along with our Privacy, Delivery, and Return Policies. These terms apply to all visitors, buyers, and account holders.",
        ],
      },
      {
        heading: "2. Orders & Verification",
        paragraphs: [
          "Submitting an order on {shop} constitutes an offer to purchase. An order is formally confirmed only after our customer support team successfully verifies the order details and delivery address with you via phone call or WhatsApp.",
          "{shop} reserves the right to decline or cancel any order at our discretion in events of product stockouts, technical pricing discrepancies, suspicion of fraudulent intent, or unserviceable delivery locations.",
        ],
      },
      {
        heading: "3. Pricing, Currency & Taxes",
        paragraphs: [
          "All prices listed on {shop} are in Bangladeshi Taka (BDT / ৳) and include applicable taxes where required. While we make every effort to maintain absolute accuracy, unintentional pricing or typographical errors may occasionally happen. If a product is listed at an incorrect price, we will contact you before dispatch to offer the choice of confirming at the correct price or cancelling without fee.",
        ],
      },
      {
        heading: "4. Cash on Delivery & Fair Use Policy",
        paragraphs: [
          "We offer nationwide Cash on Delivery (COD) as a convenience to our valued shoppers. In return, we expect responsible shopping. Arbitrarily refusing a verified order at the door without valid defect causes significant round-trip courier shipping losses for our small business.",
          "{shop} tracks delivery completion metrics. We reserve the right to require an advance shipping fee or restrict COD privileges for phone numbers or addresses with a repeated history of unjustified doorstep refusals.",
        ],
      },
      {
        heading: "5. Intellectual Property",
        paragraphs: [
          "All visual assets, product imagery, logos, brand names, written descriptions, site architecture, and code on {shop} are the intellectual property of {shop} or its respective brand licensors. Any unauthorized copying, distribution, or commercial reproduction is strictly prohibited.",
        ],
      },
      {
        heading: "6. Limitation of Liability",
        paragraphs: [
          "{shop} shall not be held liable for any indirect, incidental, or consequential damages resulting from courier transit delays, electrical power surges, improper consumer product handling, or unexpected circumstances beyond our reasonable operational control.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary: "How {shop} protects and handles your personal information with strict confidentiality.",
    sections: [
      {
        heading: "1. Minimal Data Collection",
        paragraphs: [
          "We respect your personal privacy and collect only the absolute minimum information required to deliver your orders safely and efficiently. When placing an order, we collect your name, phone number, and delivery address.",
          "We do not require account registration, passwords, or personal identity documentation to shop on our storefront.",
        ],
        bullets: [
          "Your Full Name: To identify and label your parcel correctly.",
          "Mobile Phone Number: To confirm your order and enable the courier delivery rider to reach you upon arrival.",
          "Complete Delivery Address: To route the courier partner straight to your doorstep.",
        ],
      },
      {
        heading: "2. How Your Information is Used",
        paragraphs: [
          "Your personal data is used exclusively for order fulfillment and customer service communication:",
        ],
        bullets: [
          "To call or text you for order verification before dispatch.",
          "To generate courier shipping labels and arrange doorstep delivery with our logistics partners.",
          "To assist you with after-sales support, warranty claims, and return requests.",
          "To send automated transactional SMS notifications regarding your parcel's live shipping status.",
        ],
      },
      {
        heading: "3. Strict Zero-Spam & Confidentiality Policy",
        paragraphs: [
          "We value your trust above all else. {shop} NEVER sells, rents, trades, or shares your personal details or mobile phone numbers with third-party telemarketers, spam lists, or external advertisers.",
          "Your delivery details are shared solely with our designated courier delivery partner handling your physical parcel, and strictly for the purpose of completing the delivery.",
        ],
      },
      {
        heading: "4. SSL Security & Data Protection",
        paragraphs: [
          "Our website is protected with industry-standard SSL/TLS (HTTPS) encryption. All communications between your web browser and our servers are encrypted, safeguarding your information against unauthorized access.",
        ],
      },
      {
        heading: "5. Customer Privacy Rights",
        paragraphs: [
          "You have the right to request information about the contact details we hold regarding your phone number, or request the permanent deletion of your customer record from our system once your active orders and warranty periods have concluded. Simply contact our support team via phone or WhatsApp to submit a data removal request.",
        ],
      },
    ],
  },
];

export function getPolicy(slug: string): Policy | undefined {
  return policies.find((p) => p.slug === slug);
}
