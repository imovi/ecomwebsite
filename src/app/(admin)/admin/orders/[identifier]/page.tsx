import { OrderDetail } from "@/components/admin/OrderDetail";

/** The identifier is an order number (GNG-10001) or a uuid; the API takes both. */
export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  return <OrderDetail identifier={identifier} />;
}
