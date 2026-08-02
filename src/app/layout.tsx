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

  /**
   * The shop's own words win, with the old wording as the fallback.
   *
   * Only `default` is overridden, not `template`: the template is what puts the
   * shop name after a product's own title, and replacing that with a fixed
   * marketing line would give every product page the same title — the fastest
   * way to lose the search results this is meant to help.
   */
  const title = settings.seoTitle || `${name} — ${copy.brand.tagline}`;
  const description =
    settings.seoDescription ||
    "Buy original smartphones, earbuds, smartwatches, laptops and accessories in Bangladesh. Cash on delivery nationwide, 24–48 hour delivery in Dhaka.";

  return {
    metadataBase: new URL(siteConfig.url),
    title: {
      default: title,
      template: `%s · ${name}`,
    },
    description,
    applicationName: name,
    formatDetection: { telephone: true },
    openGraph: {
      type: "website",
      locale: "en_BD",
      siteName: name,
    },
    robots: { index: true, follow: true },
    /**
     * Tab icon, uploaded from the branding screen.
     *
     * The default lives in `public/`, NOT at `app/favicon.ico`. Next's
     * file-convention metadata wins over anything set here, so while the file
     * sat in the route segment an uploaded icon was accepted, stored and then
     * silently ignored by every browser. Moving it makes this the single place
     * the icon is decided, with the bundled file as the fallback when no icon
     * has been uploaded.
     */
    icons: { icon: settings.faviconUrl ?? "/favicon.ico" },
  };
}

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // Never block pinch-zoom — it is an accessibility requirement, and the
  // layout is fluid enough that it doesn't need locking.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
