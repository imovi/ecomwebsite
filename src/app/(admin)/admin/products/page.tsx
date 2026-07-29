import Image from "next/image";
import Link from "next/link";
import { getAllProductsForAdmin, getCategories } from "@/lib/data/catalog";
import { minPrice, totalStock } from "@/lib/catalog-utils";
import { formatDate, formatTaka } from "@/lib/utils";
import { AdminHeader, TableWrap, Td, Th } from "@/components/admin/AdminUI";
import { ProductStatusSelect } from "@/components/admin/ProductStatusSelect";

export default async function AdminProductsPage() {
  const [products, categories] = await Promise.all([
    getAllProductsForAdmin(),
    getCategories(),
  ]);

  const categoryName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <>
      <AdminHeader
        title="Products"
        subtitle={`${products.length} products · ${products.filter((p) => p.status === "active").length} live`}
      />

      <TableWrap>
        <thead>
          <tr>
            <Th>Product</Th>
            <Th>Category</Th>
            <Th>Price from</Th>
            <Th>Stock</Th>
            <Th>Variants</Th>
            <Th>Added</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const stock = product.variants.length ? totalStock(product) : null;

            return (
              <tr key={product.id} className="hover:bg-surface/60">
                <Td>
                  <div className="flex items-center gap-2.5">
                    <div className="relative size-10 shrink-0 overflow-hidden rounded-xs bg-surface">
                      <Image
                        src={product.images[0]}
                        alt=""
                        fill
                        sizes="40px"
                        loading="lazy"
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/product/${product.slug}`}
                        className="clamp-2 font-medium text-ink hover:underline"
                      >
                        {product.title}
                      </Link>
                      <span className="block text-micro text-muted">
                        {product.brand}
                        {product.pinnedRank != null &&
                          ` · pinned #${product.pinnedRank}`}
                      </span>
                    </div>
                  </div>
                </Td>
                <Td>{categoryName(product.categoryId)}</Td>
                <Td className="tnum">{formatTaka(minPrice(product))}</Td>
                <Td>
                  {stock === null ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <span
                      className={`tnum font-medium ${
                        stock === 0
                          ? "text-sale"
                          : stock <= 5
                            ? "text-warn"
                            : "text-ink"
                      }`}
                    >
                      {stock}
                    </span>
                  )}
                </Td>
                <Td className="tnum">{product.variants.length || "—"}</Td>
                <Td className="whitespace-nowrap">{formatDate(product.createdAt)}</Td>
                <Td>
                  <ProductStatusSelect
                    productId={product.id}
                    status={product.status}
                  />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>
    </>
  );
}
