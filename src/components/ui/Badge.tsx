import { cn } from "@/lib/utils";

const tones = {
  sale: "bg-sale text-white",
  saleSoft: "bg-sale-soft text-sale",
  positive: "bg-positive-soft text-positive",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-surface text-ink-soft",
  ink: "bg-ink text-white",
} as const;

const badgeSizes = {
  sm: "h-5 px-1.5 text-micro rounded-xs",
  md: "h-6 px-2 text-caption rounded-xs",
} as const;

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof tones;
  size?: keyof typeof badgeSizes;
}

export function Badge({
  tone = "neutral",
  size = "sm",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 font-semibold whitespace-nowrap",
        tones[tone],
        badgeSizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
