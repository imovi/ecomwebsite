import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

/**
 * Variant maps are written so no two entries in the same map set the same CSS
 * property — that's what lets us skip tailwind-merge. If you add a variant,
 * keep that invariant.
 */
const variants = {
  /** Dominant CTA: Buy Now, Place Order, Checkout. */
  primary:
    "bg-ink text-white border border-ink hover:bg-ink-soft active:bg-ink-soft disabled:bg-line disabled:text-muted disabled:border-line",
  /** Paired secondary action: Add to Cart. Equal weight, lower emphasis. */
  secondary:
    "bg-white text-ink border border-ink hover:bg-surface active:bg-line disabled:border-line disabled:text-muted",
  /** Low-emphasis inline action. */
  ghost:
    "bg-transparent text-ink border border-transparent hover:bg-surface active:bg-line disabled:text-muted",
  /** Neutral filled, for admin toolbars and chips. */
  soft: "bg-surface text-ink border border-transparent hover:bg-line active:bg-line disabled:text-muted",
  /** Destructive: remove, cancel order. */
  danger:
    "bg-white text-sale border border-sale/30 hover:bg-sale-soft active:bg-sale-soft disabled:text-muted disabled:border-line",
} as const;

const sizes = {
  sm: "h-9 px-3 text-caption gap-1.5 rounded-xs",
  md: "h-11 px-4 text-body gap-2 rounded-sm",
  lg: "h-12 px-5 text-body gap-2 rounded-md",
  /** Full-width conversion buttons. Tall enough to be the obvious target. */
  xl: "h-14 px-6 text-[1.0625rem] gap-2 rounded-md",
} as const;

type Variant = keyof typeof variants;
type Size = keyof typeof sizes;

const base =
  "inline-flex items-center justify-center font-medium select-none " +
  "transition-[background-color,border-color,transform,opacity] duration-150 ease-out " +
  "active:scale-[0.985] disabled:pointer-events-none disabled:active:scale-100 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

interface CommonProps {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  className?: string;
  children: React.ReactNode;
}

type ButtonProps = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: never;
  };

type LinkProps = CommonProps &
  Omit<React.ComponentPropsWithoutRef<typeof Link>, keyof CommonProps> & {
    href: string;
  };

export function Button(props: ButtonProps | LinkProps) {
  const {
    variant = "primary",
    size = "md",
    fullWidth,
    loading,
    className,
    children,
    ...rest
  } = props;

  const classes = cn(
    base,
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
    loading && "pointer-events-none",
    className,
  );

  const content = (
    <>
      {loading && (
        <Icon name="spinner" size={18} className="animate-spin motion-reduce:animate-none" />
      )}
      {children}
    </>
  );

  if ("href" in rest && rest.href !== undefined) {
    const { href, ...linkRest } = rest as LinkProps;
    return (
      <Link href={href} className={classes} {...linkRest}>
        {content}
      </Link>
    );
  }

  const { type = "button", ...buttonRest } = rest as ButtonProps;
  return (
    <button type={type} className={classes} {...buttonRest}>
      {content}
    </button>
  );
}
