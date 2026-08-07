"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { useLoad } from "@/lib/admin/use-load";
import { cn, slugify } from "@/lib/utils";
import { toast } from "@/lib/stores/toast-store";
import type { ApiCategory } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, Card, CardHeader, ErrorBanner, PageBody } from "./ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/**
 * Categories.
 *
 * The homepage rail renders these in `sortOrder`, so ordering is part of the
 * storefront design rather than an admin convenience — hence the move controls
 * rather than an alphabetical list.
 *
 * Deletion is refused by the API while a category still holds products, which
 * is the right default: the alternative is products that belong nowhere.
 */

/**
 * Icons the storefront rail can render, offered as a picker grid.
 *
 * All-lowercase on purpose: the API's icon field accepts `[a-z0-9-]` only, so the
 * camelCase entries in the Icon registry (`chevronLeft`) would be rejected on save
 * and are deliberately absent rather than offered and then refused.
 *
 * Grouped by department rather than alphabetically — someone naming a category
 * "Ceiling fans" scans for the electrical block, not for the letter F. The
 * groups are only an ordering; the grid wraps them into one continuous field.
 */
const ICONS = [
  /* Gadgets and computing */
  "mobile",
  "tablet",
  "laptop",
  "tv",
  "watch",
  "headphones",
  "earbuds",
  "speaker",
  "microphone",
  "camera",
  "drone",
  "gamepad",
  "keyboard",
  "mouse",
  "printer",
  "router",
  "pendrive",
  "power",

  /* Lighting and electrical */
  "bulb",
  "lamp",
  "torch",
  "fan",
  "plug",
  "socket",
  "switch",
  "cable",
  "bolt",

  /* Toys */
  "teddy",
  "blocks",
  "car",
  "robot",
  "ball",
  "rocket",

  /* Generic — for a department none of the above fits */
  "package",
  "grid",
  "cart",
  "truck",
  "shield",
  "cash",
  "phone",
  "location",
  "search",
  "refresh",
] as const;

