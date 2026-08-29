import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resumeCartAction } from "@/app/actions";
import { Container } from "@/components/ui/Layout";
import { ResumeCheckout } from "@/components/checkout/ResumeCheckout";

export const metadata: Metadata = {
  title: "Resuming your order",
  /* The link is personal and single-purpose. Nothing here belongs in a search
     index, and `noindex` is what keeps a crawler from filling one with carts. */
  robots: { index: false, follow: false },
};

/**
 * Where a WhatsApp recovery link lands.
 *
 * The shop messages a customer who abandoned a checkout; this rebuilds what was
 * in their basket and moves them straight on to the checkout form, with the
 * coupon code carried across if the message contained one.
 *
 * Dynamic, never prerendered: the whole page is one shopper's basket, and a
 * cached copy would be somebody else's.
 */
export const dynamic = "force-dynamic";

export default async function ResumeCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const result = await resumeCartAction(id);

  /**
   * A dead link sends them to the shop rather than to an error.
   *
   * The lead may have been deleted, or the id mistyped by a customer retyping a
   * link out of a message. Either way the useful thing to do with somebody who
   * was about to buy is show them the shop, not an apology they cannot act on.
   */
  if (!result.ok || result.lines.length === 0) redirect("/");

  return (
    <Container className="py-6">
      <ResumeCheckout
        lines={result.lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          qty: line.qty,
        }))}
        couponCode={query.c?.trim().toUpperCase() ?? ""}
      />
    </Container>
  );
}
