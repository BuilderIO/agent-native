import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

const DEFAULT_COLORS = [
  "hsl(var(--primary))",
  "hsl(199 89% 48%)",
  "hsl(151 55% 42%)",
  "hsl(35 92% 50%)",
];

function ChartBody({ chart }: { chart: DataChartWidgetData }) {
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis
        dataKey={chart.xKey}
        tickLine={false}
        axisLine={false}
        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        width={34}
      />
      <Tooltip
        contentStyle={{
          background: "hsl(var(--background))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 8,
          color: "hsl(var(--foreground))",
          fontSize: 12,
        }}
      />
    </>
  );

  if (chart.type === "line") {
    return (
      <LineChart data={chart.data}>
        {axes}
        {chart.series.map((series, index) => (
          <Line
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={
              series.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]
            }
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  }

  if (chart.type === "area") {
    return (
      <AreaChart data={chart.data}>
        {axes}
        {chart.series.map((series, index) => (
          <Area
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={
              series.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]
            }
            fill={series.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
            fillOpacity={0.18}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    );
  }

  return (
    <BarChart data={chart.data}>
      {axes}
      {chart.series.map((series, index) => (
        <Bar
          key={series.key}
          dataKey={series.key}
          name={series.label}
          fill={series.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      ))}
    </BarChart>
  );
}

export function DataChartRenderer({ chart }: { chart: DataChartWidgetData }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <div className="h-60 w-full min-w-0">
      {ready ? (
        <ResponsiveContainer width="100%" height="100%">
          <ChartBody chart={chart} />
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
