import { type StripeInvoice } from "@/lib/api-hooks";
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
import { ExternalLink } from "lucide-react";

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

function statusColor(status: string | null) {
  switch (status) {
    case "paid":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "open":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "void":
    case "uncollectible":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "draft":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    default:
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

export function BillingHistoryLoading() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function BillingHistory({ invoices }: { invoices: StripeInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No invoices found for this timeframe.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-auto max-h-[500px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Date</TableHead>
            <TableHead>Invoice #</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(inv.created)}
              </TableCell>
              <TableCell className="text-xs font-mono">
                {inv.number || inv.id.slice(0, 12)}
              </TableCell>
              <TableCell className="text-xs max-w-[250px] truncate">
                {inv.lines?.data?.[0]?.description || inv.description || "—"}
              </TableCell>
              <TableCell className="text-xs text-right font-medium">
                {formatCurrency(inv.amount_due, inv.currency)}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${statusColor(inv.status)}`}
                >
                  {inv.status || "unknown"}
                </Badge>
              </TableCell>
              <TableCell>
                {inv.hosted_invoice_url && (
                  <a
                    href={inv.hosted_invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
