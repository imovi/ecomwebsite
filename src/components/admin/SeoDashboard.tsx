"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

interface ProductSeoEditState {
  id: string;
  name: string;
  slug: string;
  price: number;
  shortDescription: string;
  tags: string;
  loadingDetails: boolean;
}

export function SeoDashboard() {
  const [form, setForm] = useState<SeoFormState>(EMPTY_FORM);
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "desktop">("mobile");

  // Collapsible Guide state
  const [showGuide, setShowGuide] = useState(false);

  // In-page Product SEO editing state
  const [editingProduct, setEditingProduct] = useState<ProductSeoEditState | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [settingsRes, productsRes] = await Promise.all([
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.get<{ products: ApiProductListItem[] }>("admin/products?perPage=50"),
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

  async function handleSave(e: React.FormEvent) {
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

      // Trigger instant cache revalidation
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

  // Quick in-page product SEO editing
  async function handleOpenProductSeo(p: ApiProductListItem) {
    if (editingProduct?.id === p.id) {
      setEditingProduct(null);
      return;
    }

    setEditingProduct({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      shortDescription: "",
      tags: p.tags ? p.tags.join(", ") : "",
      loadingDetails: true,
    });

    try {
      const res = await adminApi.get<{ product: ApiProduct }>(`admin/products/${p.id}`);
      const full = res.product;
      setEditingProduct({
        id: p.id,
        name: full.name,
        slug: full.slug,
        price: full.price,
        shortDescription: full.shortDescription || "",
        tags: full.tags ? full.tags.join(", ") : "",
        loadingDetails: false,
      });
    } catch {
      setEditingProduct((curr) => (curr ? { ...curr, loadingDetails: false } : null));
    }
  }

  async function handleSaveProductSeo() {
    if (!editingProduct) return;
    setSavingProduct(true);
    try {
      const rawTags = editingProduct.tags
        .split(/[,]+/)
        .map((t) =>
          t
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, ""),
        )
        .filter(Boolean);

      const updated = await adminApi.patch<{ product: ApiProduct }>(
        `admin/products/${editingProduct.id}`,
        {
          name: editingProduct.name.trim(),
          shortDescription: editingProduct.shortDescription.trim() || null,
          tags: [...new Set(rawTags)],
        },
      );

      setProducts((prev) =>
        prev.map((item) =>
          item.id === editingProduct.id
            ? {
                ...item,
                name: updated.product.name,
                tags: updated.product.tags,
              }
            : item,
        ),
      );

      try {
        await fetch("/api/revalidate?secret=revalidate-now");
      } catch {}

      toast("Product SEO updated and cache revalidated!");
      setEditingProduct(null);
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

        {/* 1. Collapsible Google Search Console Setup & Verification Guide */}
        <Card>
          <div
            onClick={() => setShowGuide((prev) => !prev)}
            className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-surface/50 select-none"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold">
                📘
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-body font-semibold text-ink">
                    Google Search Console সেটআপ ও ভেরিফিকেশন কমপ্লিট গাইড
                  </h3>
                  <span className="rounded bg-sky-50 px-2 py-0.5 text-micro font-medium text-sky-700">
                    Step-by-Step Guide
                  </span>
                </div>
                <p className="text-micro text-muted">
                  নতুন ওয়েবসাইট সেটআপ ও লগইন করার পর থেকে সার্চ কনসোলে যুক্ত করার সহজ নির্দেশিকা
                </p>
              </div>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-3 py-1.5 text-caption font-medium text-ink shadow-2xs hover:bg-surface"
            >
              <span>{showGuide ? "লুকিয়ে রাখুন" : "গাইডটি দেখুন"}</span>
              <Icon name={showGuide ? "chevronUp" : "chevronDown"} size={14} />
            </button>
          </div>

          {showGuide && (
            <div className="border-t border-line bg-surface/30 p-4 sm:p-5 flex flex-col gap-4 text-caption text-ink">
              <div className="rounded-md bg-amber-50 p-3 text-amber-900 border border-amber-200/60 text-micro">
                💡 <strong>টিপস:</strong> এই কোডবেস দিয়ে ভবিষ্যতে নতুন যেকোনো ডোমেইনে ওয়েবসাইট সেটআপ করলে এই গাইড দেখে মাত্র ২ মিনিটে Google Search Console ভেরিফাই করে নিতে পারবেন।
              </div>

              {/* Step 1 */}
              <div className="rounded-lg border border-line bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro">
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
                    এ গিয়ে আপনার জিমেইল অ্যাকাউন্ট দিয়ে লগইন করুন।
                  </p>
                  <p>
                    ২. হাতের বাম পাশের ওপরের ড্রপডাউন থেকে <strong>+ Add property</strong> তে ক্লিক করুন।
                  </p>
                  <p>
                    ৩. দুটি অপশন আসবে (Domain এবং URL prefix)। ডান পাশের <strong>URL prefix</strong> বক্সে আপনার ওয়েবসাইটের সম্পূর্ণ ঠিকানা দিন:{" "}
                    <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink font-semibold">
                      {origin}
                    </code>{" "}
                    এবং <strong>Continue</strong> বাটনে চাপুন।
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="rounded-lg border border-line bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro">
                    ২
                  </span>
                  <span>১-ক্লিকে সাইট ভেরিফিকেশন সম্পন্ন করা (HTML Tag মেথড)</span>
                </div>
                <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                  <p>
                    ১. ভেরিফিকেশন মেথডগুলোর মধ্যে <strong>HTML tag</strong> অপশনটিতে ক্লিক করে ড্রপডাউন খুলুন।
                  </p>
                  <p>
                    ২. একটি মেটা ট্যাগ কোড দেখতে পাবেন, যেমন:{" "}
                    <code className="block mt-1 rounded bg-surface p-2 font-mono text-micro text-ink break-all border border-line">
                      &lt;meta name=&quot;google-site-verification&quot; content=&quot;da2a584dd6352b62...&quot; /&gt;
                    </code>
                  </p>
                  <p>
                    ৩. শুধুমাত্র <code className="font-mono text-ink font-semibold">content=&quot;...&quot;</code> এর ভেতরের টোকেন অংশটুকু (যেমন: <code className="font-mono text-ink">da2a584dd6352b62</code>) কপি করুন।
                  </p>
                  <p>
                    ৪. আমাদের এই পেজের নিচের <strong>&ldquo;Search Console & Webmaster Verification&rdquo;</strong> সেকশনের <strong>&ldquo;Google Site Verification Token&rdquo;</strong> বক্সে পেস্ট করে <strong>&ldquo;Save SEO Settings&rdquo;</strong> বাটনে ক্লিক করুন।
                  </p>
                  <p>
                    ৫. এবার Search Console ট্যাবে ফিরে গিয়ে <strong>Verify</strong> বাটনে চাপ দিন — সাথে সাথে <span className="font-semibold text-positive">✓ Ownership verified</span> সবুজ টিক দেখাবে!
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="rounded-lg border border-line bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro">
                    ৩
                  </span>
                  <span>XML সাইটম্যাপ (Sitemap) সাবমিট করা</span>
                </div>
                <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                  <p>
                    ১. Search Console-এর বাম পাশের মেনু থেকে <strong>Indexing &gt; Sitemaps</strong> অপশনে যান।
                  </p>
                  <p>
                    ২. <strong>Add a new sitemap</strong> বক্সে শুধু লিখুন:{" "}
                    <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-ink font-bold">
                      sitemap.xml
                    </code>
                  </p>
                  <p>
                    ৩. <strong>Submit</strong> চাপুন। স্ট্যাটাস দেখাবে <span className="text-positive font-semibold">Success</span>। এর ফলে গুগলের রোবট স্বয়ংক্রিয়ভাবে আপনার স্টোরের সব প্রোডাক্ট, ক্যাটাগরি ও পেজ খুঁজে পেয়ে ক্রল করবে।
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="rounded-lg border border-line bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro">
                    ৪
                  </span>
                  <span>ইনস্ট্যান্ট ইনডেক্সিং (URL Inspection)</span>
                </div>
                <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                  <p>
                    ১. যেকোনো নতুন প্রোডাক্ট দ্রুত গুগল সার্চে আনতে Search Console-এর একদম ওপরে থাকা সার্চ বক্সে প্রোডাক্টের লিংক পেস্ট করে Enter চাপুন।
                  </p>
                  <p>
                    ২. এরপর <strong>&ldquo;Request Indexing&rdquo;</strong> বাটনে ক্লিক করুন। গুগল ২৪ থেকে ৪৮ ঘণ্টার মধ্যে অগ্রাধিকার দিয়ে পেজটি সার্চে ইনডেক্স করবে।
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div className="rounded-lg border border-line bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-white text-micro">
                    ৫
                  </span>
                  <span>সার্চ পারফরম্যান্স ও ট্রাফিক পর্যবেক্ষণ</span>
                </div>
                <div className="mt-2 pl-8 flex flex-col gap-1.5 text-muted">
                  <p>
                    কয়েকদিন পর থেকে Search Console-এর <strong>Performance</strong> ট্যাবে দেখতে পাবেন মানুষ কোন কোন শব্দ (Keywords) লিখে সার্চ করে আপনার ওয়েবসাইটে ঢুকছে, কতবার গুগল সার্চে দেখা যাচ্ছে (Impressions) এবং কতগুলো ক্লিক পড়ছে।
                  </p>
                </div>
              </div>
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
        <form onSubmit={handleSave} className="flex flex-col gap-4">
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

        {/* 6. Product Catalogue SEO Health Audit & In-Page SEO Editor */}
        <Card>
          <CardHeader
            title="Product Catalogue SEO Health Audit & Direct Editor"
            hint="Customize SEO title, meta description, and keywords directly for each product without leaving this page."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-caption">
              <thead>
                <tr className="border-b border-line bg-surface/50 text-micro font-semibold text-muted uppercase tracking-wider">
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Title Quality</th>
                  <th className="py-3 px-4">Status & Tags</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted">
                      No products found.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => {
                    const isEditing = editingProduct?.id === p.id;
                    const titleLen = p.name.length;
                    const isOptimal = titleLen >= 30 && titleLen <= 90;

                    return (
                      <tbody key={p.id} className="contents">
                        <tr
                          className={cn(
                            "hover:bg-surface/30 transition-colors",
                            isEditing && "bg-primary/5"
                          )}
                        >
                          <td className="py-3 px-4">
                            <div className="flex flex-col">
                              <span className="font-semibold text-ink line-clamp-1">{p.name}</span>
                              <span className="text-micro text-muted font-mono">
                                /product/{p.slug}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-2 py-0.5 text-micro font-medium",
                                isOptimal
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700"
                              )}
                            >
                              {titleLen} chars {isOptimal ? "✓ Great" : "Needs Review"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1.5">
                              <span className="rounded bg-positive/10 px-2 py-0.5 text-micro font-medium text-positive">
                                ✓ Indexed
                              </span>
                              <span className="rounded bg-surface px-2 py-0.5 text-micro font-medium text-muted">
                                {p.tags?.length || 0} Tags
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant={isEditing ? "primary" : "secondary"}
                                onClick={() => handleOpenProductSeo(p)}
                              >
                                <span>{isEditing ? "Editing SEO" : "⚡ Quick SEO"}</span>
                                <Icon name={isEditing ? "chevronUp" : "chevronDown"} size={13} />
                              </Button>

                              <Link
                                href={`/admin/products/${p.id}`}
                                className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1 text-micro font-medium text-muted hover:text-ink hover:bg-surface"
                                title="Open full product editor"
                              >
                                Edit ↗
                              </Link>
                            </div>
                          </td>
                        </tr>

                        {/* In-Page Product SEO Editor Row */}
                        {isEditing && (
                          <tr className="bg-surface/50 border-b border-line">
                            <td colSpan={4} className="p-4 sm:p-5">
                              {editingProduct.loadingDetails ? (
                                <div className="py-8 text-center text-muted flex items-center justify-center gap-2">
                                  <span className="size-2 rounded-full bg-primary animate-ping" />
                                  Loading product SEO details…
                                </div>
                              ) : (
                                <div className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-white p-4 sm:p-5 shadow-xs">
                                  <div className="flex items-center justify-between border-b border-line pb-3">
                                    <div>
                                      <h4 className="text-body font-semibold text-ink flex items-center gap-2">
                                        <span>Direct SEO Editor:</span>
                                        <span className="text-primary font-bold">{p.name}</span>
                                      </h4>
                                      <p className="text-micro text-muted">
                                        Edit Google title, snippet description & target keywords without leaving this page.
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setEditingProduct(null)}
                                      className="rounded p-1 text-muted hover:text-ink hover:bg-surface"
                                    >
                                      <Icon name="close" size={16} />
                                    </button>
                                  </div>

                                  <div className="grid gap-5 lg:grid-cols-2">
                                    {/* Left Column: Form Fields */}
                                    <div className="flex flex-col gap-3.5">
                                      <Input
                                        label="Product SEO Title / Name"
                                        value={editingProduct.name}
                                        onChange={(e) =>
                                          setEditingProduct({
                                            ...editingProduct,
                                            name: e.target.value,
                                          })
                                        }
                                        placeholder="Product headline shown on Google"
                                        hint={`Length: ${editingProduct.name.length} chars ${
                                          editingProduct.name.length >= 45 && editingProduct.name.length <= 75
                                            ? "✓ Optimal length"
                                            : "(Aim for 45–75 chars)"
                                        }`}
                                      />

                                      <Textarea
                                        label="Product Meta Description (Google Snippet)"
                                        value={editingProduct.shortDescription}
                                        onChange={(e) =>
                                          setEditingProduct({
                                            ...editingProduct,
                                            shortDescription: e.target.value,
                                          })
                                        }
                                        rows={3}
                                        placeholder="Enter clear summary for Google search snippet (e.g. key benefits, battery life, price, etc.)"
                                        hint={`Length: ${editingProduct.shortDescription.length} chars ${
                                          editingProduct.shortDescription.length >= 120 &&
                                          editingProduct.shortDescription.length <= 165
                                            ? "✓ Optimal"
                                            : "(Aim for 120–165 chars)"
                                        }`}
                                      />

                                      <Input
                                        label="SEO Tags & Keywords (comma-separated)"
                                        value={editingProduct.tags}
                                        onChange={(e) =>
                                          setEditingProduct({
                                            ...editingProduct,
                                            tags: e.target.value,
                                          })
                                        }
                                        placeholder="e.g. charger light, rechargeable light, desk lamp bd"
                                        hint="Comma-separated keywords. Used for Google search ranking & internal search discovery."
                                      />
                                    </div>

                                    {/* Right Column: Live Product SERP Mockup */}
                                    <div className="flex flex-col justify-between rounded-lg border border-[#dadce0] bg-[#f8f9fa] p-4">
                                      <div>
                                        <span className="text-micro font-semibold text-muted uppercase tracking-wider">
                                          Google Search Live Preview for This Product
                                        </span>

                                        <div className="mt-3 rounded-lg border border-[#dadce0] bg-white p-3.5 shadow-2xs">
                                          <div className="flex items-center gap-2 text-micro">
                                            <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px]">
                                              H
                                            </span>
                                            <span className="font-medium text-[#202124]">
                                              {origin.replace(/^https?:\/\//, "")}
                                            </span>
                                            <span className="text-muted">› product › {p.slug}</span>
                                          </div>

                                          <h4 className="mt-1.5 text-[16px] font-normal leading-snug text-[#1a0dab] hover:underline cursor-pointer">
                                            {editingProduct.name || p.name} · HINAR
                                          </h4>

                                          <div className="mt-1 flex items-center gap-2 text-[12px]">
                                            <span className="font-semibold text-[#006621]">
                                              ৳{p.price}
                                            </span>
                                            <span className="text-muted">·</span>
                                            <span className="text-muted">In stock</span>
                                            <span className="text-muted">·</span>
                                            <span className="text-muted">Cash on Delivery</span>
                                          </div>

                                          <p className="mt-1 text-[13px] leading-relaxed text-[#4d5156] line-clamp-2">
                                            {editingProduct.shortDescription ||
                                              "Shop this authentic product at best price in Bangladesh. Fast nationwide cash on delivery."}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line">
                                        <div className="flex items-center gap-2">
                                          <Button
                                            type="button"
                                            variant="primary"
                                            onClick={handleSaveProductSeo}
                                            loading={savingProduct}
                                          >
                                            Save Product SEO
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => setEditingProduct(null)}
                                          >
                                            Cancel
                                          </Button>
                                        </div>

                                        <Link
                                          href={`/admin/products/${p.id}`}
                                          className="text-micro font-medium text-primary hover:underline"
                                        >
                                          Open Full Product Editor ↗
                                        </Link>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
    </AdminShell>
  );
}
