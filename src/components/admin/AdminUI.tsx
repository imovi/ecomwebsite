import { cn } from "@/lib/utils";

/** Shared chrome for admin screens. Deliberately plain — this is a work tool,
 *  not a showcase. */

export function AdminHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-display text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-caption text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-md border border-line bg-white p-4", className)}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "warn" | "sale";
}) {
  return (
    <Card>
      <p className="text-caption text-muted">{label}</p>
      <p
        className={cn(
          "tnum mt-1 text-[1.5rem] font-semibold tracking-tight",
          tone === "positive" && "text-positive",
          tone === "warn" && "text-warn",
          tone === "sale" && "text-sale",
          !tone && "text-ink",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-micro text-muted">{hint}</p>}
    </Card>
  );
}

/** Tables scroll horizontally inside their own container so the page body
 *  never scrolls sideways on a phone. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-white">
      <table className="w-full min-w-[640px] border-collapse text-caption">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line px-3 py-2.5 text-left font-medium text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("border-b border-line px-3 py-2.5 text-ink-soft", className)}>
      {children}
    </td>
  );
}

/**
 * Fourteen-day revenue sparkline. Hand-rolled SVG rather than a chart library
 * — one polyline does not justify 40KB of JavaScript.
 */
export function Sparkline({
  data,
  className,
}: {
  data: { date: string; value: number }[];
  className?: string;
}) {
  if (data.length < 2) return null;

  const width = 100;
  const height = 28;
  const max = Math.max(...data.map((d) => d.value), 1);

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (d.value / max) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full", className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
