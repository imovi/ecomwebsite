import { copy } from "@/lib/copy";
import { Icon } from "@/components/ui/Icon";

/**
 * One-tap route to a human.
 *
 * For an unknown store selling cash-on-delivery, a large share of buyers want
 * to confirm the product is real before ordering. Making that conversation one
 * tap away recovers orders that would otherwise silently bounce.
 *
 * Sits above the sticky buy bar so the two never overlap.
 */
export function WhatsAppButton({ phone }: { phone: string }) {
  return (
    <a
      href={`https://wa.me/${phone}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={copy.contact.whatsapp}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] right-4 z-20 flex size-12 items-center justify-center rounded-full bg-positive text-white shadow-card transition-transform duration-150 ease-out hover:scale-105 active:scale-95 motion-reduce:transition-none md:bottom-6"
    >
      <Icon name="whatsapp" size={24} strokeWidth={1.5} />
    </a>
  );
}
