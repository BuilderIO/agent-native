import { useT } from "@agent-native/core/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  chartAxisStroke,
  chartGridStroke,
  chartTooltipContentStyle,
} from "@/lib/chart-theme";

interface TimeSeriesChartProps {
  title: string;
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color?: string;
  isLoading?: boolean;
  error?: string;
  yFormatter?: (value: number) => string;
}

export function TimeSeriesChart({
  title,
  data,
  xKey,
  yKey,
  color = "var(--brand-blue)",
  isLoading,
  error,
  yFormatter,
}: TimeSeriesChartProps) {
  const t = useT();
  const formatXLabel = (value: any) => {
    try {
      const d = new Date(value);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return String(value);
    }
  };

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
                    id={`gradient-${yKey}`}
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
                  dataKey={xKey}
                  stroke={chartAxisStroke}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatXLabel}
                />
                <YAxis
                  stroke={chartAxisStroke}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={yFormatter}
                />
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={chartGridStroke}
                  vertical={false}
                />
                <Tooltip
                  contentStyle={chartTooltipContentStyle}
                  labelFormatter={formatXLabel}
                />
                <Area
                  type="monotone"
                  dataKey={yKey}
                  stroke={color}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill={`url(#gradient-${yKey})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
