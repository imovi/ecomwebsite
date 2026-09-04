"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { cn, slugify } from "@/lib/utils";
import { toast } from "@/lib/stores/toast-store";
import type { ApiCategory, ApiProduct } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { ProductImages } from "./ProductImages";
import { ProductInteractive } from "./ProductInteractive";
import { ProductImageStaging, type StagedImage } from "./ProductImageStaging";
import { ProductVariants } from "./ProductVariants";
import {
  buildVariantPayload,
  EMPTY_VARIANT_DRAFT,
  ProductVariantStaging,
  type VariantDraft,
} from "./ProductVariantStaging";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { parseVideoUrl, type ParsedVideoInfo } from "@/lib/video-embed";

/**
 * Product create / edit.
 *
 * One form for both, because the fields are identical and the alternative is
 * two files that drift. The difference is entirely in what is possible: images
 * and variants need a product row to attach to, so on create they are hidden
 * and the form redirects to the edit view on success, where they appear.
 *
 * Prices are whole taka. The API rejects a decimal outright rather than
 * truncating it, so the inputs step by 1 and never by 0.01.
 */

/* `id` is presentation-only: it gives each row a React key that survives
   reordering, so removing a row cannot carry focus or in-progress IME
   composition into the next one. It is stripped before the payload is sent. */
interface SpecRow {
  id: string;
  label: string;
  value: string;
}

let specRowSeq = 0;
const nextSpecRowId = () => `spec-${(specRowSeq += 1)}`;

/* The origin never changes for the life of the page, so there is nothing to
   subscribe to. Both live at module scope because `useSyncExternalStore`
   re-subscribes whenever the callback identity changes. */
const subscribeToNothing = () => () => {};
const readOrigin = () => window.location.origin;

