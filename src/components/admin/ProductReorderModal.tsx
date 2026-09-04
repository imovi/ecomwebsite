"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { adminApi, AdminApiError } from "@/lib/admin/client";
import { toast } from "@/lib/stores/toast-store";
import { formatTaka, cn } from "@/lib/utils";
import type { ApiProductListItem } from "@/lib/api/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

interface ProductReorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialProducts?: ApiProductListItem[];
}

export function ProductReorderModal({
  isOpen,
  onClose,
  onSaved,
  initialProducts,
}: ProductReorderModalProps) {
  const [items, setItems] = useState<ApiProductListItem[]>([]);
  const [initialOrder, setInitialOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  /* Drag and drop state (mouse + touch) */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const touchOriginIndex = useRef<number | null>(null);
  const touchCurrentOverIndex = useRef<number | null>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (initialProducts && initialProducts.length > 0) {
      setItems(initialProducts);
      setInitialOrder(initialProducts.map((p) => p.id));
    }

    let mounted = true;
    async function loadProducts() {
      if (!initialProducts || initialProducts.length === 0) {
        setLoading(true);
      }
      setError(null);
      try {
        const { items: fetched } = await adminApi.list<ApiProductListItem>(
          "admin/products?perPage=100",
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
  }, [isOpen, initialProducts]);

  if (!isOpen) return null;

  const isDirty =
    items.length === initialOrder.length &&
    items.some((item, idx) => item.id !== initialOrder[idx]);

  function reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return;

    const updated = [...items];
    const [moved] = updated.splice(fromIndex, 1);
    if (!moved) return;
    updated.splice(toIndex, 0, moved);

    startTransition(() => {
      setItems(updated);
    });
  }

  function move(index: number, direction: -1 | 1) {
    reorder(index, index + direction);
  }

  function moveToTop(index: number) {
    reorder(index, 0);
  }

  /* --- Mouse HTML5 Drag and Drop ------------------------------------------ */

  function handleDragStart(e: React.DragEvent, index: number) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    setDragIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIndex !== index) {
      setOverIndex(index);
    }
  }

  function handleDrop(e: React.DragEvent, targetIndex: number) {
    e.preventDefault();
    const sourceStr = e.dataTransfer.getData("text/plain");
    const sourceIndex = sourceStr ? parseInt(sourceStr, 10) : dragIndex;
    if (sourceIndex !== null && !isNaN(sourceIndex)) {
      reorder(sourceIndex, targetIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  /* --- Touch Drag and Drop (Finger / Mobile) ------------------------------- */

  function handleTouchStart(e: React.TouchEvent, index: number) {
    touchOriginIndex.current = index;
    touchCurrentOverIndex.current = index;
    setDragIndex(index);
    setOverIndex(index);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (touchOriginIndex.current === null) return;
    const touch = e.touches[0];
    if (!touch) return;

    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    const row = elem?.closest("[data-reorder-index]");
    if (row) {
      const idxAttr = row.getAttribute("data-reorder-index");
      if (idxAttr !== null) {
        const targetIdx = parseInt(idxAttr, 10);
        if (!isNaN(targetIdx) && targetIdx !== touchCurrentOverIndex.current) {
          touchCurrentOverIndex.current = targetIdx;
          setOverIndex(targetIdx);
        }
      }
    }
  }

  function handleTouchEnd() {
    const from = touchOriginIndex.current;
    const to = touchCurrentOverIndex.current;
    if (from !== null && to !== null && from !== to) {
      reorder(from, to);
    }
    touchOriginIndex.current = null;
    touchCurrentOverIndex.current = null;
    setDragIndex(null);
    setOverIndex(null);
  }

  /* --- Save to backend --------------------------------------------------- */

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

      toast("Product display order saved successfully.");
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Failed to save product sequence.");
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
              Arrange Product Display Order
            </h2>
            <p className="mt-0.5 text-micro text-muted">
              Drag and drop items or use arrow controls. Top products appear first in New Arrivals on the storefront.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xs p-1.5 text-muted hover:bg-line/60 hover:text-ink disabled:opacity-50"
            aria-label="Close dialog"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Search filter */}
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
        <div
          ref={listContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-2 select-none"
        >
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
              {search ? "No products match your search." : "No products available."}
            </p>
          ) : (
            filteredItems.map((product) => {
              const actualIndex = items.findIndex((p) => p.id === product.id);
              const isFirst = actualIndex === 0;
              const isLast = actualIndex === items.length - 1;
              const isDragging = dragIndex === actualIndex;
              const isOver = overIndex === actualIndex && dragIndex !== actualIndex;

              return (
                <div
                  key={product.id}
                  data-reorder-index={actualIndex}
                  draggable={!saving && !search}
                  onDragStart={(e) => handleDragStart(e, actualIndex)}
                  onDragOver={(e) => handleDragOver(e, actualIndex)}
                  onDrop={(e) => handleDrop(e, actualIndex)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "flex items-center gap-3 rounded-md border p-2 transition-[border-color,background-color,transform,box-shadow] duration-150",
                    isDragging
                      ? "border-dashed border-ink/50 bg-surface/70 opacity-40 scale-[0.98]"
                      : isOver
                        ? "border-ink bg-surface shadow-md ring-2 ring-ink/20"
                        : "border-line bg-white hover:border-line hover:bg-surface/40",
                  )}
                >
                  {/* Drag Grip Handle (supports both mouse drag and touch drag) */}
                  <div
                    title="Drag to reorder"
                    onTouchStart={(e) => handleTouchStart(e, actualIndex)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    className="flex size-8 shrink-0 cursor-grab active:cursor-grabbing touch-none items-center justify-center rounded-xs text-muted hover:bg-line/60 hover:text-ink transition-colors"
                  >
                    <Icon name="grip" size={18} />
                  </div>

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

                  {/* Quick Arrow controls */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveToTop(actualIndex)}
                      disabled={isFirst || saving}
                      title="Move to top position"
                      className="rounded-xs border border-line bg-white px-2 py-1 text-micro font-medium text-ink hover:bg-surface disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      Top
                    </button>
                    <button
                      type="button"
                      onClick={() => move(actualIndex, -1)}
                      disabled={isFirst || saving}
                      title="Move up"
                      className="flex size-8 items-center justify-center rounded-xs border border-line bg-white text-ink hover:bg-surface disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      <Icon name="arrowUp" size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(actualIndex, 1)}
                      disabled={isLast || saving}
                      title="Move down"
                      className="flex size-8 items-center justify-center rounded-xs border border-line bg-white text-ink hover:bg-surface disabled:opacity-30 disabled:pointer-events-none transition-colors"
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
              <span className="text-sale font-medium">Unsaved changes</span>
            ) : (
              <span>{items.length} products in display order</span>
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
