import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { productBreakdownQuery, productDetailBreakdownQuery } from "./queries";
import { cn } from "@/lib/utils";

const fmtCurrency = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

const fmtFull = (v: number) =>
  `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const PRODUCT_COLORS: Record<string, string> = {
  "Publish + Fusion": "#6366f1",
  Shopify: "#10b981",
  unknown: "#71717a",
};

interface ProductBreakdownProps {
  fiscalYear: number;
}

export function ProductBreakdown({ fiscalYear }: ProductBreakdownProps) {
  const groupSql = productBreakdownQuery(fiscalYear);
  const detailSql = productDetailBreakdownQuery(fiscalYear);

  const groupQuery = useMetricsQuery(
    ["arr-product-group", String(fiscalYear)],
    groupSql
  );
  const detailQuery = useMetricsQuery(
    ["arr-product-detail", String(fiscalYear)],
    detailSql
  );

  const groupRows = useMemo(() => {
    return (groupQuery.data?.rows ?? []).map((r) => ({
      product_group: String(r.product_group ?? ""),
      revenue_in: Number(r.revenue_in || 0),
      churn_out: Number(r.churn_out || 0),
      net: Number(r.net || 0),
      events: Number(r.events || 0),
      customers: Number(r.customers || 0),
    }));
  }, [groupQuery.data]);

  const detailRows = useMemo(() => {
    return (detailQuery.data?.rows ?? []).map((r) => ({
      product: String(r.product ?? ""),
      product_group: String(r.product_group ?? ""),
      revenue_in: Number(r.revenue_in || 0),
      churn_out: Number(r.churn_out || 0),
      net: Number(r.net || 0),
      events: Number(r.events || 0),
      customers: Number(r.customers || 0),
    }));
  }, [detailQuery.data]);

  const chartData = useMemo(
    () =>
      groupRows.map((r) => ({
        product_group: r.product_group,
        revenue_in: r.revenue_in,
        churn_out: -r.churn_out,
      })),
    [groupRows]
  );

  const isLoading = groupQuery.isLoading || detailQuery.isLoading;
  const error = groupQuery.data?.error || detailQuery.data?.error;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By Product Group</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : error ? (
            <p className="text-sm text-red-400 py-8 text-center">{error}</p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No data
            </p>
          ) : (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#27272a"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="product_group"
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={fmtCurrency}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#09090b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      color: "#fafafa",
                    }}
                    formatter={(value: number, name: string) => [
                      fmtCurrency(Math.abs(value)),
                      name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
                  <Bar
                    dataKey="revenue_in"
                    name="Revenue In"
                    fill="#10b981"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="churn_out"
                    name="Churn Out"
                    fill="#ef4444"
                    radius={[0, 0, 3, 3]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By Product (Detail)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[250px] w-full" />
          ) : error ? (
            <p className="text-sm text-red-400 text-center py-4">{error}</p>
          ) : detailRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No data
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                      Product
                    </th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                      Group
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Net
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Customers
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((r) => {
                    const isPos = r.net >= 0;
                    return (
                      <tr
                        key={`${r.product}-${r.product_group}`}
                        className="border-b border-border/50"
                      >
                        <td className="py-2 px-3 font-medium">{r.product}</td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">
                          {r.product_group}
                        </td>
                        <td
                          className={cn(
                            "py-2 px-3 text-right font-medium",
                            isPos ? "text-emerald-500" : "text-red-500"
                          )}
                        >
                          {isPos ? "+" : ""}
                          {fmtFull(r.net)}
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {r.customers.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
