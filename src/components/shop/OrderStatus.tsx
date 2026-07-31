import type { OrderStatus } from "@/types";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

const TONES: Record<OrderStatus, React.ComponentProps<typeof Badge>["tone"]> = {
  pending: "warn",
  confirmed: "neutral",
  processing: "neutral",
  packed: "neutral",
  shipped: "neutral",
  delivered: "positive",
  cancelled: "saleSoft",
  returned: "saleSoft",
};

export function OrderStatusBadge({
  status,
  size = "sm",
}: {
  status: OrderStatus;
  size?: "sm" | "md";
}) {
  return (
    <Badge tone={TONES[status]} size={size}>
      {copy.orderStatus[status]}
    </Badge>
  );
}

/** The happy path, in order. Terminal failure states are rendered separately. */
const STEPS: OrderStatus[] = [
  "pending",
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "delivered",
];

/**
 * Customer-facing progress view.
 *
 * Shows the confirmation call as an explicit, visible step — it sets the
 * expectation that someone will ring, which measurably reduces "why hasn't it
 * shipped" support calls on a COD store.
 */
export function OrderTimeline({ status }: { status: OrderStatus }) {
  if (status === "cancelled" || status === "returned") {
    return (
      <div className="flex items-center gap-2.5 rounded-sm bg-sale-soft px-3.5 py-3">
        <Icon name="alert" size={18} className="text-sale" />
        <p className="text-caption font-medium text-sale">
          {copy.orderStatus[status]}
        </p>
      </div>
    );
  }

  const currentIndex = STEPS.indexOf(status);

  return (
    <ol className="flex flex-col">
      {STEPS.map((step, i) => {
        const done = i <= currentIndex;
        const isLast = i === STEPS.length - 1;

        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  done
                    ? "border-positive bg-positive text-white"
                    : "border-line bg-white text-line",
                )}
              >
                {done && <Icon name="check" size={13} strokeWidth={2.4} />}
              </span>
              {!isLast && (
                <span
                  className={cn(
                    "w-px flex-1",
                    i < currentIndex ? "bg-positive" : "bg-line",
                  )}
                />
              )}
            </div>

            <p
              className={cn(
                "pb-5 text-caption",
                isLast && "pb-0",
                done ? "font-medium text-ink" : "text-muted",
              )}
            >
              {copy.orderStatus[step]}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
