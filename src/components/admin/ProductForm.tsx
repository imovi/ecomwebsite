"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { slugify } from "@/lib/utils";
import { toast } from "@/lib/stores/toast-store";
import type { ApiCategory, ApiProduct } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { ProductImages } from "./ProductImages";
import { ProductImageStaging, type StagedImage } from "./ProductImageStaging";
import { ProductVariants } from "./ProductVariants";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

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

interface SpecRow {
  label: string;
  value: string;
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
  stockQuantity: string;
  lowStockThreshold: string;
  status: "draft" | "active" | "archived";
  isVisible: boolean;
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
  stockQuantity: "0",
  lowStockThreshold: "5",
  status: "draft",
  isVisible: true,
  specifications: [],
};

function fromProduct(product: ApiProduct): FormState {
  return {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    brand: product.brand ?? "",
    categoryId: product.category?.id ?? "",
    shortDescription: product.shortDescription ?? "",
    description: product.description ?? "",
    warranty: product.warranty ?? "",
    tags: product.tags.join(", "),
    whatsIncluded: product.whatsIncluded.join("\n"),
    price: String(product.price),
    oldPrice: product.oldPrice === null ? "" : String(product.oldPrice),
    costPrice:
      product.costPrice === null || product.costPrice === undefined
        ? ""
        : String(product.costPrice),
    stockQuantity: String(product.stockQuantity),
    lowStockThreshold: String(product.lowStockThreshold),
    status: product.status ?? "draft",
    isVisible: product.isVisible ?? true,
    specifications: product.specifications,
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
  const [uploadNote, setUploadNote] = useState<string | null>(null);

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
      specifications: form.specifications.filter((spec) => spec.label && spec.value),
      whatsIncluded: toList(form.whatsIncluded, /\n/),
      tags: toList(form.tags, /,/).map((tag) => slugify(tag)),
      price: Number(form.price),
      oldPrice: form.oldPrice.trim() === "" ? null : Number(form.oldPrice),
      /* Null, not 0, when left blank: "not recorded" and "free" are different
         facts, and the profit report treats them differently. */
      costPrice: form.costPrice.trim() === "" ? null : Number(form.costPrice),
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
        const data = await adminApi.post<{ product: ApiProduct }>("admin/products", payload);
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
            await adminApi.upload(`admin/products/${newId}/images`, upload);
            toast("Product created with photos");
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
                  /* Auto-slug while creating; never touch an existing slug,
                     since changing it breaks live links and ad destinations. */
                  if (!isEdit) set("slug", slugify(event.target.value));
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

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="SKU"
                  value={form.sku}
                  onChange={(event) => set("sku", event.target.value)}
                  hint="Your own stock code. Must be unique."
                  error={fieldErrors.sku}
                  required
                />
                <Input
                  label="URL slug"
                  value={form.slug}
                  onChange={(event) => set("slug", slugify(event.target.value))}
                  hint={isEdit ? "Changing this breaks existing links." : "Filled from the name."}
                  error={fieldErrors.slug}
                />
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
                label="Stock quantity"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.stockQuantity}
                onChange={(event) => set("stockQuantity", event.target.value)}
                hint={
                  product && product.variants.length > 0
                    ? "Ignored while this product has variants — each variant holds its own stock."
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
  const update = (index: number, patch: Partial<SpecRow>) =>
    onChange(specs.map((spec, i) => (i === index ? { ...spec, ...patch } : spec)));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption font-medium text-ink-soft">Specifications</p>

      {specs.map((spec, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            value={spec.label}
            onChange={(event) => update(index, { label: event.target.value })}
            placeholder="Display"
            aria-label={`Specification ${index + 1} label`}
            className="h-11 w-2/5 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          <input
            value={spec.value}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder="6.7 inch AMOLED"
            aria-label={`Specification ${index + 1} value`}
            className="h-11 flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={() => onChange(specs.filter((_, i) => i !== index))}
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
        onClick={() => onChange([...specs, { label: "", value: "" }])}
        className="self-start"
      >
        <Icon name="plus" size={15} />
        Add specification
      </Button>
    </div>
  );
}
