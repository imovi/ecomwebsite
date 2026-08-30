import { Suspense } from "react";
import { OrderList } from "@/components/admin/OrderList";

export default function AdminOrdersPage() {
  /* OrderList reads `?status=` and `?range=` via useSearchParams — the
     dashboard's pipeline tiles link here — which needs a boundary or it opts
     the whole route out of static rendering. */
  return (
    <Suspense fallback={null}>
      <OrderList />
    </Suspense>
  );
}
