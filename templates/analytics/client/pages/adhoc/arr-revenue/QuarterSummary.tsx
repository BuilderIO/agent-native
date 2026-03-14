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
import { quarterSummaryQuery } from "./queries";
import { cn } from "@/lib/utils";

const fmtCurrency = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

const fmtFull = (v: number) =>
  `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

interface QuarterSummaryProps {
  fiscalYear: number;
}

export function QuarterSummary({ fiscalYear }: QuarterSummaryProps) {
  const sql = quarterSummaryQuery(fiscalYear);
  const { data, isLoading } = useMetricsQuery(
    ["arr-quarter-summary", String(fiscalYear)],
    sql,
  );

  const rows = useMemo(() => {
    return (data?.rows ?? []).map((r) => ({
      quarter: String(r.fiscal_year_quarter ?? r.fiscal_quarter ?? ""),
      revenue_in: Number(r.revenue_in || 0),
      churn_out: Number(r.churn_out || 0),
      net: Number(r.net || 0),
      events: Number(r.events || 0),
      customers: Number(r.customers || 0),
    }));
  }, [data]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        quarter: r.quarter,
        revenue_in: r.revenue_in,
        churn_out: -r.churn_out,
      })),
    [rows],
  );

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Fiscal Quarter Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : data?.error ? (
          <p className="text-sm text-red-400 py-8 text-center">{data.error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No data available
          </p>
        ) : (
          <>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#27272a"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="quarter"
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                      Quarter
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Revenue In
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Churn Out
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Net
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Events
                    </th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                      Customers
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isPos = r.net >= 0;
                    return (
                      <tr key={r.quarter} className="border-b border-border/50">
                        <td className="py-2 px-3 font-medium">{r.quarter}</td>
                        <td className="py-2 px-3 text-right text-emerald-500">
                          +{fmtFull(r.revenue_in)}
                        </td>
                        <td className="py-2 px-3 text-right text-red-500">
                          -{fmtFull(r.churn_out)}
                        </td>
                        <td
                          className={cn(
                            "py-2 px-3 text-right font-medium",
                            isPos ? "text-emerald-500" : "text-red-500",
                          )}
                        >
                          {isPos ? "+" : ""}
                          {fmtFull(r.net)}
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {r.events.toLocaleString()}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
