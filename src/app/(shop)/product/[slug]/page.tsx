import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getAllProducts,
  getProductBySlug,
  getRelatedProducts,
} from "@/lib/data/catalog";
import { minPrice, totalStock } from "@/lib/catalog-utils";
import { copy } from "@/lib/copy";
import { siteConfig } from "@/lib/api/config";
import { Container, Divider, SectionHeader } from "@/components/ui/Layout";
import { Icon } from "@/components/ui/Icon";
import { ProductPurchase } from "@/components/product/ProductPurchase";
import { ProductRail } from "@/components/product/ProductCard";
import { ProductVideoInline } from "@/components/product/ProductVideoInline";
import { parseVideoUrl, resolveDirectVideoUrl, type ParsedVideoInfo } from "@/lib/video-embed";

/** Statically rendered, refreshed every 5 minutes. Prices and stock still get
 *  re-validated server-side at order placement, so a slightly stale page can
 *  never produce a wrong order. */
export const revalidate = 300;

export async function generateStaticParams() {
  const products = await getAllProducts();
  return products.map((p) => ({ slug: p.slug }));
}

interface ProductFaq {
  question: string;
  answer: string;
}

const LAMP_FAQS: ProductFaq[] = [
  {
    question: "How long does the battery last on a single charge?",
    answer:
      "The built-in rechargeable lithium battery provides 4 to 24 hours of illumination depending on your chosen brightness level. At medium study/reading brightness, it comfortably lasts around 8 to 12 hours. It easily recharges via any standard USB phone charger, power bank, or laptop in about 2.5 to 3 hours.",
  },
  {
    question: "How do the touch controls and remote control work?",
    answer:
      "You can tap the touch sensor directly on the lamp to cycle between 3 color temperatures (Warm Yellow 3000K, Warm White 4500K, Cool White 6000K) or long-press for smooth stepless dimming. The included wireless remote control lets you turn it on/off, adjust brightness, change color modes, and set 10-minute or 30-minute auto-off timers from up to 5 meters away.",
  },
  {
    question: "Can I stick it on any surface? Does the magnet hold firmly?",
    answer:
      "Yes! The package includes a magnetic base with strong 3M adhesive tape that mounts securely to study desks, walls, wood, metal, glass, or closets. The powerful built-in neodymium magnets hold the light firmly at any angle without slipping, yet allow easy detachment whenever you need a portable flashlight or need to recharge it.",
  },
  {
    question: "Is this lamp eye-friendly for long study or reading sessions?",
    answer:
      "Yes. It uses upgraded flicker-free LED beads with diffused anti-glare light guide technology, eliminating blue light hazards and harsh shadows to protect your eyes during late-night study or computer work.",
  },
  {
    question: "What is the delivery time and payment method in Bangladesh?",
    answer:
      "HINAR offers 100% Cash on Delivery across all 64 districts in Bangladesh. Delivery takes 24 to 48 hours inside Dhaka (৳80 delivery charge) and 48 to 72 hours outside Dhaka (৳130 delivery charge). You can inspect the package upon delivery before making payment.",
  },
];

