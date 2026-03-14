import { type StripeSubscription } from "@/lib/api-hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusColor(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "trialing":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "past_due":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "canceled":
    case "unpaid":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "incomplete":
    case "incomplete_expired":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "paused":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

export function SubscriptionListLoading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function SubscriptionList({
  subscriptions,
}: {
  subscriptions: StripeSubscription[];
}) {
  if (subscriptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No active subscriptions found for this customer.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {subscriptions.map((sub) => (
        <SubscriptionCard key={sub.id} sub={sub} />
      ))}
    </div>
  );
}

function SubscriptionCard({ sub }: { sub: StripeSubscription }) {
  const items = sub.items?.data ?? [];

  return (
    <Card>
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            {items.map((item) => (
              <div key={item.id}>
                <div className="text-sm font-medium">
                  {item.price.nickname || item.price.productName || item.price.product}
                  {item.quantity > 1 && (
                    <span className="text-muted-foreground ml-1">
                      x{item.quantity}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {item.price.unit_amount != null
                    ? formatCurrency(
                        item.price.unit_amount * item.quantity,
                        item.price.currency
                      )
                    : "Custom pricing"}
                  {item.price.recurring &&
                    ` / ${item.price.recurring.interval_count > 1 ? `${item.price.recurring.interval_count} ` : ""}${item.price.recurring.interval}${item.price.recurring.interval_count > 1 ? "s" : ""}`}
                </div>
              </div>
            ))}
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] shrink-0 ${statusColor(sub.status)}`}
          >
            {sub.status.replace(/_/g, " ")}
          </Badge>
        </div>
        <div className="flex gap-4 text-[11px] text-muted-foreground">
          <span>
            Period: {formatDate(sub.current_period_start)} –{" "}
            {formatDate(sub.current_period_end)}
          </span>
          {sub.cancel_at_period_end && (
            <span className="text-orange-400">
              Cancels {formatDate(sub.current_period_end)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
