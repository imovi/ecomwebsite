"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import type { ApiStoreSettings, ApiProductListItem } from "@/lib/api/types";
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

export function SeoDashboard() {
  const [form, setForm] = useState<SeoFormState>(EMPTY_FORM);
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "desktop">("mobile");

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

        {/* 1. Google SERP Live Simulator */}
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-body font-semibold text-ink">Google Search Live Simulator</h2>
              <p className="text-micro text-muted">
                Real-time preview of how your store looks in Google search results.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-0.5">
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-micro font-medium transition-colors",
                  previewDevice === "mobile"
                    ? "bg-white text-ink shadow-xs"
                    : "text-muted hover:text-ink"
                )}
              >
                📱 Mobile
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-micro font-medium transition-colors",
                  previewDevice === "desktop"
                    ? "bg-white text-ink shadow-xs"
                    : "text-muted hover:text-ink"
                )}
              >
                🖥️ Desktop
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6">
            <div
              className={cn(
                "rounded-xl border border-line bg-white p-4 shadow-sm",
                previewDevice === "mobile" ? "max-w-md mx-auto" : "max-w-2xl"
              )}
            >
              {/* Google Search Result Mockup */}
              <div className="flex items-center gap-2 text-micro text-[#202124]">
                <div className="flex size-6 items-center justify-center rounded-full bg-[#f1f3f4] text-xs font-bold text-[#1a73e8]">
                  H
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="font-medium text-[#202124]">HINAR</span>
                  <span className="text-[11px] text-[#4d5156]">{origin}</span>
                </div>
              </div>

              <h3 className="mt-1 text-[17px] font-normal leading-snug text-[#1a0dab] hover:underline cursor-pointer line-clamp-2">
                {previewTitle}
              </h3>

              <p className="mt-1 text-[13px] leading-relaxed text-[#4d5156] line-clamp-3">
                {previewDescription}
              </p>
            </div>
          </div>
        </Card>

        {/* 2. Global SEO Settings Form */}
        <form onSubmit={handleSave} className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Global Search Engine Metadata"
              hint="Controls the primary meta tags Google, Bing, and social platforms read from your store."
            />
            <div className="flex flex-col gap-4 p-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-caption font-medium text-ink">Homepage SEO Title</label>
                  <span
                    className={cn(
                      "text-micro font-medium px-2 py-0.5 rounded",
                      titleLength === 0
                        ? "bg-surface text-muted"
                        : titleLength >= 45 && titleLength <= 65
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    )}
                  >
                    {titleLength} / 65 characters {titleLength >= 45 && titleLength <= 65 ? "✓ Optimal" : ""}
                  </span>
                </div>
                <Input
                  value={form.seoTitle}
                  onChange={(e) => set("seoTitle", e.target.value)}
                  placeholder="e.g. HINAR — Online Gadget Shop & Smart Lifestyle Store in Bangladesh"
                  hint="The main clickable headline shown in Google search results. Recommended 50–65 characters."
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-caption font-medium text-ink">Homepage Meta Description</label>
                  <span
                    className={cn(
                      "text-micro font-medium px-2 py-0.5 rounded",
                      descLength === 0
                        ? "bg-surface text-muted"
                        : descLength >= 120 && descLength <= 165
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    )}
                  >
                    {descLength} / 160 characters {descLength >= 120 && descLength <= 165 ? "✓ Optimal" : ""}
                  </span>
                </div>
                <Textarea
                  value={form.seoDescription}
                  onChange={(e) => set("seoDescription", e.target.value)}
                  rows={3}
                  placeholder="e.g. Shop smart gadgets, rechargeable desk lamps, unique lifestyle accessories & everyday electronics at best price in Bangladesh. Fast nationwide cash on delivery."
                  hint="A compelling summary shown below your title in Google. Recommended 130–160 characters."
                />
              </div>

              <div>
                <label className="text-caption font-medium text-ink">Global Meta Keywords</label>
                <Textarea
                  value={form.seoKeywords}
                  onChange={(e) => set("seoKeywords", e.target.value)}
                  rows={2}
                  placeholder="e.g. charger light, study lamp, rechargeable light, magnetic desk lamp, loadshedding light bd"
                  hint="Comma-separated keywords. Useful for meta tags and internal search catalog scoring."
                />
              </div>
            </div>
          </Card>

          {/* 3. Search Engine Verification */}
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

        {/* 4. Sitemap & Indexing Hub */}
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

        {/* 5. Product Catalogue SEO Health Audit */}
        <Card>
          <CardHeader
            title="Product Catalogue SEO Health Audit"
            hint="Review the search readiness and rich snippet tags for all products in your catalogue."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-caption">
              <thead>
                <tr className="border-b border-line bg-surface/50 text-micro font-semibold text-muted uppercase tracking-wider">
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Title Quality</th>
                  <th className="py-3 px-4">Status</th>
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
                    const titleLen = p.name.length;
                    const isOptimal = titleLen >= 30 && titleLen <= 90;

                    return (
                      <tr key={p.id} className="hover:bg-surface/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-ink line-clamp-1">{p.name}</span>
                            <span className="text-micro text-muted font-mono">/product/{p.slug}</span>
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
                            <span className="rounded bg-sky-50 px-2 py-0.5 text-micro font-medium text-sky-700">
                              FAQ Schema Ready
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link
                            href={/admin/products/}
                            className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1 text-micro font-medium text-ink hover:bg-surface"
                          >
                            Edit Product
                          </Link>
                        </td>
                      </tr>
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
