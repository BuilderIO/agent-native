import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { SentryOrgStats, SentryIssue } from "./types";

const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

function formatTime(ts: string) {
  const d = new Date(ts);
  const h = d.getHours();
  const ampm = h >= 12 ? "p" : "a";
  const hr = h % 12 || 12;
  const day = d.getDate();
  const mon = d.toLocaleString("en-US", { month: "short" });
  if (h === 0) return `${mon} ${day}`;
  return `${hr}${ampm}`;
}

interface ErrorTrendProps {
  stats: SentryOrgStats | undefined;
  isLoading: boolean;
}

export function ErrorTrendChart({ stats, isLoading }: ErrorTrendProps) {
  const data = useMemo(() => {
    if (!stats?.intervals || !stats.groups) return [];
    return stats.intervals.map((ts, i) => {
      const point: Record<string, unknown> = { time: formatTime(ts) };
      let total = 0;
      for (const group of stats.groups) {
        const outcome = group.by.outcome || "unknown";
        const seriesValues = Object.values(group.series);
        const val = seriesValues[0]?.[i] ?? 0;
        point[outcome] = val;
        total += val;
      }
      point.total = total;
      return point;
    });
  }, [stats]);

  if (isLoading) {
    return <ChartSkeleton title="Error Trend" />;
  }

  if (!data.length) {
    return <EmptyChart title="Error Trend" />;
  }

  const outcomes = stats?.groups?.map((g) => g.by.outcome || "unknown") ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        Error Trend Over Time
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            interval={Math.max(0, Math.floor(data.length / 10) - 1)}
            height={30}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          {outcomes.map((outcome, i) => (
            <Line
              key={outcome}
              type="monotone"
              dataKey={outcome}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface ErrorsByProjectProps {
  issues: SentryIssue[] | undefined;
  isLoading: boolean;
}

export function ErrorsByProjectChart({
  issues,
  isLoading,
}: ErrorsByProjectProps) {
  const data = useMemo(() => {
    if (!issues?.length) return [];
    const byProject = new Map<string, number>();
    for (const issue of issues) {
      const name = issue.project.name;
      byProject.set(name, (byProject.get(name) ?? 0) + parseInt(issue.count));
    }
    return Array.from(byProject.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [issues]);

  if (isLoading) {
    return <ChartSkeleton title="Errors by Project" />;
  }

  if (!data.length) {
    return <EmptyChart title="Errors by Project" />;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        Errors by Project (top 10)
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface ErrorsByLevelProps {
  issues: SentryIssue[] | undefined;
  isLoading: boolean;
}

export function ErrorsByLevelChart({ issues, isLoading }: ErrorsByLevelProps) {
  const data = useMemo(() => {
    if (!issues?.length) return [];
    const byLevel = new Map<string, number>();
    for (const issue of issues) {
      byLevel.set(
        issue.level,
        (byLevel.get(issue.level) ?? 0) + parseInt(issue.count)
      );
    }
    return Array.from(byLevel.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  }, [issues]);

  if (isLoading) {
    return <ChartSkeleton title="Error Breakdown by Level" />;
  }

  if (!data.length) {
    return <EmptyChart title="Error Breakdown by Level" />;
  }

  const levelColors: Record<string, string> = {
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
    fatal: "#dc2626",
    debug: "#6b7280",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        Error Breakdown by Level
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
            label={({ name, percent }) =>
              `${name} ${(percent * 100).toFixed(0)}%`
            }
          >
            {data.map((entry) => (
              <Cell
                key={entry.name}
                fill={levelColors[entry.name] ?? "#6b7280"}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        {title}
      </h3>
      <div className="h-[280px] flex flex-col gap-3 pt-4">
        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
        <div className="flex-1 rounded bg-muted/50 animate-pulse" />
      </div>
    </div>
  );
}

function EmptyChart({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-card-foreground mb-3">
        {title}
      </h3>
      <div className="h-[280px] flex items-center justify-center">
        <div className="text-sm text-muted-foreground">No data available</div>
      </div>
    </div>
  );
}
