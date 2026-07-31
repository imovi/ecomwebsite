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
    title: "Delivery",
    summary: "Where we deliver, how long it takes, and what it costs.",
    sections: [
      {
        heading: "Coverage and timing",
        bullets: [
          "Inside Dhaka: 24–48 hours after your order is confirmed.",
          "Outside Dhaka: 2–4 working days, depending on courier coverage.",
          "Orders placed after 6pm are confirmed the next working day.",
        ],
      },
      {
        heading: "Delivery charges",
        paragraphs: [
          "The charge is shown on the checkout page before you place your order, and again on your order confirmation. Choose your delivery area at checkout — we pre-select it from the area you type, but the choice you confirm is the one we bill.",
        ],
        bullets: [
          "Inside Dhaka: ৳80",
          "Outside Dhaka: ৳130",
          "Free delivery on orders over ৳20,000",
        ],
      },
      {
        heading: "Areas billed as outside Dhaka",
        paragraphs: [
          "Savar, Ashulia, Keraniganj, Dhamrai, Dohar, Nawabganj, Tongi, Gazipur and Narayanganj are in or next to Dhaka district but are billed at the outside-Dhaka rate, because that is what the courier charges us.",
        ],
      },
      {
        heading: "Confirmation call",
        paragraphs: [
          "We call every order before dispatch to confirm the address and that you are available. If we cannot reach you after three attempts, the order is cancelled and the stock released.",
        ],
      },
    ],
  },
  {
    slug: "returns",
    title: "Returns & refunds",
    summary: "Seven-day replacement on manufacturing defects.",
    sections: [
      {
        heading: "Check before you pay",
        paragraphs: [
          "You may open the parcel and inspect the product in front of the delivery person before paying. If the item is wrong, damaged, or not what you ordered, refuse the delivery — you pay nothing.",
        ],
      },
      {
        heading: "Seven-day replacement",
        paragraphs: [
          "If a manufacturing defect appears within seven days of delivery, we will replace the product with the same model.",
        ],
        bullets: [
          "The product must be in its original box with all accessories.",
          "Keep your Order ID — we need it to process the replacement.",
          "Physical damage, water damage and burnt components are not covered.",
        ],
      },
      {
        heading: "What is not returnable",
        bullets: [
          "Products damaged by misuse, drops, or unauthorised repair.",
          "Items with a broken warranty seal or removed serial sticker.",
          "Change of mind after delivery has been accepted and paid for.",
        ],
      },
      {
        heading: "Refunds",
        paragraphs: [
          "Where a replacement is not possible, we refund the full amount you paid via bKash or bank transfer within 5 working days of receiving the returned product.",
        ],
      },
    ],
  },
  {
    slug: "warranty",
    title: "Warranty",
    summary: "How warranty claims work on products bought from {shop}.",
    sections: [
      {
        heading: "Warranty period",
        paragraphs: [
          "The warranty period for each product is listed on its product page and printed on your invoice. Most products carry either official brand warranty or {shop} service warranty.",
        ],
      },
      {
        heading: "Making a claim",
        bullets: [
          "Call our hotline with your Order ID and a description of the fault.",
          "Bring the product with its box and accessories, or send it by courier.",
          "Service typically takes 7–15 working days depending on the brand.",
        ],
      },
      {
        heading: "Not covered",
        bullets: [
          "Physical or liquid damage.",
          "Software issues, and normal battery capacity decline over time.",
          "Products serviced by an unauthorised repair shop.",
        ],
      },
    ],
  },
  {
    slug: "about",
    title: "About {shop}",
    summary: "A small gadget store built around one idea: no surprises.",
    sections: [
      {
        paragraphs: [
          "{shop} is an online gadget store serving customers across Bangladesh. We sell smartphones, audio, wearables, laptops and accessories — original products only, with the warranty stated on every product page.",
          "We keep the store deliberately simple. Clear prices, an honest delivery charge shown before you order, cash on delivery everywhere, and a phone number that a person answers.",
        ],
      },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    summary: "Talk to a person.",
    sections: [
      {
        heading: "Support hours",
        paragraphs: ["Saturday to Thursday, 10:00am – 8:00pm. Friday closed."],
      },
      {
        heading: "Before you call",
        paragraphs: [
          "Have your Order ID ready — it looks like GNG-10247 and is on your order confirmation page. You can also check your order status yourself on the Track order page.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms & conditions",
    summary: "The rules that apply when you order from {shop}.",
    sections: [
      {
        heading: "Orders",
        paragraphs: [
          "Placing an order is an offer to buy. The order is accepted once we confirm it by phone. We may decline an order if the product is out of stock, the price was listed in error, or the delivery address is outside our courier coverage.",
        ],
      },
      {
        heading: "Pricing",
        paragraphs: [
          "All prices are in Bangladeshi Taka and include VAT where applicable. Prices and delivery charges can change without notice, but the amount shown on your order confirmation is the amount you pay.",
        ],
      },
      {
        heading: "Payment",
        paragraphs: [
          "We currently accept cash on delivery only. Payment is collected by the courier when the parcel is handed over.",
        ],
      },
      {
        heading: "Repeated refusals",
        paragraphs: [
          "Cash-on-delivery orders that are repeatedly refused at the door cost us the full round-trip courier charge. We may ask for advance payment on future orders from a number with a history of refused deliveries.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy",
    summary: "What we collect, why, and who sees it.",
    sections: [
      {
        heading: "What we collect",
        paragraphs: [
          "To deliver an order we collect your name, phone number and delivery address. That is all we ask for — there are no accounts and no passwords on this store.",
        ],
      },
      {
        heading: "How it is used",
        bullets: [
          "To call and confirm your order.",
          "To hand your address to the courier delivering your parcel.",
          "To look up your order when you contact support.",
        ],
      },
      {
        heading: "Who we share it with",
        paragraphs: [
          "Only the courier company delivering your order. We do not sell customer data, and we do not share phone numbers with advertisers.",
        ],
      },
      {
        heading: "Your choices",
        paragraphs: [
          "Call our hotline to ask what we hold about your number, or to have your details removed from our records once your orders are complete.",
        ],
      },
    ],
  },
];

export function getPolicy(slug: string): Policy | undefined {
  return policies.find((p) => p.slug === slug);
}
