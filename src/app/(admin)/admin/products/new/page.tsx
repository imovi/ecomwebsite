import { Suspense } from "react";
import { ProductForm } from "@/components/admin/ProductForm";

export default function NewProductPage() {
  /* ProductForm reads `?photos=failed` via useSearchParams, which needs a
     boundary or it opts the whole route out of static rendering. */
  return (
    <Suspense fallback={null}>
      <ProductForm />
    </Suspense>
  );
}
