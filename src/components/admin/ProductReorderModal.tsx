"use client";

import { useEffect, useState, useTransition } from "react";
import Image from "next/image";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka } from "@/lib/utils";
import type { ApiProductListItem } from "@/lib/api/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

interface ProductReorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ProductReorderModal({ isOpen, onClose, onSaved }: ProductReorderModalProps) {
  const [items, setItems] = useState<ApiProductListItem[]>([]);
  const [initialOrder, setInitialOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    async function loadProducts() {
      setLoading(true);
      setError(null);
      try {
        /* Fetch all active and draft products up to 200 */
        const { items: fetched } = await adminApi.list<ApiProductListItem>(
          "admin/products?perPage=200",
        );
        if (!mounted) return;
        setItems(fetched);
        setInitialOrder(fetched.map((p) => p.id));
      } catch (caught) {
        if (!mounted) return;
        setError(caught instanceof AdminApiError ? caught.message : "Failed to load products.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadProducts();
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isDirty =
    items.length === initialOrder.length &&
    items.some((item, idx) => item.id !== initialOrder[idx]);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);

    startTransition(() => {
      setItems(reordered);
    });
  }

  function moveToTop(index: number) {
    if (index === 0) return;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.unshift(moved);

    startTransition(() => {
      setItems(reordered);
    });
  }

  async function handleSave() {
    if (items.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.patch("admin/products/reorder", {
        order: items.map((product, index) => ({
          id: product.id,
          sortOrder: index,
        })),
      });

      toast("New Arrivals sequence saved! / পণ্যের ক্রম সফলভাবে সাজানো হয়েছে");
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Failed to save sequence.");
    } finally {
      setSaving(false);
    }
  }

  const filteredItems = search
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.sku.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-lg border border-line bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 bg-surface">
          <div>
            <h2 className="text-body font-semibold text-ink flex items-center gap-2">
              <Icon name="list" size={18} />
              Arrange Product Order / পণ্যের ক্রম সাজান
            </h2>
            <p className="mt-0.5 text-micro text-muted">
              Top products appear first in New Arrivals on the storefront.
              (উপরে থাকা পণ্যগুলো সবার আগে নতুন কালেকশনে শো করবে)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xs p-1.5 text-muted hover:bg-line/60 hover:text-ink disabled:opacity-50"
            aria-label="Close modal"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Search bar */}
        <div className="border-b border-line px-5 py-2.5 bg-white flex items-center gap-3">
          <Icon name="search" size={16} className="text-muted shrink-0" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products by name or SKU..."
            className="w-full text-caption text-ink outline-none placeholder:text-muted"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-micro text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>

        {/* Body list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 divide-y divide-line/40">
          {error && (
            <div className="rounded-xs bg-sale/10 p-3 text-caption text-sale">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted">
              <Icon name="spinner" size={28} className="animate-spin text-ink" />
              <p className="mt-2 text-caption">Loading products...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="py-12 text-center text-caption text-muted">
              No products found.
            </p>
          ) : (
            filteredItems.map((product) => {
              const actualIndex = items.findIndex((p) => p.id === product.id);
              const isFirst = actualIndex === 0;
              const isLast = actualIndex === items.length - 1;

              return (
                <div
                  key={product.id}
                  className="flex items-center gap-3 pt-2 first:pt-0 group hover:bg-surface/50 rounded-xs p-1.5 transition-colors"
                >
                  {/* Position number */}
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-caption font-bold text-ink ring-1 ring-line">
                    {actualIndex + 1}
                  </span>

                  {/* Thumbnail */}
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xs border border-line bg-surface">
                    {product.featuredImage ? (
                      <Image
                        src={product.featuredImage.url}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <Icon
                        name="package"
                        size={20}
                        className="absolute inset-0 m-auto text-muted"
                      />
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption font-medium text-ink">
                      {product.name}
                    </p>
                    <div className="flex items-center gap-2 text-micro text-muted">
                      <span>{product.sku}</span>
                      <span>·</span>
                      <span className="font-semibold text-ink">
                        {formatTaka(product.price)}
                      </span>
                      <Badge
                        tone={
                          product.status === "active"
                            ? product.isVisible
                              ? "positive"
                              : "warn"
                            : "neutral"
                        }
                      >
                        {product.status ?? "draft"}
                      </Badge>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveToTop(actualIndex)}
                      disabled={isFirst || saving}
                      title="Move to Top (সবার উপরে নিন)"
                      className="rounded-xs border border-line bg-white px-2 py-1 text-micro font-medium text-ink hover:bg-surface disabled:opacity-30 disabled:pointer-events-none"
                    >
                      Top
                    </button>
                    <button
                      type="button"
                      onClick={() => move(actualIndex, -1)}
                      disabled={isFirst || saving}
                      title="Move Up (উপরে নিন)"
                      className="flex size-8 items-center justify-center rounded-xs border border-line bg-white text-ink hover:bg-surface disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <Icon name="arrowUp" size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(actualIndex, 1)}
                      disabled={isLast || saving}
                      title="Move Down (নিচে নিন)"
                      className="flex size-8 items-center justify-center rounded-xs border border-line bg-white text-ink hover:bg-surface disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <Icon name="arrowDown" size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3 bg-surface">
          <span className="text-caption text-muted">
            {isDirty ? (
              <span className="text-sale font-medium">Unsaved changes / পরিবর্তন করা হয়েছে</span>
            ) : (
              <span>{items.length} products in sequence</span>
            )}
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving || !isDirty}
            >
              {saving ? (
                <>
                  <Icon name="spinner" size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Icon name="check" size={14} />
                  Save Sequence
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
