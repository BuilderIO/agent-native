import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { JiraAnalytics } from "./hooks";

const STATUS_COLORS: Record<string, string> = {
  "To Do": "#6366f1",
  "In Progress": "#f59e0b",
  "In Review": "#3b82f6",
  Done: "#22c55e",
  Backlog: "#64748b",
};

const PALETTE = [
  "#6366f1",
  "#f59e0b",
  "#3b82f6",
  "#22c55e",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

interface Props {
  analytics: JiraAnalytics | undefined;
  isLoading: boolean;
}

export function JiraStatusChart({ analytics, isLoading }: Props) {
  const data = useMemo(() => {
    if (!analytics?.byStatus) return [];
    return Object.entries(analytics.byStatus)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [analytics]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        Open Issues by Status
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
          <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
            <XAxis type="number" tick={{ fontSize: 12, fill: "#94a3b8" }} />
            <YAxis
              type="category"
              dataKey="status"
              tick={{ fontSize: 12, fill: "#94a3b8" }}
              width={120}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map((entry, i) => (
                <Cell
                  key={entry.status}
                  fill={STATUS_COLORS[entry.status] ?? PALETTE[i % PALETTE.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
