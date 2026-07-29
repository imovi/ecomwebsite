import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/Toaster";
import { copy } from "@/lib/copy";
import "./globals.css";

/** One weight axis, latin only. A second webfont is a second render-blocking
 *  request on a 4G connection — Bangla falls back to system fonts by design. */
const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://gng.com.bd"),
  title: {
    default: `${copy.brand.name} — ${copy.brand.tagline}`,
    template: `%s · ${copy.brand.name}`,
  },
  description:
    "Buy original smartphones, earbuds, smartwatches, laptops and accessories in Bangladesh. Cash on delivery nationwide, 24–48 hour delivery in Dhaka.",
  applicationName: copy.brand.name,
  formatDetection: { telephone: true },
  openGraph: {
    type: "website",
    locale: "en_BD",
    siteName: copy.brand.name,
  },
  robots: { index: true, follow: true },
};

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
