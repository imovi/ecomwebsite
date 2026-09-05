import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/Toaster";
import { copy } from "@/lib/copy";
import { getSettings } from "@/lib/data/settings";
import { siteConfig } from "@/lib/api/config";
import "./globals.css";

/** One weight axis, latin only. A second webfont is a second render-blocking
 *  request on a 4G connection — Bangla falls back to system fonts by design. */
const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Titles come from the shop's own settings, not from a constant.
 *
 * Renaming the shop should be one edit in the admin panel, not a code change
 * and a redeploy — the header, footer and invoices already work that way, and a
 * browser tab still reading the old name would be the one place the rename
 * visibly failed. `copy.brand.name` remains as the fallback for when the API
 * cannot be reached while rendering.
 *
 * Cached with the same tag as every other settings read, so saving a new name
 * in the panel revalidates the titles along with everything else.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const name = settings.storeName || copy.brand.name;

  const fallbackTitle = `${name} — Online Gadget Shop & Smart Lifestyle Store in Bangladesh`;
  const fallbackDescription =
    "Shop smart gadgets, rechargeable desk lamps, unique lifestyle accessories & everyday electronics at best price in Bangladesh. Fast nationwide cash on delivery.";

  const title =
    settings.seoTitle || `${name} — ${settings.tagline || copy.brand.tagline}`;
  const description = settings.seoDescription || fallbackDescription;

  const ogImage = settings.logoUrl || `${siteConfig.url}/apple-icon.png`;

  return {
    metadataBase: new URL(siteConfig.url),
    title: {
      default: title,
      template: `%s · ${name}`,
    },
    description,
    keywords: settings.seoKeywords
      ? settings.seoKeywords.split(",").map((s) => s.trim()).filter(Boolean)
      : [
          "gadget shop bd",
          "online gadget shop in bangladesh",
          "smart gadgets bd",
          "hinar",
          "hinar bd",
          "hinarbd",
          "rechargeable desk lamp bd",
          "magnetic desk lamp bangladesh",
          "lifestyle gadgets bd",
          "cash on delivery gadgets bangladesh",
        ],
    verification: {
      google: settings.googleSiteVerification || "da2a584dd6352b62",
      ...(settings.bingSiteVerification ? { bing: settings.bingSiteVerification } : {}),
    },
    applicationName: name,
    formatDetection: { telephone: true },
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      locale: "en_BD",
      alternateLocale: ["bn_BD"],
      siteName: name,
      title,
      description,
      url: siteConfig.url,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: `${name} — Smart Gadgets & Lifestyle Essentials in Bangladesh`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    other: {
      "geo.region": "BD",
      "geo.placename": "Dhaka, Bangladesh",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
    icons: { icon: settings.faviconUrl ?? "/favicon.ico", apple: "/apple-icon.png" },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await getSettings();
  const name = settings.storeName || copy.brand.name;

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: name,
    alternateName: ["HINAR BD", "HINAR", "hinarbd.com"],
    url: siteConfig.url,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteConfig.url}/category/all?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    name: name,
    url: siteConfig.url,
    logo: settings.logoUrl || `${siteConfig.url}/apple-icon.png`,
    description:
      settings.seoDescription ||
      "Trusted online gadget and lifestyle store in Bangladesh offering rechargeable lamps, smart gadgets, and everyday electronics with nationwide cash on delivery.",
    areaServed: {
      "@type": "Country",
      name: "Bangladesh",
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: settings.hotline || "+8801855642285",
      contactType: "customer service",
      areaServed: "BD",
      availableLanguage: ["English", "Bengali"],
    },
  };

  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
