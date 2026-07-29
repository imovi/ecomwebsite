"use server";

import { revalidatePath } from "next/cache";
import { products } from "@/data/products";
import { coupons } from "@/data/store";
import type { ProductStatus } from "@/types";

/**
 * Admin mutations.
 *
 * These write to the in-memory catalog, which is exactly the surface a real
 * repository will expose — swapping the bodies for Prisma calls is the whole
 * migration. State resets when the dev server restarts; that is expected for
 * a frontend-only build and is called out in the admin UI.
 */

export async function setVariantStockAction(
  productId: string,
  variantId: string,
  stock: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(stock) || stock < 0) {
    return { ok: false, error: "Stock must be zero or more." };
  }

  const product = products.find((p) => p.id === productId);
  const variant = product?.variants.find((v) => v.id === variantId);
  if (!variant) return { ok: false, error: "Variant not found." };

  variant.stock = Math.floor(stock);

  revalidatePath("/admin/stock");
  revalidatePath("/admin/products");
  // Stock is rendered on the storefront, so those pages are stale now too.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setProductStatusAction(
  productId: string,
  status: ProductStatus,
): Promise<{ ok: boolean; error?: string }> {
  const product = products.find((p) => p.id === productId);
  if (!product) return { ok: false, error: "Product not found." };

  product.status = status;

  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setCouponActiveAction(
  code: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const coupon = coupons.find((c) => c.code === code);
  if (!coupon) return { ok: false, error: "Coupon not found." };

  coupon.active = active;
  revalidatePath("/admin/coupons");
  return { ok: true };
}
