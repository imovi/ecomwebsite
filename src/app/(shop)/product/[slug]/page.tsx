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
    question: "লোডশেডিংয়ে এক চার্জে কতক্ষণ ব্যাটারি ব্যাকআপ পাওয়া যায়?",
    answer:
      "এই রিচার্জেবল লাইটে রয়েছে হাই-ক্যাপাসিটি লিথিয়াম ব্যাটারি। সাধারণ রিডিং ব্রাইটনেসে একটানা ৮ থেকে ১২ ঘণ্টা এবং সফট নাইট-লাইট মোডে সর্বোচ্চ ২৪ ঘণ্টা পর্যন্ত ব্যাকআপ পাওয়া যায়। কারেন্ট চলে গেলেও পড়াশোনা বা জরুরি কাজ একটানা চালিয়ে নেওয়া সম্ভব।",
  },
  {
    question: "কারেন্ট না থাকলে পাওয়ার ব্যাংক দিয়ে কি চার্জ দেওয়া যাবে?",
    answer:
      "হ্যাঁ! এটিতে স্ট্যান্ডার্ড ইউএসবি চার্জিং পোর্ট রয়েছে। ফলে লোডশেডিংয়ের সময় বিদ্যুৎ না থাকলেও আপনি যেকোনো মোবাইল পাওয়ার ব্যাংক, ল্যাপটপ বা ৫ ভোল্ট অ্যাডাপ্টার দিয়ে অনায়াসে এটি রিচার্জ করতে পারবেন (ফুল চার্জ হতে প্রায় ২.৫-৩ ঘণ্টা লাগে)।",
  },
  {
    question: "৩টি কালার মোড ও রিমোট কন্ট্রোল কীভাবে কাজ করে?",
    answer:
      "লাইটের ওপর টাচ করলেই ৩টি আলাদা লাইট মোড চেঞ্জ হয়: ওয়ার্ম ইয়েলো (৩০০০K - চোখের আরাম ও রাতের পড়ার জন্য), ওয়ার্ম হোয়াইট (৪৫০০K) এবং কুল হোয়াইট (৬০০০K - স্পষ্ট লেখার জন্য)। সাথে থাকা ওয়্যারলেস রিমোট দিয়ে দূর থেকেই লাইট অন/অফ, ব্রাইটনেস কমানো-বাড়ানো এবং ১০ ও ৩০ মিনিটের অটো-অফ টাইমার সেট করা যায়।",
  },
  {
    question: "ম্যাগনেটিক বেস কীভাবে যেকোনো জায়গায় লাগানো যায়?",
    answer:
      "লাইটের সাথে একটি ম্যাগনেটিক স্টিকি হোল্ডার ও স্ট্রং ৩M আঠা দেওয়া থাকে। কোনো ড্রিল বা পেরেক ছাড়াই পড়ার টেবিল, দেয়াল, আলমারি, রান্নাঘর বা খাটের পাশে অনায়াসে লাগিয়ে নেওয়া যায়। প্রয়োজনমতো লাইটটি স্ট্যান্ড থেকে আলাদা করে পোর্টেবল টর্চ বা হ্যান্ডেল লাইট হিসেবেও ব্যবহার করা যায়।",
  },
  {
    question: "ডেলিভারি এবং পেমেন্ট সিস্টেম কী?",
    answer:
      "HINAR সারা বাংলাদেশে ১০০% ক্যাশ অন ডেলিভারি সুবিধা প্রদান করে। ঢাকার ভেতরে ২৪-৪৮ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ৪৮-৭২ ঘণ্টার মধ্যে হোম ডেলিভারি দেওয়া হয়। ডেলিভারি ম্যানের সামনে পণ্য দেখে নেওয়ার পর মূল্য পরিশোধ করতে পারবেন।",
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
      "Rechargeable LED Study Lamp & Charger Light for Load Shedding — Price in BD";
    description = `লোডশেডিং ও পড়াশোনার সেরা রিচার্জেবল চার্জার লাইট ও স্টাডি ল্যাম্প। ৩টি কালার মোড, রিমোট ও ২৪ ঘণ্টা ব্যাটারি ব্যাকআপ। Buy Rechargeable Charger Light in BD at ৳${minPrice(product)} with Cash on Delivery.`;
    keywords = [
      "charger light",
      "charger light price in bd",
      "rechargeable light",
      "rechargeable light price in bangladesh",
      "study lamp",
      "study lamp bd",
      "rechargeable study lamp",
      "emergency light bd",
      "loadshedding light bd",
      "load shedding study lamp",
      "magnetic desk lamp",
      "reading light for study table",
      "পড়ার টেবিলের রিচার্জেবল লাইট",
      "চার্জার লাইট",
      "লোডশেডিং লাইট",
      "ইমার্জেন্সি লাইট",
      "কারেন্ট না থাকলে পড়ার লাইট",
      "লোডশেডিং এ পড়ার লাইট",
      "ব্যাটারি ব্যাকআপ লাইট",
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
