import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { JiraAnalytics } from "./hooks";

interface Props {
  analytics: JiraAnalytics | undefined;
  isLoading: boolean;
}

export function JiraCreatedResolvedChart({ analytics, isLoading }: Props) {
  const data = useMemo(() => {
    if (!analytics) return [];
    const created = analytics.createdByDay;
    const resolved = analytics.resolvedByDay;
    const resolvedMap = new Map(resolved.map((r) => [r.date, r.count]));
    return created.map((c) => ({
      date: c.date,
      created: c.count,
      resolved: resolvedMap.get(c.date) ?? 0,
    }));
  }, [analytics]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        Created vs Resolved Over Time
      </h3>
      {isLoading ? (
        <div className="h-64 flex items-center justify-center text-muted-foreground animate-pulse">
          Loading...
        </div>
      ) : data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-muted-foreground">
          No data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickFormatter={(v: string) => v.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#94a3b8" }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                fontSize: "12px",
              }}
              labelFormatter={(v: string) => v}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Line
              type="monotone"
              dataKey="created"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              name="Created"
            />
            <Line
              type="monotone"
              dataKey="resolved"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              name="Resolved"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
