import { type ProductBillingAggregate } from "@/lib/api-hooks";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export function BillingByProductHistoryLoading() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function BillingByProductHistory({
  products,
}: {
  products: ProductBillingAggregate[];
}) {
  if (products.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No product billing data found for this timeframe.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-auto max-h-[500px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product Name</TableHead>
            <TableHead className="text-right">Total Amount</TableHead>
            <TableHead className="text-right">Invoice Count</TableHead>
            <TableHead className="text-xs text-muted-foreground font-mono">
              Product ID
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.productId}>
              <TableCell className="text-xs font-medium">
                {product.productName}
              </TableCell>
              <TableCell className="text-xs text-right font-semibold">
                {formatCurrency(product.totalAmount, product.currency)}
              </TableCell>
              <TableCell className="text-xs text-right text-muted-foreground">
                {product.invoiceCount}
              </TableCell>
              <TableCell className="text-[10px] font-mono text-muted-foreground">
                {product.productId}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
