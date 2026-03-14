import { useMemo } from "react";
import {
  Bar,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsQuery } from "@/lib/query-metrics";
import { arrOverTimeQuery } from "./queries";

type Cadence = "Daily" | "Weekly" | "Monthly" | "Quarterly";

const fmtCurrency = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

const formatLabel = (value: string) => {
  if (!value) return "";
  // fiscal_year_quarter like "FY2026-Q1" or year_month like "2026-01"
  if (value.startsWith("FY") || value.length <= 10) return value;
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return value;
  }
};

interface ArrOverTimeChartProps {
  fiscalYear: number;
  cadence: Cadence;
  productGroup?: string;
  statusGroup?: string;
}

export function ArrOverTimeChart({
  fiscalYear,
  cadence,
  productGroup,
  statusGroup,
}: ArrOverTimeChartProps) {
  const sql = arrOverTimeQuery(cadence, fiscalYear, productGroup, statusGroup);
  const { data, isLoading } = useMetricsQuery(
    [
      "arr-over-time",
      String(fiscalYear),
      cadence,
      productGroup ?? "",
      statusGroup ?? "",
    ],
    sql,
  );

  const chartData = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.map((r) => ({
      period: String(r.period ?? ""),
      revenue_in: Number(r.revenue_in || 0),
      churn_out: -Number(r.churn_out || 0),
      net: Number(r.net || 0),
    }));
  }, [data]);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          ARR Changes Over Time ({cadence})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[350px] w-full" />
        ) : data?.error ? (
          <p className="text-sm text-red-400 py-8 text-center">{data.error}</p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No data available
          </p>
        ) : (
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#27272a"
                  vertical={false}
                />
                <XAxis
                  dataKey="period"
                  stroke="#52525b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatLabel}
                />
                <YAxis
                  stroke="#52525b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={fmtCurrency}
                />
                <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="3 3" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#09090b",
                    border: "1px solid #27272a",
                    borderRadius: "8px",
                    color: "#fafafa",
                  }}
                  formatter={(value: number, name: string) => [
                    fmtCurrency(value),
                    name,
                  ]}
                  labelFormatter={formatLabel}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
                <Bar
                  dataKey="revenue_in"
                  name="Revenue In"
                  fill="#10b981"
                  radius={[2, 2, 0, 0]}
                />
                <Bar
                  dataKey="churn_out"
                  name="Churn Out"
                  fill="#ef4444"
                  radius={[0, 0, 2, 2]}
                />
                <Line
                  dataKey="net"
                  name="Net"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                  type="monotone"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
