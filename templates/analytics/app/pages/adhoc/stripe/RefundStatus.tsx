import { type StripeRefund } from "@/lib/api-hooks";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    case "succeeded":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "pending":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "failed":
    case "canceled":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

function reasonLabel(reason: string | null) {
  switch (reason) {
    case "duplicate":
      return "Duplicate";
    case "fraudulent":
      return "Fraudulent";
    case "requested_by_customer":
      return "Customer request";
    default:
      return reason || "—";
  }
}

export function RefundStatusLoading() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function RefundStatus({ refunds }: { refunds: StripeRefund[] }) {
  if (refunds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No refunds found for this customer.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-auto max-h-[500px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Date</TableHead>
            <TableHead>Refund ID</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {refunds.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(r.created)}
              </TableCell>
              <TableCell className="text-xs font-mono">
                {r.id.slice(0, 18)}
              </TableCell>
              <TableCell className="text-xs text-right font-medium">
                {formatCurrency(r.amount, r.currency)}
              </TableCell>
              <TableCell className="text-xs">{reasonLabel(r.reason)}</TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${statusColor(r.status)}`}
                >
                  {r.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
