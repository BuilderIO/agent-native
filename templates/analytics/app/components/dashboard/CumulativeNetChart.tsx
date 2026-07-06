import { useT } from "@agent-native/core/client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  chartAxisStroke,
  chartGridStroke,
  chartTooltipContentStyle,
} from "@/lib/chart-theme";

interface CumulativeNetChartProps {
  title: string;
  data: { day: string; cumulative_net: number }[];
  isLoading?: boolean;
  error?: string;
}

const formatDate = (value: any) => {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
};

const formatCurrency = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
};

export function CumulativeNetChart({
  title,
  data,
  isLoading,
  error,
}: CumulativeNetChartProps) {
  const t = useT();
  const lastValue = data.length > 0 ? data[data.length - 1].cumulative_net : 0;
  const isPositive = lastValue >= 0;
  const color = isPositive ? "#10b981" : "#ef4444";

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 py-8 text-center">{error}</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {t("common.noDataAvailable")}
          </p>
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient
                    id="cumulative-gradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  stroke={chartAxisStroke}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatDate}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrency}
                />
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={chartGridStroke}
                  vertical={false}
                />
                <ReferenceLine y={0} stroke={chartAxisStroke} strokeWidth={1} />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  labelFormatter={formatDate}
                  formatter={(value: any) => [
                    `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    "Cumulative Net ARR",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative_net"
                  stroke={color}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#cumulative-gradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
