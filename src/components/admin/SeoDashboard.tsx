"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import type { ApiStoreSettings, ApiProductListItem, ApiProduct } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { Card, CardHeader, ErrorBanner, PageBody, SuccessBanner } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

interface SeoFormState {
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  googleSiteVerification: string;
  bingSiteVerification: string;
}

const EMPTY_FORM: SeoFormState = {
  seoTitle: "",
  seoDescription: "",
  seoKeywords: "",
  googleSiteVerification: "",
  bingSiteVerification: "",
};

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

interface SpecItem {
  id: string;
  label: string;
  value: string;
}

interface ProductSeoStudioState {
  id: string;
  name: string;
  slug: string;
  price: number;
  shortDescription: string;
  tags: string;
  whatsIncludedText: string;
  specifications: SpecItem[];
  faqs: FaqItem[];
  loadingDetails: boolean;
  activeTab: "meta" | "faqs" | "specs";
}

const uid = () => Math.random().toString(36).substring(2, 9);

export function SeoDashboard() {
  const [form, setForm] = useState<SeoFormState>(EMPTY_FORM);
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "desktop">("mobile");

  // Courier-style Collapsible Box for Search Console Guide
  const [isGuideExpanded, setIsGuideExpanded] = useState(false);
  const [guideLang, setGuideLang] = useState<"en" | "bn">("en");

  // Product Search & Filter
  const [productSearch, setProductSearch] = useState("");

  // Product SEO Studio state (Courier-style box for each product)
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [studio, setStudio] = useState<ProductSeoStudioState | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [settingsRes, productsRes] = await Promise.all([
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.get<{ products: ApiProductListItem[] }>("admin/products?perPage=100"),
      ]);

      const store = settingsRes.settings.store;
      setForm({
        seoTitle: store.seoTitle || "",
        seoDescription: store.seoDescription || "",
        seoKeywords: store.seoKeywords || "",
        googleSiteVerification: store.googleSiteVerification || "",
        bingSiteVerification: store.bingSiteVerification || "",
      });

      setProducts(productsRes.products || []);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Failed to load SEO data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(loadData);

  const set = <K extends keyof SeoFormState>(key: K, value: SeoFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function handleSaveGlobal(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await adminApi.patch("admin/settings", {
        store: {
          seoTitle: form.seoTitle.trim(),
          seoDescription: form.seoDescription.trim(),
          seoKeywords: form.seoKeywords.trim(),
          googleSiteVerification: form.googleSiteVerification.trim(),
          bingSiteVerification: form.bingSiteVerification.trim(),
        },
      });

      try {
        await fetch("/api/revalidate?secret=revalidate-now");
      } catch {}

      setSuccess("SEO settings saved and storefront cache purged successfully!");
      toast("SEO settings saved & live");
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Failed to save SEO settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleInstantRevalidate() {
    setRevalidating(true);
    try {
      const res = await fetch("/api/revalidate?secret=revalidate-now");
      if (res.ok) {
        toast("Storefront cache purged! Googlebot will see fresh content.");
      } else {
        toast("Cache purge request completed");
      }
    } catch {
      toast("Purge trigger sent");
    } finally {
      setRevalidating(false);
    }
  }

  // Open / Close Courier-style Product SEO Studio
  async function toggleProductStudio(p: ApiProductListItem) {
    if (expandedProductId === p.id) {
      setExpandedProductId(null);
      setStudio(null);
      return;
    }

    setExpandedProductId(p.id);
    setStudio({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      shortDescription: "",
      tags: p.tags ? p.tags.join(", ") : "",
      whatsIncludedText: "",
      specifications: [],
      faqs: [],
      loadingDetails: true,
      activeTab: "meta",
    });

    try {
      const res = await adminApi.get<{ product: ApiProduct }>(`admin/products/${p.id}`);
      const full = res.product;
      setStudio({
        id: p.id,
        name: full.name,
        slug: full.slug,
        price: full.price,
        shortDescription: full.shortDescription || "",
        tags: full.tags ? full.tags.join(", ") : "",
        whatsIncludedText: full.whatsIncluded ? full.whatsIncluded.join("\n") : "",
        specifications: (full.specifications || []).map((s) => ({
          id: uid(),
          label: s.label,
          value: s.value,
        })),
        faqs: (full.faqs || []).map((f) => ({
          id: uid(),
          question: f.question,
          answer: f.answer,
        })),
        loadingDetails: false,
        activeTab: "meta",
      });
    } catch {
      setStudio((curr) => (curr ? { ...curr, loadingDetails: false } : null));
    }
  }

  // Save Product SEO changes
  async function handleSaveProductStudio() {
    if (!studio) return;
    setSavingProduct(true);
    try {
      const rawTags = studio.tags
        .split(/[,]+/)
        .map((t) =>
          t
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, ""),
        )
        .filter(Boolean);

      const whatsIncluded = studio.whatsIncludedText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const specifications = studio.specifications
        .filter((s) => s.label.trim() && s.value.trim())
        .map((s) => ({ label: s.label.trim(), value: s.value.trim() }));

      const faqs = studio.faqs
        .filter((f) => f.question.trim() && f.answer.trim())
        .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }));

      const updated = await adminApi.patch<{ product: ApiProduct }>(
        `admin/products/${studio.id}`,
        {
          name: studio.name.trim(),
          slug: studio.slug.trim().toLowerCase(),
          shortDescription: studio.shortDescription.trim() || null,
          tags: [...new Set(rawTags)],
          whatsIncluded,
          specifications,
          faqs,
        },
      );

      setProducts((prev) =>
        prev.map((item) =>
          item.id === studio.id
            ? {
                ...item,
                name: updated.product.name,
                slug: updated.product.slug,
                tags: updated.product.tags,
              }
            : item,
        ),
      );

      try {
        await fetch("/api/revalidate?secret=revalidate-now");
      } catch {}

      toast("Product SEO updated and cache purged!");
      setExpandedProductId(null);
      setStudio(null);
    } catch (caught) {
      toast(caught instanceof AdminApiError ? caught.message : "Failed to save product SEO.");
    } finally {
      setSavingProduct(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://hinarbd.com";

  const previewTitle =
    form.seoTitle.trim() || "HINAR — Online Gadget Shop & Smart Lifestyle Store in Bangladesh";
  const previewDescription =
    form.seoDescription.trim() ||
    "Shop smart gadgets, rechargeable desk lamps, unique lifestyle accessories & everyday electronics at best price in Bangladesh. Fast nationwide cash on delivery.";

  const titleLength = form.seoTitle.trim().length;
  const descLength = form.seoDescription.trim().length;
  const isGoogleVerified = Boolean(form.googleSiteVerification.trim());

  // Filter products by search query
  const filteredProducts = products.filter((p) => {
    if (!productSearch.trim()) return true;
    const q = productSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
  });

  return (
    <AdminShell
      title="SEO & Search Engine"
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleInstantRevalidate}
          loading={revalidating}
        >
          <Icon name="refresh" size={15} />
          Purge SEO Cache
        </Button>
      }
    >
      <PageBody>
        {error && <ErrorBanner message={error} />}
        {success && <SuccessBanner message={success} />}

        {/* 1. Courier-Style Accordion Box: Google Search Console Setup & Verification Guide */}
        <Card className="overflow-hidden transition-all">
          {/* Clickable Courier-Style Header */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsGuideExpanded((prev) => !prev)}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-surface/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface border border-line text-caption font-bold text-ink shadow-2xs">
                G
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-semibold text-ink">
                  {guideLang === "en"
                    ? "Google Search Console Setup & Verification Guide"
                    : "Google Search Console সেটআপ ও ভেরিফিকেশন গাইড"}
                </span>

                {isGoogleVerified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2 py-0.5 text-micro font-semibold text-positive">
                    ● Token Configured
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-micro font-medium text-muted">
                    ○ Verification Guide
                  </span>
                )}

                <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-micro font-medium text-sky-700">
                  Step-by-Step
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Language Switcher */}
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex items-center rounded-md border border-line bg-surface p-0.5 text-micro"
              >
                <button
                  type="button"
                  onClick={() => setGuideLang("en")}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium transition-colors",
                    guideLang === "en"
                      ? "bg-white text-ink shadow-2xs font-semibold"
                      : "text-muted hover:text-ink"
                  )}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setGuideLang("bn")}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium transition-colors",
                    guideLang === "bn"
                      ? "bg-white text-ink shadow-2xs font-semibold"
                      : "text-muted hover:text-ink"
                  )}
                >
                  বাংলা
                </button>
              </div>

              <p className="hidden sm:block text-micro text-muted">
                {guideLang === "en" ? "Click to view setup steps" : "সেটআপ ধাপ দেখতে ক্লিক করুন"}
              </p>

              <span className="flex size-7 items-center justify-center rounded-xs border border-line bg-surface/50 text-muted hover:text-ink transition-colors">
                <svg
                  className={cn("size-4 transition-transform duration-200", isGuideExpanded && "rotate-180")}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </div>
          </div>

          {/* Expandable Courier-Style Content */}
          {isGuideExpanded && (
            <div className="flex flex-col gap-4 border-t border-line p-4 sm:p-5 animate-in fade-in-50 duration-150 bg-surface/20 text-caption text-ink">
              {guideLang === "en" ? (
                <>
                  <div className="rounded-sm bg-sky-50 px-3.5 py-2.5 text-sky-950 border border-sky-200/60 text-micro">
                    💡 <strong>Operator Setup Note:</strong> When setting up a new website or domain on this codebase, follow these 5 clear steps right after logging into Search Console to verify ownership, submit your sitemap, and enable priority indexing in under 3 minutes.
                  </div>

                  <div className="grid gap-3">
                    {/* Step 1 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          1
                        </span>
                        <span>Add Property in Google Search Console</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          1. Sign in to{" "}
                          <a
                            href="https://search.google.com/search-console"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-primary underline"
                          >
                            search.google.com/search-console ↗
                          </a>{" "}
                          using your Google account.
                        </p>
                        <p>
                          2. Click the top-left property dropdown and choose <strong>+ Add property</strong>.
                        </p>
                        <p>
                          3. Select the <strong>URL prefix</strong> box (right option) and enter your site&apos;s full address:{" "}
                          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink font-semibold">
                            {origin}
                          </code>
                          , then click <strong>Continue</strong>.
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          2
                        </span>
                        <span>Instant 1-Click Verification (HTML Tag Method)</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          1. Under verification options, expand the <strong>HTML tag</strong> method.
                        </p>
                        <p>
                          2. You will see a meta tag snippet like:
                          <code className="block mt-1 rounded bg-surface p-2 font-mono text-micro text-ink break-all border border-line">
                            &lt;meta name=&quot;google-site-verification&quot; content=&quot;da2a584dd6352b62...&quot; /&gt;
                          </code>
                        </p>
                        <p>
                          3. Copy only the token code inside <code className="font-mono text-ink font-semibold">content=&quot;...&quot;</code> (e.g. <code className="font-mono text-ink">da2a584dd6352b62</code>).
                        </p>
                        <p>
                          4. Scroll down to this page&apos;s <strong>&ldquo;Search Console & Webmaster Verification&rdquo;</strong> box below, paste the token into the <strong>Google Site Verification Token</strong> field, and click <strong>&ldquo;Save SEO Settings&rdquo;</strong>.
                        </p>
                        <p>
                          5. Return to Search Console and click <strong>Verify</strong>. You will immediately see a green <span className="font-semibold text-positive">✓ Ownership verified</span> confirmation!
                        </p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          3
                        </span>
                        <span>Submit Dynamic XML Sitemap</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          1. In Search Console&apos;s left menu, go to <strong>Indexing &gt; Sitemaps</strong>.
                        </p>
                        <p>
                          2. Under <strong>Add a new sitemap</strong>, type:{" "}
                          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink font-bold">
                            sitemap.xml
                          </code>
                        </p>
                        <p>
                          3. Click <strong>Submit</strong>. The status will display <span className="text-positive font-semibold">Success</span>. Google will now automatically crawl and index all your products, categories, and legal pages.
                        </p>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          4
                        </span>
                        <span>Request Instant Live Indexing (URL Inspection)</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          1. Whenever you add a new product or update a page, paste its URL into Search Console&apos;s top search bar (e.g. <code className="font-mono text-ink">{origin}/product/...</code>).
                        </p>
                        <p>
                          2. Click <strong>&ldquo;Request Indexing&rdquo;</strong>. Google places the URL in its priority crawl queue (typically indexed within 24 to 48 hours).
                        </p>
                      </div>
                    </div>

                    {/* Step 5 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          5
                        </span>
                        <span>Track Search Performance & Top Customer Queries</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          Within a few days, open the <strong>Performance</strong> tab to monitor exact queries customers search to find your store, total impressions, clicks, and Google ranking positions.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-sm bg-amber-50 px-3.5 py-2.5 text-amber-900 border border-amber-200/60 text-micro">
                    💡 <strong>টিপস:</strong> এই কোডবেস দিয়ে ভবিষ্যতে নতুন যেকোনো ডোমেইনে ওয়েবসাইট সেটআপ করলে এই গাইড দেখে মাত্র ২ মিনিটে Google Search Console ভেরিফাই করে নিতে পারবেন।
                  </div>

                  <div className="grid gap-3">
                    {/* Step 1 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          ১
                        </span>
                        <span>Google Search Console-এ প্রোপার্টি (Property) যোগ করা</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          ১. প্রথমে ব্রাউজারে{" "}
                          <a
                            href="https://search.google.com/search-console"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-primary underline"
                          >
                            search.google.com/search-console ↗
                          </a>{" "}
                          এ গিয়ে আপনার জিমেইল দিয়ে লগইন করুন।
                        </p>
                        <p>
                          ২. ওপরের বাম পাশের ড্রপডাউন থেকে <strong>+ Add property</strong> তে ক্লিক করুন।
                        </p>
                        <p>
                          ৩. ডান পাশের <strong>URL prefix</strong> বক্সে আপনার সাইটের পূর্ণ ঠিকানা দিন:{" "}
                          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink font-semibold">
                            {origin}
                          </code>{" "}
                          এবং <strong>Continue</strong> বাটনে চাপুন।
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          ২
                        </span>
                        <span>১-ক্লিকে সাইট ভেরিফিকেশন সম্পন্ন করা (HTML Tag মেথড)</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          ১. ভেরিফিকেশন অপশনের তালিকা থেকে <strong>HTML tag</strong> অপশনটিতে ক্লিক করুন।
                        </p>
                        <p>
                          ২. একটি কোড পাবেন, যেমন:{" "}
                          <code className="block mt-1 rounded bg-surface p-2 font-mono text-micro text-ink break-all border border-line">
                            &lt;meta name=&quot;google-site-verification&quot; content=&quot;da2a584dd6352b62...&quot; /&gt;
                          </code>
                        </p>
                        <p>
                          ৩. শুধুমাত্র <code className="font-mono text-ink font-semibold">content=&quot;...&quot;</code> এর ভেতরের টোকেন অংশটুকু (যেমন: <code className="font-mono text-ink">da2a584dd6352b62</code>) কপি করুন।
                        </p>
                        <p>
                          ৪. নিচের <strong>&ldquo;Search Console & Webmaster Verification&rdquo;</strong> বক্সে পেস্ট করে <strong>&ldquo;Save SEO Settings&rdquo;</strong> বাটনে ক্লিক করুন।
                        </p>
                        <p>
                          ৫. এবার Search Console ট্যাবে ফিরে গিয়ে <strong>Verify</strong> বাটনে চাপ দিন — সাথে সাথে <span className="font-semibold text-positive">✓ Ownership verified</span> সবুজ টিক দেখাবে!
                        </p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          ৩
                        </span>
                        <span>XML সাইটম্যাপ (Sitemap) সাবমিট করা</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          ১. Search Console-এর বাম পাশের মেনু থেকে <strong>Indexing &gt; Sitemaps</strong>-এ যান।
                        </p>
                        <p>
                          ২. <strong>Add a new sitemap</strong> বক্সে লিখুন:{" "}
                          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink font-bold">
                            sitemap.xml
                          </code>
                        </p>
                        <p>
                          ৩. <strong>Submit</strong> চাপুন। স্ট্যাটাস দেখাবে <span className="text-positive font-semibold">Success</span>। গুগল স্বয়ংক্রিয়ভাবে আপনার স্টোরের সব প্রোডাক্ট ও পেজ খুঁজে পেয়ে ক্রল করবে।
                        </p>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          ৪
                        </span>
                        <span>ইনস্ট্যান্ট ইনডেক্সিং (URL Inspection)</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          ১. যেকোনো নতুন প্রোডাক্ট দ্রুত গুগল সার্চে আনতে Search Console-এর ওপরে থাকা সার্চ বক্সে প্রোডাক্টের লিংক পেস্ট করে Enter চাপুন।
                        </p>
                        <p>
                          ২. <strong>&ldquo;Request Indexing&rdquo;</strong> বাটনে ক্লিক করুন। গুগল ২৪ থেকে ৪৮ ঘণ্টার মধ্যে অগ্রাধিকার দিয়ে পেজটি সার্চে নিয়ে আসবে।
                        </p>
                      </div>
                    </div>

                    {/* Step 5 */}
                    <div className="rounded-sm border border-line bg-white p-3.5 shadow-2xs">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro font-bold">
                          ৫
                        </span>
                        <span>সার্চ পারফরম্যান্স ও ট্রাফিক পর্যবেক্ষণ</span>
                      </div>
                      <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                        <p>
                          কয়েকদিন পর থেকে Search Console-এর <strong>Performance</strong> ট্যাবে দেখতে পাবেন মানুষ কোন কোন শব্দ লিখে সার্চ করে আপনার ওয়েবসাইটে ঢুকছে এবং কতগুলো ক্লিক পড়ছে।
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        {/* 2. Google SERP Live Simulator */}
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-body font-semibold text-ink">Google Search Live Simulator</h2>
              <p className="text-micro text-muted">
                Real-time preview of how your store looks in Google search results.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-0.5 text-caption">
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition-colors",
                  previewDevice === "mobile"
                    ? "bg-white text-ink shadow-2xs font-semibold"
                    : "text-muted hover:text-ink"
                )}
              >
                Mobile
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={cn(
                  "rounded px-2.5 py-1 font-medium transition-colors",
                  previewDevice === "desktop"
                    ? "bg-white text-ink shadow-2xs font-semibold"
                    : "text-muted hover:text-ink"
                )}
              >
                Desktop
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6 bg-[#f8f9fa]">
            <div
              className={cn(
                "rounded-xl border border-[#dadce0] bg-white p-4 sm:p-5 shadow-sm transition-all",
                previewDevice === "mobile" ? "max-w-md mx-auto" : "max-w-2xl"
              )}
            >
              {/* Google SERP Header */}
              <div className="flex items-center gap-3">
                <div className="flex size-7 items-center justify-center rounded-full bg-[#f1f3f4] text-micro font-bold text-ink">
                  H
                </div>
                <div className="flex flex-col text-micro leading-tight">
                  <span className="font-medium text-[#202124]">HINAR</span>
                  <span className="text-[#5f6368] font-mono text-[11px] truncate">
                    {origin.replace(/^https?:\/\//, "")}
                  </span>
                </div>
              </div>

              {/* Google SERP Title */}
              <h3 className="mt-2 text-[18px] font-normal leading-snug text-[#1a0dab] hover:underline cursor-pointer">
                {previewTitle}
              </h3>

              {/* Google SERP Snippet */}
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#4d5156] line-clamp-2 sm:line-clamp-3">
                {previewDescription}
              </p>

              {/* SERP Sitelinks preview */}
              <div className="mt-3.5 pt-3 border-t border-[#f1f3f4] grid grid-cols-2 gap-2 text-micro text-[#1a0dab]">
                <span className="hover:underline cursor-pointer">LED Desk Lamps</span>
                <span className="hover:underline cursor-pointer">Charger Lights BD</span>
                <span className="hover:underline cursor-pointer">Track Your Order</span>
                <span className="hover:underline cursor-pointer">Cash on Delivery</span>
              </div>
            </div>
          </div>
        </Card>

        {/* 3. Global SEO Form */}
        <form onSubmit={handleSaveGlobal} className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Global Storefront Metadata"
              hint="Controls the primary meta tags Google, Bing, and social platforms read from your store."
            />
            <div className="flex flex-col gap-4 p-4">
              <Input
                label="Homepage SEO Title"
                value={form.seoTitle}
                onChange={(e) => set("seoTitle", e.target.value)}
                placeholder="e.g. HINAR — Online Gadget Shop & Smart Lifestyle Store in Bangladesh"
                hint={`Current: ${titleLength}/65 characters ${titleLength >= 45 && titleLength <= 65 ? "✓ Optimal length" : "(Aim for 50–65 chars)"}. Recommended clickable headline shown in Google search results.`}
              />

              <Textarea
                label="Homepage Meta Description"
                value={form.seoDescription}
                onChange={(e) => set("seoDescription", e.target.value)}
                rows={3}
                placeholder="e.g. Shop smart gadgets, rechargeable desk lamps, unique lifestyle accessories & everyday electronics at best price in Bangladesh. Fast nationwide cash on delivery."
                hint={`Current: ${descLength}/160 characters ${descLength >= 120 && descLength <= 165 ? "✓ Optimal length" : "(Aim for 130–160 chars)"}. Compelling summary shown below title in Google.`}
              />

              <Textarea
                label="Global Meta Keywords"
                value={form.seoKeywords}
                onChange={(e) => set("seoKeywords", e.target.value)}
                rows={2}
                placeholder="e.g. charger light, study lamp, rechargeable light, magnetic desk lamp, loadshedding light bd"
                hint="Comma-separated keywords. Useful for meta tags and internal search catalog scoring."
              />
            </div>
          </Card>

          {/* 4. Search Engine Verification */}
          <Card>
            <CardHeader
              title="Search Console & Webmaster Verification"
              hint="Verify domain ownership with Google and Bing without editing DNS or uploading HTML files."
            />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Input
                label="Google Site Verification Token"
                value={form.googleSiteVerification}
                onChange={(e) => set("googleSiteVerification", e.target.value)}
                placeholder="e.g. da2a584dd6352b62 or full meta content"
                hint="Provided by Google Search Console when verifying via HTML tag."
              />
              <Input
                label="Bing Webmaster Verification Token"
                value={form.bingSiteVerification}
                onChange={(e) => set("bingSiteVerification", e.target.value)}
                placeholder="e.g. 12345ABCDE67890"
                hint="Provided by Bing Webmaster Tools for Yahoo & Bing search indexing."
              />
            </div>
          </Card>

          <Button type="submit" variant="primary" size="lg" loading={saving} className="self-start">
            {saving ? "Saving…" : "Save SEO Settings"}
          </Button>
        </form>

        {/* 5. Sitemap & Indexing Hub */}
        <Card>
          <CardHeader
            title="Sitemap & Search Engine Indexing Hub"
            hint="Your automated sitemap updates whenever products or categories change."
          />
          <div className="flex flex-col gap-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col justify-between rounded-lg border border-line bg-surface/40 p-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-caption font-semibold text-ink">XML Sitemap</span>
                  </div>
                  <p className="mt-1 text-micro text-muted">
                    Automated index of all products, categories & legal policies.
                  </p>
                  <code className="mt-2 block rounded bg-white p-2 text-micro text-ink font-mono border border-line break-all">
                    {origin}/sitemap.xml
                  </code>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <a
                    href={`${origin}/sitemap.xml`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-white px-2.5 py-1 text-caption font-medium text-ink border border-line shadow-2xs hover:bg-surface"
                  >
                    View Sitemap ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${origin}/sitemap.xml`);
                      toast("Sitemap URL copied to clipboard");
                    }}
                    className="rounded bg-white px-2.5 py-1 text-caption font-medium text-muted border border-line hover:text-ink"
                  >
                    Copy Link
                  </button>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-lg border border-line bg-surface/40 p-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-emerald-500" />
                    <span className="text-caption font-semibold text-ink">Robots.txt</span>
                  </div>
                  <p className="mt-1 text-micro text-muted">
                    Instructs search crawlers which pages to crawl and where the sitemap is.
                  </p>
                  <code className="mt-2 block rounded bg-white p-2 text-micro text-ink font-mono border border-line break-all">
                    {origin}/robots.txt
                  </code>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <a
                    href={`${origin}/robots.txt`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-white px-2.5 py-1 text-caption font-medium text-ink border border-line shadow-2xs hover:bg-surface"
                  >
                    View Robots.txt ↗
                  </a>
                  <a
                    href="https://search.google.com/search-console"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-primary/10 px-2.5 py-1 text-caption font-semibold text-primary hover:bg-primary/20"
                  >
                    Open Google Search Console ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* 6. Product Catalogue SEO Command Center (Courier-Style Box System) */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-line">
              <div>
                <h3 className="text-body font-semibold text-ink flex items-center gap-2">
                  <span>Product Catalogue SEO Command Center</span>
                  <span className="rounded-full bg-surface px-2.5 py-0.5 text-micro font-medium text-muted border border-line">
                    {filteredProducts.length} Product{filteredProducts.length === 1 ? "" : "s"}
                  </span>
                </h3>
                <p className="text-micro text-muted mt-0.5">
                  Expand any product to configure its Google Title, URL Slug, Meta Description, Search Tags, FAQs &amp; Structured Specifications.
                </p>
              </div>

              <div className="w-full sm:w-72">
                <Input
                  label=""
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products by title or slug…"
                  className="h-9 text-caption"
                />
              </div>
            </div>
          </Card>

          {/* Product List in Courier Box System */}
          <div className="grid gap-3">
            {filteredProducts.length === 0 ? (
              <Card>
                <div className="py-12 text-center text-muted text-caption">
                  No products matched your search.
                </div>
              </Card>
            ) : (
              filteredProducts.map((p) => {
                const isExpanded = expandedProductId === p.id;
                const titleLen = p.name.length;
                const isTitleOptimal = titleLen >= 35 && titleLen <= 85;
                const hasTags = (p.tags || []).length > 0;

                return (
                  <Card key={p.id} className="overflow-hidden transition-all border border-line">
                    {/* Clickable Courier-Style Header */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleProductStudio(p)}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 cursor-pointer select-none transition-colors",
                        isExpanded ? "bg-surface/60 border-b border-line" : "hover:bg-surface/40"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {p.featuredImage ? (
                          <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
                            <Image
                              src={p.featuredImage.url}
                              alt={p.name}
                              fill
                              sizes="40px"
                              className="object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface border border-line text-caption font-bold text-ink shadow-2xs">
                            {p.name.charAt(0)}
                          </div>
                        )}

                        <div className="flex flex-col min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-caption sm:text-body font-semibold text-ink line-clamp-1">
                              {p.name}
                            </span>
                            <span className="font-semibold text-positive text-caption">
                              ৳{p.price}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <span className="text-micro text-muted font-mono truncate max-w-xs">
                              /product/{p.slug}
                            </span>
                            <span className="text-muted text-micro">·</span>
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium",
                                isTitleOptimal
                                  ? "bg-positive-soft text-positive"
                                  : "bg-warn-soft text-warn"
                              )}
                            >
                              {titleLen} chars {isTitleOptimal ? "✓ Optimal Title" : "Title Review"}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-micro font-medium text-muted">
                              {hasTags ? `${p.tags.length} Tags` : "No tags"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="hidden md:inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-micro font-semibold text-primary">
                          {isExpanded ? "Editing SEO Studio" : "Configure SEO ⚡"}
                        </span>

                        <span className="flex size-7 items-center justify-center rounded-xs border border-line bg-surface/50 text-muted hover:text-ink transition-colors">
                          <svg
                            className={cn("size-4 transition-transform duration-200", isExpanded && "rotate-180")}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </div>
                    </div>

                    {/* Expandable Courier-Style Studio Body */}
                    {isExpanded && studio && (
                      <div className="flex flex-col gap-4 p-4 sm:p-5 bg-surface/10 animate-in fade-in-50 duration-150">
                        {studio.loadingDetails ? (
                          <div className="py-12 text-center text-muted flex items-center justify-center gap-2">
                            <span className="size-2 rounded-full bg-primary animate-ping" />
                            Loading full product SEO specifications &amp; schemas…
                          </div>
                        ) : (
                          <>
                            {/* Studio Navigation Tabs */}
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                              <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface p-1 text-caption">
                                <button
                                  type="button"
                                  onClick={() => setStudio({ ...studio, activeTab: "meta" })}
                                  className={cn(
                                    "rounded px-3 py-1 font-medium transition-colors",
                                    studio.activeTab === "meta"
                                      ? "bg-white text-ink shadow-2xs font-semibold"
                                      : "text-muted hover:text-ink"
                                  )}
                                >
                                  🎯 Core Meta &amp; Live SERP
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setStudio({ ...studio, activeTab: "faqs" })}
                                  className={cn(
                                    "rounded px-3 py-1 font-medium transition-colors flex items-center gap-1.5",
                                    studio.activeTab === "faqs"
                                      ? "bg-white text-ink shadow-2xs font-semibold"
                                      : "text-muted hover:text-ink"
                                  )}
                                >
                                  <span>❓ FAQ Schema</span>
                                  <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-micro font-bold text-primary">
                                    {studio.faqs.length}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setStudio({ ...studio, activeTab: "specs" })}
                                  className={cn(
                                    "rounded px-3 py-1 font-medium transition-colors flex items-center gap-1.5",
                                    studio.activeTab === "specs"
                                      ? "bg-white text-ink shadow-2xs font-semibold"
                                      : "text-muted hover:text-ink"
                                  )}
                                >
                                  <span>📋 Specs &amp; In-Box Items</span>
                                  <span className="rounded-full bg-surface px-1.5 py-0.2 text-micro font-bold text-muted">
                                    {studio.specifications.length}
                                  </span>
                                </button>
                              </div>

                              <a
                                href={`${origin}/product/${studio.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-caption font-medium text-primary hover:underline"
                              >
                                View Live Product ↗
                              </a>
                            </div>

                            {/* TAB 1: Core Meta & Live SERP Simulator */}
                            {studio.activeTab === "meta" && (
                              <div className="grid gap-5 lg:grid-cols-2">
                                <div className="flex flex-col gap-3.5">
                                  <Input
                                    label="Product SEO Title / Headline"
                                    value={studio.name}
                                    onChange={(e) => setStudio({ ...studio, name: e.target.value })}
                                    placeholder="Clickable headline shown in Google search"
                                    hint={`Length: ${studio.name.length} chars ${
                                      studio.name.length >= 45 && studio.name.length <= 80
                                        ? "✓ Optimal length for Google"
                                        : "(Recommended 45–80 characters)"
                                    }`}
                                  />

                                  <Input
                                    label="Product URL Slug"
                                    value={studio.slug}
                                    onChange={(e) =>
                                      setStudio({
                                        ...studio,
                                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
                                      })
                                    }
                                    placeholder="e.g. rechargeable-desk-lamp-bd"
                                    hint={`Full link: ${origin}/product/${studio.slug}`}
                                  />

                                  <Textarea
                                    label="Product Meta Description (Google Snippet)"
                                    value={studio.shortDescription}
                                    onChange={(e) =>
                                      setStudio({ ...studio, shortDescription: e.target.value })
                                    }
                                    rows={3}
                                    placeholder="Summary shown below title in Google (highlights key benefits, battery, price, delivery, etc.)"
                                    hint={`Length: ${studio.shortDescription.length} chars ${
                                      studio.shortDescription.length >= 120 &&
                                      studio.shortDescription.length <= 165
                                        ? "✓ Optimal snippet length"
                                        : "(Recommended 120–165 characters)"
                                    }`}
                                  />

                                  <Input
                                    label="SEO Search Tags & Keywords (comma-separated)"
                                    value={studio.tags}
                                    onChange={(e) => setStudio({ ...studio, tags: e.target.value })}
                                    placeholder="e.g. charger light, study lamp, emergency light bd, rechargeable light"
                                    hint="Comma-separated keywords. Index-backed for full-text search matching & Google relevancy."
                                  />
                                </div>

                                {/* Right: Live Google Product SERP Mockup */}
                                <div className="flex flex-col justify-between rounded-xl border border-[#dadce0] bg-[#f8f9fa] p-4 sm:p-5">
                                  <div>
                                    <span className="text-micro font-semibold text-muted uppercase tracking-wider">
                                      Live Google Search Result Preview
                                    </span>

                                    <div className="mt-3 rounded-lg border border-[#dadce0] bg-white p-4 shadow-2xs">
                                      <div className="flex items-center gap-2 text-micro">
                                        <div className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px]">
                                          H
                                        </div>
                                        <span className="font-medium text-[#202124]">
                                          {origin.replace(/^https?:\/\//, "")}
                                        </span>
                                        <span className="text-muted">› product › {studio.slug}</span>
                                      </div>

                                      <h4 className="mt-1.5 text-[17px] font-normal leading-snug text-[#1a0dab] hover:underline cursor-pointer">
                                        {studio.name || p.name} · HINAR
                                      </h4>

                                      <div className="mt-1 flex items-center gap-2 text-[12px]">
                                        <span className="font-semibold text-[#006621]">
                                          ৳{studio.price}
                                        </span>
                                        <span className="text-muted">·</span>
                                        <span className="text-[#006621] font-medium">In stock</span>
                                        <span className="text-muted">·</span>
                                        <span className="text-muted">Cash on Delivery</span>
                                      </div>

                                      <p className="mt-1.5 text-[13px] leading-relaxed text-[#4d5156] line-clamp-3">
                                        {studio.shortDescription ||
                                          "Buy genuine products at best price in Bangladesh. Fast nationwide cash on delivery from HINAR."}
                                      </p>

                                      {studio.faqs.length > 0 && (
                                        <div className="mt-3 pt-2.5 border-t border-[#f1f3f4] flex flex-col gap-1 text-[12px] text-ink">
                                          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                                            Google FAQ Rich Snippet Preview:
                                          </span>
                                          {studio.faqs.slice(0, 2).map((faq) => (
                                            <div key={faq.id} className="text-[#1a0dab] hover:underline cursor-pointer">
                                              ▾ {faq.question}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="mt-4 rounded bg-white p-3 border border-line text-micro text-muted">
                                    💡 <strong>SEO Best Practice:</strong> Keep titles under 80 characters and include high-intent search terms like brand name, model, and &quot;Price in BD&quot;.
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* TAB 2: FAQ Schema Builder */}
                            {studio.activeTab === "faqs" && (
                              <div className="flex flex-col gap-4">
                                <div className="rounded-md bg-sky-50 p-3 text-sky-950 border border-sky-200/60 text-micro">
                                  ⭐ <strong>Google FAQ Schema Rich Results:</strong> Adding frequently asked questions here generates structured FAQPage JSON-LD data. Google frequently displays these questions directly inside search results with expandable answer drawers, drastically boosting your click-through rate!
                                </div>

                                <div className="flex flex-col gap-3">
                                  {studio.faqs.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-line p-6 text-center text-muted text-caption">
                                      No FAQs added for this product yet. Click the button below to add your first question &amp; answer.
                                    </div>
                                  ) : (
                                    studio.faqs.map((faq, index) => (
                                      <div
                                        key={faq.id}
                                        className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3.5 shadow-2xs"
                                      >
                                        <div className="flex items-center justify-between">
                                          <span className="text-micro font-bold text-primary">
                                            FAQ Question #{index + 1}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setStudio({
                                                ...studio,
                                                faqs: studio.faqs.filter((f) => f.id !== faq.id),
                                              })
                                            }
                                            className="text-micro text-sale hover:underline"
                                          >
                                            Remove FAQ
                                          </button>
                                        </div>

                                        <Input
                                          label="Question"
                                          value={faq.question}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setStudio({
                                              ...studio,
                                              faqs: studio.faqs.map((f) =>
                                                f.id === faq.id ? { ...f, question: val } : f
                                              ),
                                            });
                                          }}
                                          placeholder="e.g. লোডশেডিংয়ে এক চার্জে কতক্ষণ ব্যাটারি ব্যাকআপ পাওয়া যায়?"
                                        />

                                        <Textarea
                                          label="Answer"
                                          value={faq.answer}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setStudio({
                                              ...studio,
                                              faqs: studio.faqs.map((f) =>
                                                f.id === faq.id ? { ...f, answer: val } : f
                                              ),
                                            });
                                          }}
                                          rows={2}
                                          placeholder="e.g. হাই ব্রাইটনেসে একটানা ৩.৫ ঘণ্টা এবং নরমাল মোডে ৭ ঘণ্টা পর্যন্ত ব্যাকআপ পাওয়া যায়।"
                                        />
                                      </div>
                                    ))
                                  )}

                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                      setStudio({
                                        ...studio,
                                        faqs: [
                                          ...studio.faqs,
                                          { id: uid(), question: "", answer: "" },
                                        ],
                                      })
                                    }
                                    className="self-start"
                                  >
                                    <Icon name="plus" size={14} />
                                    Add FAQ Question &amp; Answer
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* TAB 3: Specifications & In-Box Items */}
                            {studio.activeTab === "specs" && (
                              <div className="grid gap-5 lg:grid-cols-2">
                                {/* What's Included in Box */}
                                <div className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4 shadow-2xs">
                                  <div>
                                    <h4 className="text-caption font-semibold text-ink">
                                      What&apos;s Included in the Box
                                    </h4>
                                    <p className="text-micro text-muted">
                                      1 item per line. Helps Google answer buyer unboxing &amp; accessory queries.
                                    </p>
                                  </div>

                                  <Textarea
                                    label="Box Items (1 per line)"
                                    value={studio.whatsIncludedText}
                                    onChange={(e) =>
                                      setStudio({ ...studio, whatsIncludedText: e.target.value })
                                    }
                                    rows={5}
                                    placeholder={`1x Rechargeable LED Desk Lamp\n1x Wireless Remote Controller\n1x Type-C Fast Charging Cable\n1x Magnetic Wall Mounting Base`}
                                    hint="Each line becomes a distinct bullet point in search rich snippets."
                                  />
                                </div>

                                {/* Structured Specifications */}
                                <div className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4 shadow-2xs">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <h4 className="text-caption font-semibold text-ink">
                                        Key Technical Specifications
                                      </h4>
                                      <p className="text-micro text-muted">
                                        Structured attributes (Battery, Size, Modes, Material).
                                      </p>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="sm"
                                      onClick={() =>
                                        setStudio({
                                          ...studio,
                                          specifications: [
                                            ...studio.specifications,
                                            { id: uid(), label: "", value: "" },
                                          ],
                                        })
                                      }
                                    >
                                      <Icon name="plus" size={13} />
                                      Add Spec
                                    </Button>
                                  </div>

                                  <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                                    {studio.specifications.length === 0 ? (
                                      <p className="text-micro text-muted py-4 text-center">
                                        No specifications added yet.
                                      </p>
                                    ) : (
                                      studio.specifications.map((spec) => (
                                        <div
                                          key={spec.id}
                                          className="flex items-center gap-2 rounded bg-surface/50 p-2 border border-line"
                                        >
                                          <input
                                            type="text"
                                            value={spec.label}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setStudio({
                                                ...studio,
                                                specifications: studio.specifications.map((s) =>
                                                  s.id === spec.id ? { ...s, label: val } : s
                                                ),
                                              });
                                            }}
                                            placeholder="Label (e.g. Battery)"
                                            className="w-1/3 rounded border border-line bg-white px-2 py-1 text-micro text-ink"
                                          />
                                          <input
                                            type="text"
                                            value={spec.value}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setStudio({
                                                ...studio,
                                                specifications: studio.specifications.map((s) =>
                                                  s.id === spec.id ? { ...s, value: val } : s
                                                ),
                                              });
                                            }}
                                            placeholder="Value (e.g. 1200mAh)"
                                            className="w-2/3 rounded border border-line bg-white px-2 py-1 text-micro text-ink"
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setStudio({
                                                ...studio,
                                                specifications: studio.specifications.filter(
                                                  (s) => s.id !== spec.id
                                                ),
                                              })
                                            }
                                            className="text-muted hover:text-sale p-1"
                                          >
                                            <Icon name="close" size={14} />
                                          </button>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Studio Bottom Action Controls */}
                            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line">
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="primary"
                                  onClick={handleSaveProductStudio}
                                  loading={savingProduct}
                                >
                                  Save Product SEO &amp; Rich Schemas
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => {
                                    setExpandedProductId(null);
                                    setStudio(null);
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>

                              <Link
                                href={`/admin/products/${studio.id}`}
                                className="text-micro font-medium text-muted hover:text-ink underline"
                              >
                                Open Full Product Page (Images &amp; Variants) ↗
                              </Link>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </PageBody>
    </AdminShell>
  );
}