const GENERAL_FAQS: ProductFaq[] = [
  {
    question: "How do I order with Cash on Delivery?",
    answer:
      "Simply click 'Order Now' or 'Add to Cart', fill in your name, delivery address, and phone number, and submit your order. No advance payment is needed — you only pay the delivery courier when receiving your package.",
  },
  {
    question: "What is your delivery time across Bangladesh?",
    answer:
      "We deliver in 24–48 hours inside Dhaka and 48–72 hours anywhere outside Dhaka via trusted courier partners.",
  },
  {
    question: "What is the warranty and return policy?",
    answer:
      "All products are checked for quality before shipping. If you receive any defective or damaged product, you can request an easy exchange or return within 7 days by contacting our hotline or WhatsApp.",
  },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: copy.common.notFoundTitle };

  let title = product.title;
  let description = product.description.slice(0, 155);
  let keywords = [
    product.title,
    product.brand ?? "HINAR",
    "gadgets bd",
    "online shopping bangladesh",
  ];

  if (slug === "led-magnetic-desk-lamp") {
    title =
      "Rechargeable LED Study Lamp & Magnetic Desk Light with Remote — Price in BD";
    description = `Buy Rechargeable LED Study Lamp & Magnetic Desk Light with 3 color modes, dimming & remote control in Bangladesh at ৳${minPrice(product)}. Eye-care reading light with fast cash on delivery.`;
    keywords = [
      "study lamp",
      "study lamp bd",
      "led rechargeable light",
      "rechargeable study lamp",
      "rechargeable led light bd",
      "study lamp price in bangladesh",
      "magnetic desk lamp",
      "reading light for study table",
      "table lamp for study",
      "desk lamp with remote control bd",
      "study light rechargeable",
      "পড়ার টেবিলের লাইট",
      "স্টাডি ল্যাম্প",
      "রিচার্জেবল টেবিল ল্যাম্প",
      "রিচার্জেবল লাইট",
    ];
  }

  const ogImage = product.images[0] ?? `${siteConfig.url}/apple-icon.png`;

  return {
    title,
    description,
    keywords,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/product/${product.slug}`,
      images: [{ url: ogImage, width: 800, height: 800, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const related = await getRelatedProducts(product);
  const inStock = totalStock(product) > 0;
  const videoInfo = product.videoUrl ? await resolveDirectVideoUrl(product.videoUrl) : null;

  const resolvedGalleryVideos: Record<string, ParsedVideoInfo> = {};
  for (const img of product.images) {
    const clean = img.split("#")[0] ?? img;
    const parsed = parseVideoUrl(clean);
    if (parsed && (parsed.type === "instagram" || parsed.type === "direct")) {
      const resolved = await resolveDirectVideoUrl(clean);
      if (resolved) resolvedGalleryVideos[clean] = resolved;
    }
  }

  const brandName = product.brand || "HINAR";
  const productPrice = minPrice(product);
  const faqs = slug === "led-magnetic-desk-lamp" ? LAMP_FAQS : GENERAL_FAQS;

  const jsonLdProduct = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    image: product.images,
    description: product.description,
    brand: {
      "@type": "Brand",
      name: brandName,
    },
    sku: product.variants[0]?.sku ?? product.id,
    mpn: product.variants[0]?.sku ?? product.id,
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: productPrice,
      priceValidUntil: "2027-12-31",
      itemCondition: "https://schema.org/NewCondition",
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: `${siteConfig.url}/product/${product.slug}`,
      seller: {
        "@type": "Organization",
        name: "HINAR",
        url: siteConfig.url,
      },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: "80",
          currency: "BDT",
        },
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: "BD",
        },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: {
            "@type": "QuantitativeValue",
            minValue: 0,
            maxValue: 1,
            unitCode: "d",
          },
          transitTime: {
            "@type": "QuantitativeValue",
            minValue: 1,
            maxValue: 3,
            unitCode: "d",
          },
        },
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "BD",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 7,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/FreeReturn",
      },
    },
  };

  const jsonLdBreadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: siteConfig.url,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Gadgets",
        item: `${siteConfig.url}/category/all`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: product.title,
        item: `${siteConfig.url}/product/${product.slug}`,
      },
    ],
  };

  const jsonLdFaq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdProduct) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFaq) }}
      />

      <Container className="pb-10 pt-5">
        <ProductPurchase product={product} resolvedVideos={resolvedGalleryVideos} />
      </Container>

      <Container className="flex flex-col gap-8 pb-4">
        <Divider />

        {product.videoUrl && (
          <ProductVideoInline
            videoUrl={product.videoUrl}
            initialVideo={videoInfo}
          />
        )}

        <section>
          <h2 className="text-title text-ink">{copy.product.description}</h2>
          <p className="mt-3 max-w-2xl whitespace-pre-line text-body leading-relaxed text-ink-soft">
            {product.description}
          </p>
        </section>

        <section>
          <h2 className="text-title text-ink">{copy.product.specifications}</h2>
          <dl className="mt-3 max-w-2xl">
            {product.specs.map((spec, i) => (
              <div
                key={spec.label}
                className={`flex gap-4 py-2.5 text-caption ${
                  i > 0 ? "border-t border-line" : ""
                }`}
              >
                <dt className="w-32 shrink-0 text-muted sm:w-40">{spec.label}</dt>
                <dd className="min-w-0 flex-1 text-ink-soft">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h2 className="text-title text-ink">{copy.product.included}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {product.included.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-body text-ink-soft">
                <Icon
                  name="check"
                  size={16}
                  className="mt-1 shrink-0 text-positive"
                />
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Frequently Asked Questions (SEO & Conversion Rich Snippet Section) */}
        <section className="border-t border-line pt-8">
          <div className="max-w-2xl">
            <h2 className="text-title text-ink">Frequently Asked Questions (FAQ)</h2>
            <p className="mt-1 text-caption text-muted">
              Common questions about this product, specifications, and cash on delivery in Bangladesh.
            </p>
            <div className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
              {faqs.map((faq, index) => (
                <details key={index} className="group p-4 [&_summary::-webkit-details-marker]:hidden" open={index === 0}>
                  <summary className="flex cursor-pointer items-center justify-between gap-3 text-body font-medium text-ink">
                    <span>{faq.question}</span>
                    <span className="shrink-0 text-muted transition duration-200 group-open:rotate-180">
                      ▼
                    </span>
                  </summary>
                  <p className="mt-3 text-caption leading-relaxed text-ink-soft">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </Container>

      {related.length > 0 && (
        <Container className="mt-12">
          <SectionHeader title={copy.product.related} className="mb-4" />
          <ProductRail products={related} />
        </Container>
      )}
    </>
  );
}