function ProductVideoAdminPreview({
  url,
  onRemove,
}: {
  url: string;
  onRemove: () => void;
}) {
  const [video, setVideo] = useState<ParsedVideoInfo | null>(() => parseVideoUrl(url));

  useEffect(() => {
    const basic = parseVideoUrl(url);
    setVideo(basic);
    if (basic && basic.type === "instagram") {
      fetch(`/api/video/resolve?url=${encodeURIComponent(url)}`)
        .then((r) => r.json())
        .then((res) => {
          if (res.success && res.data) {
            setVideo(res.data);
          }
        })
        .catch(() => {});
    }
  }, [url]);

  if (!video) {
    return (
      <div className="rounded-md border border-line bg-surface/50 p-3 text-caption text-muted">
        Please enter a valid video link (e.g. YouTube, Facebook Reel, TikTok, Instagram, or .mp4 URL).
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-3 rounded-lg border border-line bg-surface/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-caption">
          <span className="font-semibold text-ink">{video.platformName}</span>
          <span className="rounded bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">
            {video.isVertical ? "📱 Vertical Reel (9:16)" : "🖥️ Landscape Video (16:9)"}
          </span>
          {video.type === "direct" && (
            <span className="rounded bg-positive/10 px-2 py-0.5 text-micro font-semibold text-positive">
              ✓ Clean Video
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-micro font-medium text-sale hover:underline"
        >
          Remove Video
        </button>
      </div>

      <div className="flex justify-center">
        {video.type === "direct" && video.isVertical ? (
          <div className="relative w-full max-w-[220px] overflow-hidden rounded-xl bg-black border-2 border-line aspect-[9/16]">
            <video
              src={video.embedUrl}
              controls
              playsInline
              loop
              className="absolute inset-0 size-full object-cover"
            />
          </div>
        ) : video.type === "direct" ? (
          <div className="relative w-full max-w-md overflow-hidden rounded-lg bg-black">
            <video
              src={video.embedUrl}
              controls
              playsInline
              loop
              className="max-h-64 w-full object-contain"
            />
          </div>
        ) : video.isVertical ? (
          <div className="relative w-full max-w-[240px] overflow-hidden rounded-xl bg-black border-2 border-line aspect-[9/16]">
            <iframe
              src={video.embedUrl}
              title="Product Video Preview"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
            />
          </div>
        ) : (
          <div className="relative w-full max-w-md overflow-hidden rounded-lg bg-black aspect-video">
            <iframe
              src={video.embedUrl}
              title="Product Video Preview"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 size-full border-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface FormState {
  name: string;
  slug: string;
  sku: string;
  brand: string;
  categoryId: string;
  shortDescription: string;
  description: string;
  warranty: string;
  tags: string;
  whatsIncluded: string;
  price: string;
  oldPrice: string;
  costPrice: string;
  courierCostInsideDhaka: string;
  courierCostOutsideDhaka: string;
  packagingCost: string;
  stockQuantity: string;
  lowStockThreshold: string;
  status: "draft" | "active" | "archived";
  isVisible: boolean;
  videoUrl: string;
  specifications: SpecRow[];
}

const EMPTY: FormState = {
  name: "",
  slug: "",
  sku: "",
  brand: "",
  categoryId: "",
  shortDescription: "",
  description: "",
  warranty: "",
  tags: "",
  whatsIncluded: "",
  price: "",
  oldPrice: "",
  costPrice: "",
  courierCostInsideDhaka: "",
  courierCostOutsideDhaka: "",
  packagingCost: "",
  stockQuantity: "0",
  lowStockThreshold: "5",
  status: "draft",
  isVisible: true,
  videoUrl: "",
  specifications: [],
};

/**
 * An optional money field as text.
 *
 * Blank for both null and undefined, which are the same thing to a form: "not
 * set". Keeping them distinct here would put the string "null" in an input.
 */
function optionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function fromProduct(product: ApiProduct): FormState {
  return {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    brand: product.brand ?? "",
    categoryId: product.category?.id ?? "",
    shortDescription: product.shortDescription ?? "",
    description: product.description ?? "",
    videoUrl: product.videoUrl ?? "",
    warranty: product.warranty ?? "",
    tags: product.tags.join(", "),
    whatsIncluded: product.whatsIncluded.join("\n"),
    price: String(product.price),
    oldPrice: product.oldPrice === null ? "" : String(product.oldPrice),
    costPrice:
      product.costPrice === null || product.costPrice === undefined
        ? ""
        : String(product.costPrice),
    courierCostInsideDhaka: optionalNumber(product.courierCostInsideDhaka),
    courierCostOutsideDhaka: optionalNumber(product.courierCostOutsideDhaka),
    packagingCost: optionalNumber(product.packagingCost),
    stockQuantity: String(product.stockQuantity),
    lowStockThreshold: String(product.lowStockThreshold),
    status: product.status ?? "draft",
    isVisible: product.isVisible ?? true,
    specifications: product.specifications.map((spec) => ({
      ...spec,
      id: nextSpecRowId(),
    })),
  };
}

/** Splits a comma or newline separated field into a clean list. */
function toList(value: string, separator: RegExp): string[] {
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ProductForm({ productId }: { productId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEdit = Boolean(productId);

  /* Set when creation succeeded but the photo upload that followed did not.
     Without it the admin lands on a saved product with no photos and no
     explanation, and reasonably assumes the whole save failed. */
  const photoUploadFailed = searchParams.get("photos") === "failed";

  const [form, setForm] = useState<FormState>(EMPTY);
  const [product, setProduct] = useState<ApiProduct | null>(null);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /* Create mode only: photos picked before the product row exists. */
  const [staged, setStaged] = useState<StagedImage[]>([]);
  /* Create mode only: variants declared before the product row exists. Unlike
     photos these need no second request — the create endpoint takes them
     inline and writes the whole set in one transaction. */
  const [variantDraft, setVariantDraft] = useState<VariantDraft>(EMPTY_VARIANT_DRAFT);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  /**
   * Whether the link has been written by hand.
   *
   * A saved product's link is always its own — nothing here rewrites it — so
   * this only decides whether a new product's link keeps following the name
   * being typed above it.
   */
  const [slugTouched, setSlugTouched] = useState(false);

  /**
   * Origin for the link preview.
   *
   * The panel and the shop are the same app on the same domain, so this is the
   * address a customer will really see — read from the browser rather than from
   * a build-time variable that would bake one deployment's domain into the
   * image. Blank on the server, so the markup matches on hydration and fills in
   * immediately after.
   */
  const origin = useSyncExternalStore(subscribeToNothing, readOrigin, () => "");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /* --- Load ------------------------------------------------------------- */

  const loadProduct = useCallback(async () => {
    if (!productId) return;
    try {
      const data = await adminApi.get<{ product: ApiProduct }>(`admin/products/${productId}`);
      setProduct(data.product);
      setForm(fromProduct(data.product));
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load the product.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useLoad(loadProduct);

  useEffect(() => {
    /* Admin listing so a draft category is still selectable. */
    void adminApi
      .get<{ categories: ApiCategory[] }>("admin/categories")
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]));
  }, []);

  /* --- Save ------------------------------------------------------------- */

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setUploadNote(null);

    /* Variants are checked before anything is sent. The API would catch all of
       this too, but it answers with `body.variants[2].sku`, and a banner naming
       a row the admin can count to is the difference between a fix and a
       guess. */
    const variantResult = isEdit ? null : buildVariantPayload(variantDraft);
    if (variantResult && "error" in variantResult) {
      setError(variantResult.error);
      setSaving(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    /* Empty strings are meaningful: the API treats `null` as "clear this
       field" and would reject `""` on a nullable text column with a min
       length. Numbers go through `Number()` because every input is a string. */
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      sku: form.sku.trim(),
      /* Blank means "no brand", sent as null so the API does not store an
         empty string that would show up as a nameless brand filter. */
      brand: form.brand.trim() || null,
      categoryId: form.categoryId,
      shortDescription: form.shortDescription.trim() || null,
      description: form.description.trim() || null,
      warranty: form.warranty.trim() || null,
      videoUrl: form.videoUrl.trim() || null,
      /* Drop the presentation-only row id — the API stores exactly what it is
         given, so an extra key here would end up persisted. */
      specifications: form.specifications
        .filter((spec) => spec.label && spec.value)
        .map(({ label, value }) => ({ label, value })),
      whatsIncluded: toList(form.whatsIncluded, /\n/),
      tags: toList(form.tags, /,/).map((tag) => slugify(tag)),
      price: Number(form.price),
      oldPrice: form.oldPrice.trim() === "" ? null : Number(form.oldPrice),
      /* Null, not 0, when left blank: "not recorded" and "free" are different
         facts, and the profit report treats them differently. */
      costPrice: form.costPrice.trim() === "" ? null : Number(form.costPrice),
      /* Same rule: blank is "use the shop default", not "ships free". */
      courierCostInsideDhaka:
        form.courierCostInsideDhaka.trim() === "" ? null : Number(form.courierCostInsideDhaka),
      courierCostOutsideDhaka:
        form.courierCostOutsideDhaka.trim() === "" ? null : Number(form.courierCostOutsideDhaka),
      packagingCost: form.packagingCost.trim() === "" ? null : Number(form.packagingCost),
      stockQuantity: Number(form.stockQuantity),
      lowStockThreshold: Number(form.lowStockThreshold),
      status: form.status,
      isVisible: form.isVisible,
    };

    try {
      if (isEdit) {
        const data = await adminApi.patch<{ product: ApiProduct }>(
          `admin/products/${productId}`,
          payload,
        );
        setProduct(data.product);
        setForm(fromProduct(data.product));
        toast("Product saved");
      } else {
        const data = await adminApi.post<{ product: ApiProduct }>("admin/products", {
          ...payload,
          /* Only on create: the update endpoint takes `variantOptions` but not
             `variants`, which are edited one at a time once the product
             exists. Sending an empty pair is harmless — both default to []. */
          ...(variantResult ? variantResult.payload : {}),
        });
        const newId = data.product.id;

        /* The product row now exists, so the staged photos finally have
           something to attach to. Uploaded before navigating so the edit view
           opens with them already in place. */
        if (staged.length > 0) {
          setUploadNote(
            staged.length === 1 ? "Uploading 1 photo…" : `Uploading ${staged.length} photos…`,
          );

          /* Not named `form` — that is the component's form state, and shadowing
             it here would be a trap for the next edit. */
          const upload = new FormData();
          for (const image of staged) upload.append("images", image.file);

          try {
            await adminApi.uploadWithProgress(
              `admin/products/${newId}/images`,
              upload,
              (percent) => {
                setUploadNote(
                  percent >= 100
                    ? "Processing media on server…"
                    : `Uploading media (${percent}%)…`,
                );
              },
            );
            toast("Product created with media");
          } catch (uploadFailure) {
            /* The product itself was created. Say so plainly and send the admin
               to it rather than reporting a failure that would suggest nothing
               was saved and invite a duplicate. */
            toast("Product created, but the photos failed to upload");
            router.push(
              `/admin/products/${newId}?photos=failed`,
            );
            console.error("Photo upload failed after product creation", uploadFailure);
            return;
          }
        } else {
          toast("Product created — now add photos");
        }

        /* Straight to the edit view: variants and further photos live there. */
        router.push(`/admin/products/${newId}`);
        return;
      }
    } catch (caught) {
      if (caught instanceof AdminApiError) {
        setError(caught.message);
        if (caught.fields) setFieldErrors(caught.fields);
      } else {
        setError("Could not save. Please try again.");
      }
      /* Scroll the banner into view — on a phone the submit button is far below
         the first invalid field. */
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  }

  /* --- Publish toggle --------------------------------------------------- */

  async function setStatus(status: "draft" | "active" | "archived") {
    if (!productId) return;
    try {
      const data = await adminApi.patch<{ product: ApiProduct }>(
        `admin/products/${productId}/status`,
        { status },
      );
      setProduct(data.product);
      setForm(fromProduct(data.product));
      toast(status === "active" ? "Product is live" : `Product moved to ${status}`);
    } catch (caught) {
      toast(caught instanceof AdminApiError ? caught.message : "Could not change status");
    }
  }

  if (loading) {
    return (
      <AdminShell title="Product">
        <p className="text-caption text-muted">Loading…</p>
      </AdminShell>
    );
  }

  const canPublish =
    isEdit && product !== null && product.images.length > 0 && form.status !== "active";

  /* Once a product is split into variants the single stock box stops meaning
     anything — the API derives the product's quantity from the sum of its
     variants and would overwrite whatever were typed here. */
  const stockIsPerVariant = isEdit
    ? product !== null && product.variants.length > 0
    : variantDraft.variants.length > 0;

  return (
    <AdminShell
      title={isEdit ? form.name || "Product" : "New product"}
      action={
        <div className="flex items-center gap-2">
          <Button href="/admin/products" variant="ghost" size="sm">
            Back
          </Button>
          {canPublish && (
            <Button variant="secondary" size="sm" onClick={() => void setStatus("active")}>
              Publish
            </Button>
          )}
          {isEdit && form.status === "active" && (
            <Button variant="soft" size="sm" onClick={() => void setStatus("draft")}>
              Unpublish
            </Button>
          )}
        </div>
      }
    >
      <PageBody columns={false}>
        <ErrorBanner message={error} />

        {isEdit && product && product.images.length === 0 && (
          <p className="flex items-start gap-2 rounded-sm bg-warn-soft px-3 py-2 text-caption text-warn">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            This product has no photos yet. It cannot be published until it has at least one.
          </p>
        )}

        {uploadNote && (
          <p role="status" className="rounded-sm bg-surface px-3 py-2 text-caption text-ink-soft">
            {uploadNote}
          </p>
        )}

        {photoUploadFailed && (
          <p className="flex items-start gap-2 rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            The product was saved, but its photos did not upload. Add them below — there is no
            need to create the product again.
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 2xl:grid 2xl:grid-cols-2 2xl:items-start"
        >
          <Card>
            <CardHeader title="Basics" />
            <div className="flex flex-col gap-4 p-4">
              <Input
                label="Product name"
                value={form.name}
                onChange={(event) => {
                  set("name", event.target.value);
                  /* The link follows the name until someone writes their own,
                     and never touches a saved product's link on its own — a
                     rename must not silently move a page people already have. */
                  if (!isEdit && !slugTouched) set("slug", slugify(event.target.value));
                }}
                error={fieldErrors.name}
                required
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Brand"
                  value={form.brand}
                  onChange={(event) => set("brand", event.target.value)}
                  hint="Optional — leave blank for unbranded or generic items."
                  error={fieldErrors.brand}
                />
                <Select
                  label="Category"
                  value={form.categoryId}
                  onChange={(event) => set("categoryId", event.target.value)}
                  error={fieldErrors.categoryId}
                  required
                >
                  <option value="">Select a category…</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </div>

              <Input
                label="SKU"
                value={form.sku}
                onChange={(event) => set("sku", event.target.value)}
                hint="Your own stock code. Must be unique."
                error={fieldErrors.sku}
                required
              />

              {/* Its own row rather than sharing one with the SKU: a link built
                  from a long product name does not fit in half a line, and this
                  field is only useful if you can read what it will produce. */}
              <div>
                <Input
                  label="Product link"
                  value={form.slug}
                  onChange={(event) => {
                    /* Typed by hand from here on. Without this the name field
                       would keep overwriting a shortened link on the next
                       keystroke, which looked like the edit had not saved. */
                    setSlugTouched(true);
                    set("slug", slugify(event.target.value));
                  }}
                  hint={
                    isEdit
                      ? "Anyone who already has the old link will get a “page not found”, so change it before you advertise the product rather than after."
                      : "Made from the name. Shorten it if you like — a long name makes a long link."
                  }
                  error={fieldErrors.slug}
                />

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="break-all text-micro text-muted">
                    {origin}/product/
                    <span className="font-medium text-ink">
                      {form.slug || slugify(form.name) || "…"}
                    </span>
                  </p>

                  {/* Only offered when it would actually change something —
                      a button that does nothing is a button you learn to
                      distrust. */}
                  {form.name.trim() !== "" && form.slug !== slugify(form.name) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSlugTouched(false);
                        set("slug", slugify(form.name));
                      }}
                      className="text-micro font-medium text-ink underline underline-offset-2"
                    >
                      Use the product name
                    </button>
                  )}
                </div>
              </div>

              <Input
                label="Short description"
                value={form.shortDescription}
                onChange={(event) => set("shortDescription", event.target.value)}
                hint="One line shown under the product name."
                maxLength={300}
                error={fieldErrors.shortDescription}
              />
            </div>
          </Card>

          {/* Photos come second, while creating — right after the name, because a
              product with no photo will not sell and the admin should not have to
              save and find a separate screen to add one. In edit mode the real
              image manager sits below the form instead, since it acts on images
              that already exist on the server. */}
          {!isEdit && (
            <ProductImageStaging images={staged} onChange={setStaged} disabled={saving} />
          )}

          <Card>
            <CardHeader title="Price and stock" hint="Whole taka only." />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Input
                label="Price (৳)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.price}
                onChange={(event) => set("price", event.target.value)}
                error={fieldErrors.price}
                required
              />
              <Input
                label="Old price (৳)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.oldPrice}
                onChange={(event) => set("oldPrice", event.target.value)}
                hint="Leave empty for no discount. Must exceed the price."
                error={fieldErrors.oldPrice}
              />
              <Input
                label="Buying price (৳)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.costPrice}
                onChange={(event) => set("costPrice", event.target.value)}
                hint="What you pay for one. Never shown to customers — it is what makes the profit page work."
                error={fieldErrors.costPrice}
              />
              <Input
                label="Courier cost, inside Dhaka (৳)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.courierCostInsideDhaka}
                onChange={(event) => set("courierCostInsideDhaka", event.target.value)}
                hint="Only if this item costs more to ship than usual. Blank uses the shop figure from Settings."
                error={fieldErrors.courierCostInsideDhaka}
              />
              <Input
                label="Courier cost, outside Dhaka (৳)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.courierCostOutsideDhaka}
                onChange={(event) => set("courierCostOutsideDhaka", event.target.value)}
                hint="Blank uses the shop figure."
                error={fieldErrors.courierCostOutsideDhaka}
              />
              <Input
                label="Packaging cost (৳)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.packagingCost}
                onChange={(event) => set("packagingCost", event.target.value)}
                hint="A bigger box for a bigger item. Blank uses the shop figure."
                error={fieldErrors.packagingCost}
              />
              <Input
                label="Stock quantity"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.stockQuantity}
                onChange={(event) => set("stockQuantity", event.target.value)}
                disabled={stockIsPerVariant}
                hint={
                  stockIsPerVariant
                    ? "Counted from the variants below — each one holds its own stock."
                    : undefined
                }
                error={fieldErrors.stockQuantity}
              />
              <Input
                label="Low stock warning at"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.lowStockThreshold}
                onChange={(event) => set("lowStockThreshold", event.target.value)}
                error={fieldErrors.lowStockThreshold}
              />
            </div>
          </Card>

          {/* Variants sit against creation too, not only against a saved
              product: an admin adding a t-shirt in five sizes should not have to
              save, find the edit screen and start again. Once the product
              exists the server-backed editor below takes over. */}
          {!isEdit && (
            <ProductVariantStaging
              draft={variantDraft}
              onChange={setVariantDraft}
              productSku={form.sku}
              productPrice={form.price}
              disabled={saving}
            />
          )}

          <Card>
            <CardHeader title="Details" />
            <div className="flex flex-col gap-4 p-4">
              <Textarea
                label="Full description"
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                rows={6}
                error={fieldErrors.description}
              />

              <SpecEditor
                specs={form.specifications}
                onChange={(specs) => set("specifications", specs)}
              />

              <Textarea
                label="What's in the box"
                value={form.whatsIncluded}
                onChange={(event) => set("whatsIncluded", event.target.value)}
                hint="One item per line."
                rows={3}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Warranty"
                  value={form.warranty}
                  onChange={(event) => set("warranty", event.target.value)}
                  placeholder="1 year official warranty"
                  error={fieldErrors.warranty}
                />
                <Input
                  label="Tags"
                  value={form.tags}
                  onChange={(event) => set("tags", event.target.value)}
                  hint="Comma separated. Used for search and related products."
                  error={fieldErrors.tags}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Product Video & Reel"
              hint="Attach a YouTube video, YouTube Shorts, Facebook Reel/Video, TikTok, Instagram Reel, or direct MP4 link to show a video showcase on the product page."
            />
            <div className="flex flex-col gap-4 p-4">
              <Input
                label="Video or Reel URL"
                value={form.videoUrl}
                onChange={(event) => set("videoUrl", event.target.value)}
                placeholder="e.g. https://www.youtube.com/shorts/... or https://www.facebook.com/reel/..."
                hint="Supports YouTube (standard & Shorts), Facebook (Reels & Videos), Instagram Reels, TikTok, and direct .mp4 video files."
                error={fieldErrors.videoUrl}
              />

              {form.videoUrl.trim() && (() => {
                const currentVolMatch = form.videoUrl.match(/vol=(\d+)/);
                const currentVol = currentVolMatch ? parseInt(currentVolMatch[1], 10) : 100;

                const setVolume = (newVol: number) => {
                  const baseUrl = form.videoUrl.replace(/[#&]vol=\d+/g, "").trim();
                  const sep = baseUrl.includes("#") ? "&" : "#";
                  set("videoUrl", newVol === 100 ? baseUrl : `${baseUrl}${sep}vol=${newVol}`);
                };

                return (
                  <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
                    <div className="flex items-center justify-between text-caption">
                      <span className="font-medium text-ink flex items-center gap-1.5">
                        {currentVol === 0 ? "🔇" : "🔊"} Default Video Volume
                      </span>
                      <span className={cn("text-micro font-bold", currentVol === 0 ? "text-red-600" : "text-emerald-600")}>
                        {currentVol === 0 ? "Muted (0%)" : `${currentVol}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={currentVol}
                      onChange={(e) => setVolume(parseInt(e.target.value, 10))}
                      className="h-2 w-full accent-ink cursor-pointer"
                    />
                    <div className="flex items-center gap-1.5 pt-1">
                      {[0, 30, 50, 80, 100].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setVolume(preset)}
                          className={cn(
                            "flex-1 rounded-xs border py-1 text-micro font-medium transition-colors text-center",
                            currentVol === preset
                              ? "border-ink bg-ink text-white"
                              : "border-line bg-surface text-muted hover:text-ink hover:bg-line/40",
                          )}
                        >
                          {preset === 0 ? "Mute" : `${preset}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {form.videoUrl.trim() && (
                <ProductVideoAdminPreview
                  url={form.videoUrl.trim()}
                  onRemove={() => set("videoUrl", "")}
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Visibility" />
            <div className="flex flex-col gap-4 p-4">
              <Select
                label="Status"
                value={form.status}
                onChange={(event) => set("status", event.target.value as FormState["status"])}
                hint="Only live products appear on the storefront."
              >
                <option value="draft">Draft — not on the storefront</option>
                <option value="active">Live</option>
                <option value="archived">Archived</option>
              </Select>

              <label className="flex items-center gap-2.5 text-caption text-ink">
                <input
                  type="checkbox"
                  checked={form.isVisible}
                  onChange={(event) => set("isVisible", event.target.checked)}
                  className="size-4 accent-[var(--color-ink)]"
                />
                Show in category listings and search
              </label>
            </div>
          </Card>

          {/* Sticky so saving never requires scrolling to the bottom of a long
              form on a phone. */}
          <div className="sticky bottom-20 z-10 flex gap-2 rounded-md border border-line bg-white/95 p-3 shadow-card backdrop-blur-md lg:bottom-4 2xl:col-span-2">
            <Button type="submit" variant="primary" size="lg" loading={saving} fullWidth>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create product"}
            </Button>
          </div>
        </form>

        {/* Images and variants attach to an existing row, so they only appear
            once the product has been created. */}
        {isEdit && product && (
          <>
            <ProductImages
              productId={product.id}
              images={product.images}
              onChange={() => void loadProduct()}
            />
            {/* After the gallery, because it operates on what the gallery
                holds — and a photo has to exist before it can have an off
                version. */}
            <ProductInteractive product={product} onChange={() => void loadProduct()} />
            <ProductVariants product={product} onChange={() => void loadProduct()} />
          </>
        )}
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Specifications                                                             */
/* -------------------------------------------------------------------------- */

function SpecEditor({
  specs,
  onChange,
}: {
  specs: SpecRow[];
  onChange: (specs: SpecRow[]) => void;
}) {
  const update = (id: string, patch: Partial<SpecRow>) =>
    onChange(specs.map((spec) => (spec.id === id ? { ...spec, ...patch } : spec)));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption font-medium text-ink-soft">Specifications</p>

      {specs.map((spec, index) => (
        <div key={spec.id} className="flex items-center gap-2">
          <input
            value={spec.label}
            onChange={(event) => update(spec.id, { label: event.target.value })}
            placeholder="Display"
            aria-label={`Specification ${index + 1} label`}
            className="h-11 w-2/5 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          <input
            value={spec.value}
            onChange={(event) => update(spec.id, { value: event.target.value })}
            placeholder="6.7 inch AMOLED"
            aria-label={`Specification ${index + 1} value`}
            className="h-11 flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={() => onChange(specs.filter((row) => row.id !== spec.id))}
            aria-label={`Remove specification ${index + 1}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-sale-soft hover:text-sale"
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}

      <Button
        type="button"
        variant="soft"
        size="sm"
        onClick={() => onChange([...specs, { id: nextSpecRowId(), label: "", value: "" }])}
        className="self-start"
      >
        <Icon name="plus" size={15} />
        Add specification
      </Button>
    </div>
  );
}
