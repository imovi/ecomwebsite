import { Suspense } from "react";
import { ProductForm } from "@/components/admin/ProductForm";

/** `params` is a Promise in this version of Next — it must be awaited. */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  /* ProductForm reads `?photos=failed` via useSearchParams, which needs a
     boundary around it. */
  return (
    <Suspense fallback={null}>
      <ProductForm productId={id} />
    </Suspense>
  );
}