export function CategoryManager() {
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ApiCategory | "new" | null>(null);

  /**
   * Loader.
   *
   * Deliberately does not flip `loading` on the way in. It is called both on
   * mount and after every mutation, and raising the skeleton on a refresh would
   * blank the list the operator was just looking at. The retry control sets the
   * flag itself, where a skeleton is what you want.
   */
  const load = useCallback(async () => {
    try {
      const data = await adminApi.get<{ categories: ApiCategory[] }>("admin/categories");
      setCategories(data.categories);

      /* Re-point the open editor at the row that was just re-read.
         `editing` holds the category object, not its id, so without this it
         keeps the copy it was opened with — and removing a picture would
         refresh the list underneath while the form above still showed the
         picture it had just deleted. */
      setEditing((current) =>
        current && current !== "new"
          ? (data.categories.find((row) => row.id === current.id) ?? current)
          : current,
      );

      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load categories.");
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
        setActionError(caught instanceof AdminApiError ? caught.message : "Could not save.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;

    const reordered = [...categories];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);

    void run(
      () =>
        adminApi.patch("admin/categories/reorder", {
          order: reordered.map((category, position) => ({
            id: category.id,
            sortOrder: position,
          })),
        }),
      "Order updated",
    );
  }

  return (
    <AdminShell
      title="Categories"
      action={
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          <Icon name="plus" size={16} />
          Add category
        </Button>
      }
    >
      <PageBody columns={false}>
        <ErrorBanner message={actionError} />

        {editing && (
          <CategoryForm
            category={editing === "new" ? null : editing}
            busy={busy}
            onClose={() => setEditing(null)}
            onSave={async (payload, id, stagedImage) => {
              if (id) {
                const ok = await run(
                  () => adminApi.patch(`admin/categories/${id}`, payload),
                  "Category saved",
                );
                if (ok) setEditing(null);
                return;
              }

              /* Create, then attach the staged artwork. Two calls because the
                 image endpoint needs a row to hang it on — the same shape as the
                 product create flow. */
              setBusy(true);
              setActionError(null);
              try {
                const created = await adminApi.post<{ category: ApiCategory }>(
                  "admin/categories",
                  payload,
                );

                if (stagedImage) {
                  const form = new FormData();
                  form.append("image", stagedImage);
                  try {
                    await adminApi.upload(
                      `admin/categories/${created.category.id}/image`,
                      form,
                    );
                    toast("Category created with its picture");
                  } catch {
                    /* The category itself exists. Say so precisely rather than
                       reporting a failure that invites a duplicate. */
                    setActionError(
                      "The category was created, but its picture failed to upload. Open it and try the picture again.",
                    );
                  }
                } else {
                  toast("Category created");
                }

                await load();
                setEditing(null);
              } catch (caught) {
                setActionError(
                  caught instanceof AdminApiError ? caught.message : "Could not save.",
                );
              } finally {
                setBusy(false);
              }
            }}
            onUploadImage={async (id, file) => {
              const form = new FormData();
              form.append("image", file);
              await run(
                () => adminApi.upload(`admin/categories/${id}/image`, form),
                "Picture uploaded",
              );
            }}
            onRemoveImage={async (id) => {
              await run(
                () => adminApi.delete(`admin/categories/${id}/image`),
                "Picture removed — the icon is used now",
              );
            }}
          />
        )}

        <AsyncState
          loading={loading}
          error={error}
          empty={categories.length === 0}
          emptyMessage="No categories yet. Products need one, so start here."
          onRetry={() => {
            setLoading(true);
            void load();
          }}
        >
          <ul className="flex flex-col gap-2">
            {categories.map((category, index) => (
              <li
                key={category.id}
                className="flex items-center gap-3 rounded-md border border-line bg-white p-3"
              >
                <span className="relative size-11 shrink-0 overflow-hidden rounded-full bg-surface">
                  {category.imageUrl ? (
                    <Image
                      src={category.imageUrl}
                      alt=""
                      fill
                      sizes="44px"
                      className="object-cover"
                    />
                  ) : (
                    <Icon
                      name={category.icon ?? "grid"}
                      size={19}
                      className="absolute inset-0 m-auto text-muted"
                    />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption font-medium text-ink">
                    {category.name}
                    {!category.isActive && (
                      <span className="ml-2 text-micro font-normal text-muted">hidden</span>
                    )}
                  </p>
                  <p className="truncate text-micro text-muted">
                    /{category.slug}
                    {category.productCount !== undefined &&
                      ` · ${category.productCount} product${category.productCount === 1 ? "" : "s"}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || busy}
                    aria-label={`Move ${category.name} up`}
                    className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === categories.length - 1 || busy}
                    aria-label={`Move ${category.name} down`}
                    className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-surface hover:text-ink disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(category)}>
                    Edit
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Delete "${category.name}"?`)) return;
                      void run(
                        () => adminApi.delete(`admin/categories/${category.id}`),
                        "Category deleted",
                      );
                    }}
                    aria-label={`Delete ${category.name}`}
                    className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-sale-soft hover:text-sale"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </AsyncState>
      </PageBody>
    </AdminShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Form                                                                       */
/* -------------------------------------------------------------------------- */

function CategoryForm({
  category,
  busy,
  onClose,
  onSave,
  onUploadImage,
  onRemoveImage,
}: {
  category: ApiCategory | null;
  busy: boolean;
  onClose: () => void;
  onSave: (
    payload: Record<string, unknown>,
    id?: string,
    stagedImage?: File,
  ) => Promise<void>;
  onUploadImage: (id: string, file: File) => Promise<void>;
  onRemoveImage: (id: string) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "grid");
  const [isActive, setIsActive] = useState(category?.isActive ?? true);

  /* Create mode: artwork is picked before the category row exists, held here and
     uploaded the moment it does — the same pattern as product photos. Without it,
     "add a category with its own icon" means two visits to two screens.

     The preview URL is created where the file is chosen rather than derived in an
     effect: an object URL is an allocation, not derived state, and minting it in
     an effect means an extra render plus a window where the preview is stale. */
  const [staged, setStaged] = useState<{ file: File; previewUrl: string } | null>(null);

  const stageFile = (file: File | null) => {
    setStaged((current) => {
      /* Release the previous allocation before replacing it. */
      if (current) URL.revokeObjectURL(current.previewUrl);
      return file ? { file, previewUrl: URL.createObjectURL(file) } : null;
    });
  };

  /* Cleanup only — no state updates, so no cascading render. Reads the latest
     value through a ref-like closure over `staged` on each commit. */
  useEffect(() => {
    return () => {
      if (staged) URL.revokeObjectURL(staged.previewUrl);
    };
  }, [staged]);

  const stagedImage = staged?.file ?? null;
  const currentImage = staged?.previewUrl ?? category?.imageUrl ?? null;

  return (
    <Card>
      <CardHeader
        title={category ? `Edit ${category.name}` : "New category"}
        hint="Whatever you set here is what shows in the row of circles on the homepage."
      />
      <div className="flex flex-col gap-5 p-4">
        <Input
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!category) setSlug(slugify(event.target.value));
          }}
          required
        />

        <Input
          label="URL slug"
          value={slug}
          onChange={(event) => setSlug(slugify(event.target.value))}
          hint={category ? "Changing this breaks existing links." : undefined}
        />

        {/* --- Artwork ------------------------------------------------------
            Offered before the icon list, and labelled as taking precedence: a
            real photo beats a line drawing on a storefront, and an uploaded
            picture silently overriding the icon you just chose would otherwise be
            baffling. */}
        <div className="flex flex-col gap-2">
          <p className="text-caption font-medium text-ink-soft">Your own picture</p>

          <div className="flex items-center gap-3">
            <span className="relative size-16 shrink-0 overflow-hidden rounded-full bg-surface ring-1 ring-line">
              {currentImage ? (
                /* A staged preview is a local blob URL — nothing for the image
                   optimiser to fetch, so a plain <img> is correct here. */
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentImage} alt="" className="size-full object-cover" />
              ) : (
                <Icon
                  name={icon}
                  size={24}
                  className="absolute inset-0 m-auto text-muted"
                />
              )}
            </span>

            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    if (category) {
                      /* Editing: the row exists, so upload straight away. */
                      void onUploadImage(category.id, file);
                    } else {
                      stageFile(file);
                    }
                  }
                  /* Clear the input so re-picking the same file fires change. */
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <Button
                type="button"
                variant="soft"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="camera" size={15} />
                {currentImage ? "Replace picture" : "Upload picture"}
              </Button>

              {/* Removable whether the picture is staged or already saved.
                  It used to be offered only for a staged one, which meant a
                  category that had ever been given a picture could never go
                  back to an icon: the picture always wins, so choosing an icon
                  and saving looked like the save had failed. */}
              {currentImage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  onClick={() => {
                    if (stagedImage) {
                      stageFile(null);
                      return;
                    }
                    if (!category) return;
                    void onRemoveImage(category.id);
                  }}
                >
                  <Icon name="trash" size={15} />
                  Remove picture
                </Button>
              )}
            </div>
          </div>

          <p className="text-micro text-muted">
            Optional. Square images work best — it is shown in a circle. When set, it
            is used instead of the icon below — remove it to go back to an icon.
          </p>
        </div>

        {/* --- Icon picker --------------------------------------------------
            A grid of rendered glyphs rather than a dropdown of names: nobody knows
            what "gamepad" looks like in this icon set until they see it. */}
        <div className="flex flex-col gap-2">
          <p className="text-caption font-medium text-ink-soft">
            Or pick an icon
            {currentImage && (
              <span className="ml-2 font-normal text-muted">
                — unused while a picture is set
              </span>
            )}
          </p>

          <div
            role="radiogroup"
            aria-label="Category icon"
            className={cn(
              "grid grid-cols-6 gap-2 sm:grid-cols-9",
              currentImage && "opacity-45",
            )}
          >
            {ICONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={icon === option}
                aria-label={option}
                title={option}
                onClick={() => setIcon(option)}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-sm border transition-colors",
                  icon === option
                    ? "border-ink bg-ink text-white"
                    : "border-line text-ink-soft hover:border-muted hover:bg-surface",
                )}
              >
                <Icon name={option} size={19} />
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-caption text-ink">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="size-4 accent-[var(--color-ink)]"
          />
          Show on the storefront
        </label>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={busy}
            disabled={name.trim() === ""}
            onClick={() =>
              void onSave(
                {
                  name: name.trim(),
                  slug: slug || slugify(name),
                  icon,
                  isActive,
                },
                category?.id,
                stagedImage ?? undefined,
              )
            }
          >
            {category ? "Save" : "Create"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
