"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { adminApi, AdminApiError, qs } from "@/lib/admin/client";
import { formatTaka } from "@/lib/utils";
import type { ApiProductListItem } from "@/lib/api/types";
import { AdminShell } from "./AdminShell";
import { AsyncState, TableWrap } from "./ui";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "active", label: "Live" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
] as const;

/**
 * Product list.
 *
 * The admin listing includes drafts and archived products, which the public
 * endpoint hides — so it uses `/admin/products` and not the storefront route.
 */
export function ProductList() {
  const [products, setProducts] = useState<ApiProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, pagination } = await adminApi.list<ApiProductListItem>(
        /* `q`, not `search` — the query schema is strict and rejects unknown
           keys with a 422. */
        `admin/products${qs({ status, q: search, perPage: 100 })}`,
      );
      setProducts(items);
      setTotal(pagination?.total ?? items.length);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    /* Debounced so typing in the search box does not fire a request per
       keystroke; the status tabs go through the same path and simply resolve
       on the first tick. */
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <AdminShell
      title="Products"
      action={
        <Button href="/admin/products/new" variant="primary" size="sm">
          <Icon name="plus" size={16} />
          Add product
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-sm bg-white p-1 ring-1 ring-line">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatus(tab.value)}
              className={
                status === tab.value
                  ? "rounded-xs bg-ink px-3 py-1.5 text-caption font-medium text-white"
                  : "rounded-xs px-3 py-1.5 text-caption text-ink-soft hover:bg-surface"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, SKU or brand"
          aria-label="Search products"
          className="h-10 min-w-[200px] flex-1 rounded-sm border border-line bg-white px-3 text-caption text-ink outline-none placeholder:text-muted focus:border-ink"
        />

        <span className="tnum text-caption text-muted">{total} total</span>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={products.length === 0}
        emptyMessage={
          search || status
            ? "No products match this filter."
            : "No products yet. Add your first one to start selling."
        }
        onRetry={() => void load()}
      >
        <TableWrap>
          <div className="overflow-hidden rounded-md border border-line bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface text-micro uppercase tracking-wide text-muted">
                  <th className="px-3 py-2.5 font-medium">Product</th>
                  <th className="px-3 py-2.5 font-medium">Price</th>
                  <th className="px-3 py-2.5 font-medium">Stock</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="flex items-center gap-3"
                      >
                        <span className="relative size-11 shrink-0 overflow-hidden rounded-xs bg-surface">
                          {product.featuredImage ? (
                            <Image
                              src={product.featuredImage.url}
                              alt=""
                              fill
                              sizes="44px"
                              className="object-cover"
                            />
                          ) : (
                            <Icon
                              name="package"
                              size={18}
                              className="absolute inset-0 m-auto text-muted"
                            />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-caption font-medium text-ink">
                            {product.name}
                          </span>
                          <span className="block truncate text-micro text-muted">
                            {product.brand ? `${product.brand} · ` : ""}
                            {product.sku}
                          </span>
                        </span>
                      </Link>
                    </td>

                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-caption text-ink">
                      {formatTaka(product.price)}
                      {product.discountPercent > 0 && (
                        <span className="ml-1.5 text-micro text-sale">
                          −{product.discountPercent}%
                        </span>
                      )}
                    </td>

                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-caption">
                      <span
                        className={
                          product.stockQuantity === 0
                            ? "text-sale"
                            : product.isLowStock
                              ? "text-warn"
                              : "text-ink"
                        }
                      >
                        {product.stockQuantity}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge
                        tone={
                          product.status === "active"
                            ? product.isVisible
                              ? "positive"
                              : "warn"
                            : "neutral"
                        }
                      >
                        {product.status === "active" && !product.isVisible
                          ? "Hidden"
                          : (product.status ?? "draft")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableWrap>
      </AsyncState>
    </AdminShell>
  );
}
