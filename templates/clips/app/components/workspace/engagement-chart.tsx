import { useT } from "@agent-native/core/client/i18n";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export interface TrendPoint {
  date: string;
  views: number;
  reactions: number;
  comments: number;
}

interface EngagementChartProps {
  data: TrendPoint[];
  brandColor?: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function EngagementChart({
  data,
  brandColor = "hsl(var(--primary))",
}: EngagementChartProps) {
  const t = useT();
  if (!data || data.length === 0) {
    return (
      <Empty className="h-64 gap-2 rounded-none">
        <EmptyHeader>
          <EmptyTitle className="text-sm font-medium text-muted-foreground">
            {t("clipsFinalRaw.noEngagementData")}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const chartConfig = {
    views: {
      label: t("insightsHub.views"),
      color: brandColor,
    },
    reactions: {
      label: t("insightsHub.reactions"),
      color: "hsl(var(--success))",
    },
    comments: {
      label: t("insightsHub.comments"),
      color: "hsl(var(--highlight))",
    },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto">
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
      >
        <CartesianGrid
          stroke="hsl(var(--border))"
          strokeDasharray="3 3"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
          allowDecimals={false}
          width={32}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDate(String(value))}
              formatter={(value, name) => [
                Number(value).toLocaleString(),
                chartConfig[String(name) as keyof typeof chartConfig]?.label ??
                  String(name),
              ]}
            />
          }
        />
        <ChartLegend
          verticalAlign="top"
          content={<ChartLegendContent verticalAlign="top" />}
        />
        <Line
          type="monotone"
          dataKey="views"
          stroke="var(--color-views)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="reactions"
          stroke="var(--color-reactions)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="comments"
          stroke="var(--color-comments)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
