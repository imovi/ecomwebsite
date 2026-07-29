"use client";

import Link from "next/link";
import { useToastStore } from "@/lib/stores/toast-store";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

const toneStyles = {
  default: "bg-ink text-white",
  positive: "bg-ink text-white",
  error: "bg-sale text-white",
} as const;

/**
 * Mounted once in the root layout.
 *
 * Sits above the sticky buy bar (`bottom-20`) on mobile so a "Added to cart"
 * confirmation never covers the button the user is about to press next.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 flex justify-center px-gutter sm:bottom-6"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md px-4 py-3 shadow-card",
            "animate-[toast-in_220ms_var(--ease-spring)] motion-reduce:animate-none",
            toneStyles[t.tone],
          )}
        >
          <Icon
            name={t.tone === "error" ? "alert" : "checkCircle"}
            size={20}
            className="opacity-90"
          />
          <p className="min-w-0 flex-1 text-caption font-medium">{t.message}</p>

          {t.action && (
            <Link
              href={t.action.href}
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-caption font-semibold underline underline-offset-2"
            >
              {t.action.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
