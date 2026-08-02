"use client";

import { useCallback, useRef, useState } from "react";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { toast } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import type { ApiBanner, ApiStoreSettings } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Logo and homepage banners.
 *
 * Both used to require a code change: the logo was a hardcoded wordmark and the
 * banners were committed SVGs. Together they are the two things a shop owner
 * most wants to change on day one and cannot ask a developer for every time.
 *
 * Kept on one screen because they are one job — "make the shop look like mine" —
 * and splitting them would mean two places to check when the homepage looks
 * wrong.
 */
export function BrandingForm() {
  const [settings, setSettings] = useState<ApiStoreSettings | null>(null);
  const [banners, setBanners] = useState<ApiBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settingsData, bannerData] = await Promise.all([
        adminApi.get<{ settings: ApiStoreSettings }>("admin/settings"),
        adminApi.get<{ banners: ApiBanner[] }>("admin/banners"),
      ]);
      setSettings(settingsData.settings);
      setBanners(bannerData.banners);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.status === 403
            ? "Only an owner account can change branding."
            : caught.message
          : "Could not load branding.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(load);

  const run = useCallback(
    async (action: () => Promise<unknown>, message: string): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      try {
        await action();
        toast(message);
        await load();
        return true;
      } catch (caught) {
        setActionError(
          caught instanceof AdminApiError
            ? caught.status === 403
              ? "Only an owner account can change branding."
              : caught.message
            : "Could not save.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  function moveBanner(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= banners.length) return;

    const reordered = [...banners];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);

    void run(
      () =>
        adminApi.patch("admin/banners/reorder", {
          order: reordered.map((banner, position) => ({
            id: banner.id,
            sortOrder: position,
          })),
        }),
      "Order updated",
    );
  }

  return (
    <AdminShell title="Branding">
      <PageBody>
        <AsyncState
          loading={loading}
          error={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          {settings && (
            <>
              <ErrorBanner message={actionError} className="2xl:col-span-2" />

              <LogoCard
                logoUrl={settings.store.logoUrl}
                logoWidth={settings.store.logoWidth}
                logoHeight={settings.store.logoHeight}
                shopName={settings.store.name}
                busy={busy}
                onUpload={(file) => {
                  const form = new FormData();
                  form.append("logo", file);
                  return run(
                    () => adminApi.upload("admin/settings/logo", form),
                    "Logo updated",
                  );
                }}
                onRemove={() =>
                  run(() => adminApi.delete("admin/settings/logo"), "Logo removed")
                }
              />

              <FaviconCard
                faviconUrl={settings.store.faviconUrl}
                busy={busy}
                onUpload={(file) => {
                  const form = new FormData();
                  form.append("favicon", file);
                  return run(
                    () => adminApi.upload("admin/settings/favicon", form),
                    "Tab icon updated",
                  );
                }}
                onRemove={() =>
                  run(() => adminApi.delete("admin/settings/favicon"), "Tab icon removed")
                }
              />

              <BannerSection
                banners={banners}
                busy={busy}
                onMove={moveBanner}
                onReload={load}
                onError={setActionError}
                setBusy={setBusy}
              />
            </>
          )}
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tells the operator what to upload.
 *
 * Written out rather than left implicit because "what size should this be?" is
 * the first question anyone has, and guessing wrong used to mean a cropped
 * banner with no explanation. The storefront now fits whatever is given, so this
 * is guidance for the best result, not a rule.
 */
function SizeGuide({
  recommended,
  lines,
}: {
  recommended: string;
  lines: string[];
}) {
  return (
    <div className="rounded-sm bg-surface px-3 py-2.5">
      <p className="text-caption font-medium text-ink">
        Best size: <span className="tnum">{recommended}</span>
      </p>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
        {lines.map((line) => (
          <li key={line} className="text-micro text-muted">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Logo                                                                       */
/* -------------------------------------------------------------------------- */

function LogoCard({
  logoUrl,
  logoWidth,
  logoHeight,
  shopName,
  busy,
  onUpload,
  onRemove,
}: {
  logoUrl: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  shopName: string;
  busy: boolean;
  onUpload: (file: File) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader
        title="Shop logo"
        hint="Shown at the top of every page, on the left."
      />
      <div className="flex flex-col gap-4 p-4">
        {/* Previewed on the same near-white the header uses, so a logo with a
            white background does not look fine here and wrong on the shop. */}
        <div className="flex items-center gap-4 rounded-sm border border-line bg-white p-4">
          {logoUrl ? (
            /* Height-constrained exactly like the real header, so what the owner
               sees here is what customers get. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={shopName}
              className="h-9 w-auto max-w-[160px] object-contain object-left"
            />
          ) : (
            /* Shows what the shop ACTUALLY shows with no logo, which is
               nothing. Previewing the shop name here would promise a wordmark
               the storefront no longer renders. */
            <span className="text-caption italic text-muted">Nothing shown</span>
          )}

          <span className="text-micro text-muted">
            {logoUrl
              ? logoWidth && logoHeight
                ? `Current logo · ${logoWidth}×${logoHeight}px`
                : "Current logo"
              : "No logo — the header's left corner is left empty"}
          </span>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUpload(file);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="camera" size={15} />
            {logoUrl ? "Replace logo" : "Upload logo"}
          </Button>

          {logoUrl && (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() => {
                if (!window.confirm("Remove the logo? The header will show nothing there."))
                  return;
                void onRemove();
              }}
            >
              Remove
            </Button>
          )}
        </div>

        <SizeGuide
          recommended="400 × 100 px"
          lines={[
            "A wide, landscape shape works best — it sits in a 40px-tall bar.",
            "PNG with a transparent background looks cleanest on white.",
            "Any size is accepted from 48px up; it is scaled to fit automatically without cropping.",
          ]}
        />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Favicon                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The browser-tab icon.
 *
 * Its own card rather than a second button on the logo card, because it is a
 * different picture: a wordmark shrunk to 32px is an unreadable smudge, and
 * 32px in a crowded row of tabs is the only size this one is ever seen at.
 */
function FaviconCard({
  faviconUrl,
  busy,
  onUpload,
  onRemove,
}: {
  faviconUrl: string | null;
  busy: boolean;
  onUpload: (file: File) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader
        title="Browser tab icon"
        hint="The little square next to your shop's name in a browser tab and in bookmarks."
      />
      <div className="flex flex-col gap-4 p-4">
        {/* Previewed at the two sizes browsers actually use, so an icon that
            looks fine large but turns to mush small is obvious here rather
            than after it is live. */}
        <div className="flex items-center gap-4 rounded-sm border border-line bg-white p-4">
          {faviconUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={faviconUrl} alt="" className="size-8 rounded-xs object-contain" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={faviconUrl} alt="" className="size-4 rounded-xs object-contain" />
              <span className="text-micro text-muted">Shown at 32px and 16px</span>
            </>
          ) : (
            <span className="text-micro text-muted">
              No icon yet — browsers show the default one.
            </span>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onUpload(file);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="camera" size={15} />
            {faviconUrl ? "Replace icon" : "Upload icon"}
          </Button>

          {faviconUrl && (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={() => {
                if (!window.confirm("Remove the tab icon? The default one comes back.")) return;
                void onRemove();
              }}
            >
              Remove
            </Button>
          )}
        </div>

        <SizeGuide
          recommended="512 × 512 px"
          lines={[
            "Square. A rectangle is padded to a square by the browser, which leaves it looking small and off-centre.",
            "512px is uploaded once and scaled down to every size a browser asks for — 16px in the tab, 32px in bookmarks, up to 192px on an Android home screen.",
            "Use your mark or a single letter, not the full wordmark. At 16px a line of text is an unreadable smudge.",
            "Accepted from 16px up, but small originals look blurry on a high-resolution screen — give it 512 if you have it.",
            "PNG with a transparent background works in both light and dark browser themes.",
          ]}
        />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Banners                                                                    */
/* -------------------------------------------------------------------------- */

function BannerSection({
  banners,
  busy,
  onMove,
  onReload,
  onError,
  setBusy,
}: {
  banners: ApiBanner[];
  busy: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onReload: () => Promise<void>;
  onError: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);

  async function submit(form: FormData, id?: string): Promise<boolean> {
    setBusy(true);
    onError(null);
    try {
      if (id) {
        await adminApi.upload(`admin/banners/${id}`, form, "PATCH");
        toast("Banner updated");
      } else {
        await adminApi.upload("admin/banners", form);
        toast("Banner added");
      }
      await onReload();
      return true;
    } catch (caught) {
      onError(caught instanceof AdminApiError ? caught.message : "Could not save the banner.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(banner: ApiBanner) {
    if (!window.confirm("Delete this banner?")) return;
    setBusy(true);
    onError(null);
    try {
      await adminApi.delete(`admin/banners/${banner.id}`);
      toast("Banner deleted");
      await onReload();
    } catch (caught) {
      onError(caught instanceof AdminApiError ? caught.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Homepage banners"
        hint="The sliding pictures at the top of the homepage. Shown in this order — use the arrows to rearrange."
      />
      <div className="flex flex-col gap-4 p-4">
        <SizeGuide
          recommended="1600 × 640 px (wide) · 800 × 800 px (phone)"
          lines={[
            "The slider takes the shape of your FIRST banner, so give them all the same proportions for a clean result.",
            "Whole picture is always shown — nothing is cropped, so keep any text well inside the edges.",
            "Any size from 400px up is accepted and scaled automatically.",
          ]}
        />
        {banners.length === 0 ? (
          <p className="rounded-sm bg-surface px-3 py-6 text-center text-caption text-muted">
            No banners yet. The homepage simply starts with the categories until you add one.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {banners.map((banner, index) => (
              <BannerRow
                key={banner.id}
                banner={banner}
                index={index}
                total={banners.length}
                busy={busy}
                onMove={onMove}
                onSave={(form) => submit(form, banner.id)}
                onDelete={() => remove(banner)}
              />
            ))}
          </ul>
        )}

        {adding ? (
          <BannerEditor
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={async (form) => {
              if (await submit(form)) setAdding(false);
            }}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={15} />
            Add banner
          </Button>
        )}
      </div>
    </Card>
  );
}

function BannerRow({
  banner,
  index,
  total,
  busy,
  onMove,
  onSave,
  onDelete,
}: {
  banner: ApiBanner;
  index: number;
  total: number;
  busy: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onSave: (form: FormData) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <BannerEditor
          banner={banner}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={async (form) => {
            if (await onSave(form)) setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 rounded-sm border border-line p-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={banner.imageUrl}
        alt=""
        className="h-12 w-24 shrink-0 rounded-xs bg-surface object-cover"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-caption text-ink">
          {banner.alt || <span className="text-muted">No description</span>}
        </p>
        <p className="truncate text-micro text-muted">
          → {banner.href}
          {banner.imageWidth > 0 && ` · ${banner.imageWidth}×${banner.imageHeight}px`}
          {!banner.isActive && " · hidden"}
          {!banner.imageMobileUrl && " · no phone crop"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => onMove(index, -1)}
          disabled={index === 0 || busy}
          aria-label="Move banner up"
          className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(index, 1)}
          disabled={index === total - 1 || busy}
          aria-label="Move banner down"
          className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
        >
          ↓
        </button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete banner"
          className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale"
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    </li>
  );
}

function BannerEditor({
  banner,
  busy,
  onCancel,
  onSubmit,
}: {
  banner?: ApiBanner;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (form: FormData) => Promise<void>;
}) {
  const wideRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);

  const [alt, setAlt] = useState(banner?.alt ?? "");
  const [href, setHref] = useState(banner?.href ?? "/category/all");
  const [isActive, setIsActive] = useState(banner?.isActive ?? true);
  const [wide, setWide] = useState<File | null>(null);
  const [mobile, setMobile] = useState<File | null>(null);

  const isEdit = Boolean(banner);
  /* A new banner cannot exist without artwork; an edit already has some. */
  const canSubmit = isEdit || wide !== null;

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-ink/20 bg-surface p-3">
      <p className="text-caption font-semibold text-ink">
        {isEdit ? "Edit banner" : "New banner"}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <FilePick
          label="Wide picture"
          hint="Tablets and computers. Best 1600×640 px."
          inputRef={wideRef}
          file={wide}
          existingUrl={banner?.imageUrl ?? null}
          onPick={setWide}
          required={!isEdit}
        />
        <FilePick
          label="Phone picture"
          hint="Optional, for phones. Best 800×800 px. Without it phones use the wide one."
          inputRef={mobileRef}
          file={mobile}
          existingUrl={banner?.imageMobileUrl ?? null}
          onPick={setMobile}
        />
      </div>

      <Input
        label="Where it links to"
        value={href}
        onChange={(event) => setHref(event.target.value)}
        hint="A path on your shop, like /category/audio. Not a full web address."
      />

      <Input
        label="Description"
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        hint="Read aloud by screen readers and shown if the picture fails to load."
      />

      <label className="flex items-center gap-2.5 text-caption text-ink">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
          className="size-4 accent-[var(--color-ink)]"
        />
        Show on the homepage
      </label>

      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!canSubmit}
          onClick={() => {
            const form = new FormData();
            if (wide) form.append("image", wide);
            if (mobile) form.append("imageMobile", mobile);
            form.append("alt", alt.trim());
            form.append("href", href.trim() || "/");
            form.append("isActive", String(isActive));
            void onSubmit(form);
          }}
        >
          {isEdit ? "Save banner" : "Add banner"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function FilePick({
  label,
  hint,
  inputRef,
  file,
  existingUrl,
  onPick,
  required,
}: {
  label: string;
  hint: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  file: File | null;
  existingUrl: string | null;
  onPick: (file: File | null) => void;
  required?: boolean;
}) {
  /* Object URLs are created on pick and revoked when replaced, rather than
     derived in an effect — an allocation is not derived state. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const shown = previewUrl ?? existingUrl;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-caption font-medium text-ink-soft">
        {label}
        {required && <span className="text-sale"> *</span>}
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex aspect-[5/2] w-full items-center justify-center overflow-hidden rounded-sm border border-dashed bg-white transition-colors",
          shown ? "border-line" : "border-line hover:border-ink/30",
        )}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-muted">
            <Icon name="camera" size={20} />
            <span className="text-micro">Choose a picture</span>
          </span>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0] ?? null;
          setPreviewUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return picked ? URL.createObjectURL(picked) : null;
          });
          onPick(picked);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <p className="text-micro text-muted">{file ? file.name : hint}</p>
    </div>
  );
}
