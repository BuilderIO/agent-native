import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { topCustomersQuery } from "./queries";
import { cn } from "@/lib/utils";

const fmtFull = (v: number) =>
  `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

interface TopCustomersProps {
  fiscalYear: number;
}

export function TopCustomers({ fiscalYear }: TopCustomersProps) {
  const growthSql = topCustomersQuery(fiscalYear, "positive", 15);
  const churnSql = topCustomersQuery(fiscalYear, "negative", 15);

  const growth = useMetricsQuery(
    ["arr-top-growth", String(fiscalYear)],
    growthSql,
  );
  const churn = useMetricsQuery(
    ["arr-top-churn", String(fiscalYear)],
    churnSql,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CustomerTable
        title="Top Growth Customers"
        rows={growth.data?.rows ?? []}
        isLoading={growth.isLoading}
        error={growth.data?.error}
        positive
      />
      <CustomerTable
        title="Top Churn Customers"
        rows={churn.data?.rows ?? []}
        isLoading={churn.isLoading}
        error={churn.data?.error}
        positive={false}
      />
    </div>
  );
}

function CustomerTable({
  title,
  rows: rawRows,
  isLoading,
  error,
  positive,
}: {
  title: string;
  rows: Record<string, unknown>[];
  isLoading?: boolean;
  error?: string;
  positive: boolean;
}) {
  const rows = useMemo(
    () =>
      rawRows.map((r) => ({
        customer_name: String(r.customer_name ?? ""),
        product_group: String(r.product_group ?? ""),
        total_arr_change: Number(r.total_arr_change || 0),
        events: Number(r.events || 0),
      })),
    [rawRows],
  );

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 text-center py-4">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No data
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                    Customer
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                    Product
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    ARR Change
                  </th>
                  <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                    Events
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 px-3 font-medium max-w-[200px] truncate">
                      {r.customer_name}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground text-xs">
                      {r.product_group}
                    </td>
                    <td
                      className={cn(
                        "py-2 px-3 text-right font-medium",
                        positive ? "text-emerald-500" : "text-red-500",
                      )}
                    >
                      {positive ? "+" : ""}
                      {fmtFull(r.total_arr_change)}
                    </td>
                    <td className="py-2 px-3 text-right text-muted-foreground">
                      {r.events.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
