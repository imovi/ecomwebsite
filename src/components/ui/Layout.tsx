import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

/** Page width + gutter. Every page-level section goes through this. */
export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[var(--container-page)] px-gutter", className)}>
      {children}
    </div>
  );
}

/**
 * Section heading with an optional "View all" affordance.
 * Rendered as an <h2> so the page keeps a single <h1>.
 */
export function SectionHeader({
  title,
  href,
  action,
  className,
}: {
  title: string;
  href?: string;
  action?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <h2 className="text-title text-ink">{title}</h2>
      {href && action && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-caption font-medium text-muted transition-colors hover:text-ink"
        >
          {action}
          <Icon name="chevronRight" size={14} />
        </Link>
      )}
    </div>
  );
}

/** Loading placeholder. Matches the shape of what it replaces. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-sm bg-surface motion-reduce:animate-none", className)}
    />
  );
}

/** Empty state used by cart, search and category pages. */
export function EmptyState({
  icon = "package",
  title,
  body,
  children,
}: {
  icon?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-gutter py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-surface text-muted">
        <Icon name={icon} size={26} />
      </div>
      <p className="text-title text-ink">{title}</p>
      {body && <p className="mt-1.5 max-w-xs text-body text-muted">{body}</p>}
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}

/** Hairline divider that respects the page gutter. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}
