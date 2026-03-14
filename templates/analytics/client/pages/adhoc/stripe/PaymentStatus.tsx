import { type StripeCharge, type StripePaymentIntent } from "@/lib/api-hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

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
    hour: "numeric",
    minute: "2-digit",
  });
}

function chargeStatusIcon(status: string, paid: boolean) {
  if (paid || status === "succeeded")
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "pending")
    return <Clock className="h-4 w-4 text-yellow-400" />;
  return <AlertTriangle className="h-4 w-4 text-zinc-400" />;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "succeeded":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "failed":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "pending":
    case "processing":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "requires_payment_method":
    case "requires_action":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "canceled":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

export function PaymentStatusLoading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

export function PaymentStatus({
  charges,
  paymentIntents,
}: {
  charges: StripeCharge[];
  paymentIntents: StripePaymentIntent[];
}) {
  if (charges.length === 0 && paymentIntents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No recent payments found.
      </p>
    );
  }

  // Show failed payment intents prominently at the top
  const failedIntents = paymentIntents.filter(
    (pi) => pi.last_payment_error || pi.status === "requires_payment_method",
  );

  return (
    <div className="space-y-3">
      {failedIntents.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-red-400 uppercase tracking-wider">
            Failed / Action Required
          </h4>
          {failedIntents.map((pi) => (
            <Card key={pi.id} className="border-red-500/30 bg-red-500/5">
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        {formatCurrency(pi.amount, pi.currency)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(pi.created)}
                      </div>
                      {pi.last_payment_error && (
                        <div className="text-xs text-red-400">
                          {pi.last_payment_error.message}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] shrink-0 ${statusBadgeClass(pi.status)}`}
                  >
                    {pi.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Recent Charges
      </h4>
      <div className="space-y-2">
        {charges.slice(0, 15).map((ch) => (
          <Card key={ch.id}>
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {chargeStatusIcon(ch.status, ch.paid)}
                  <div>
                    <div className="text-sm font-medium">
                      {formatCurrency(ch.amount, ch.currency)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(ch.created)}
                      {ch.description && ` \u2014 ${ch.description}`}
                    </div>
                    {ch.failure_message && (
                      <div className="text-xs text-red-400 mt-0.5">
                        {ch.failure_message}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {ch.refunded && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-purple-500/15 text-purple-400 border-purple-500/30"
                    >
                      refunded
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${statusBadgeClass(ch.status)}`}
                  >
                    {ch.status}
                  </Badge>
                  {ch.receipt_url && (
                    <a
                      href={ch.receipt_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
