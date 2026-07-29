import Image from "next/image";
import Link from "next/link";
import { getAllProductsForAdmin } from "@/lib/data/catalog";
import { variantLabel } from "@/lib/catalog-utils";
import { formatTaka } from "@/lib/utils";
import { AdminHeader, TableWrap, Td, Th } from "@/components/admin/AdminUI";
import { StockInput } from "@/components/admin/StockInput";

export default async function AdminStockPage() {
  const products = await getAllProductsForAdmin();

  const rows = products.flatMap((product) =>
    product.variants.map((variant) => ({
      productId: product.id,
      slug: product.slug,
      title: product.title,
      image: product.images[variant.imageIndex ?? 0] ?? product.images[0],
      variantId: variant.id,
      label: variantLabel(variant) ?? "Default",
      sku: variant.sku,
      price: variant.price,
      stock: variant.stock,
    })),
  );

  // Lowest stock first — this page exists to answer "what do I need to order?"
  const sorted = [...rows].sort((a, b) => a.stock - b.stock);
  const outOfStock = rows.filter((r) => r.stock === 0).length;
  const lowStock = rows.filter((r) => r.stock > 0 && r.stock <= 3).length;

  return (
    <>
      <AdminHeader
        title="Stock"
        subtitle={`${rows.length} variants · ${outOfStock} out of stock · ${lowStock} running low`}
      />

      <TableWrap>
        <thead>
          <tr>
            <Th>Product</Th>
            <Th>Variant</Th>
            <Th>SKU</Th>
            <Th>Price</Th>
            <Th className="text-right">Stock</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.variantId} className="hover:bg-surface/60">
              <Td>
                <div className="flex items-center gap-2.5">
                  <div className="relative size-9 shrink-0 overflow-hidden rounded-xs bg-surface">
                    <Image
                      src={row.image}
                      alt=""
                      fill
                      sizes="36px"
                      loading="lazy"
                      className="object-cover"
                    />
                  </div>
                  <Link
                    href={`/product/${row.slug}`}
                    className="clamp-2 font-medium text-ink hover:underline"
                  >
                    {row.title}
                  </Link>
                </div>
              </Td>
              <Td>{row.label}</Td>
              <Td className="text-micro text-muted">{row.sku}</Td>
              <Td className="tnum">{formatTaka(row.price)}</Td>
              <Td className="text-right">
                <StockInput
                  productId={row.productId}
                  variantId={row.variantId}
                  stock={row.stock}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <p className="mt-3 text-caption text-muted">
        Stock is reserved when an order is placed and released again if the
        order is cancelled or returned.
      </p>
    </>
  );
}
