import { useMemo } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Code } from "lucide-react";
import { formatDate } from "../product-kpis/types";

interface SiteTrafficChartProps {
  title?: string;
  rows: Record<string, unknown>[];
  isLoading: boolean;
  error?: string;
  onEditSql?: () => void;
}

export function SiteTrafficChart({
  title = "Site traffic",
  rows,
  isLoading,
  error,
  onEditSql,
}: SiteTrafficChartProps) {
  const data = useMemo(() => {
    return rows.map((r) => ({
      period: String(r.period ?? ""),
      not_blog: Number(r.not_blog ?? 0),
      blog: Number(r.blog ?? 0),
    }));
  }, [rows]);

  const formatY = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return String(v);
  };

  // Calculate KPI stats (current vs baseline)
  const kpiStats = useMemo(() => {
    if (data.length < 2) return null;

    const latest = data[data.length - 1];
    const baseline = data[0];

    const notBlogChange =
      baseline.not_blog > 0
        ? ((latest.not_blog - baseline.not_blog) / baseline.not_blog) * 100
        : 0;
    const blogChange =
      baseline.blog > 0
        ? ((latest.blog - baseline.blog) / baseline.blog) * 100
        : 0;

    return {
      notBlog: latest.not_blog,
      notBlogChange,
      blog: latest.blog,
      blogChange,
      baselineDate: baseline.period,
    };
  }, [data]);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last 90 Days • Uniques
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/80 font-medium px-2 py-0.5 bg-muted rounded">
              Builder
            </span>
            {onEditSql && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onEditSql}
                className="h-7 w-7 p-0"
                title="Edit SQL Query"
              >
                <Code className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {kpiStats && (
          <div className="flex gap-4 mt-3 text-xs">
            <div>
              <span className="text-muted-foreground">Not blog: </span>
              <span className="font-semibold">{formatY(kpiStats.notBlog)}</span>
              <span
                className={`ml-1.5 ${kpiStats.notBlogChange >= 0 ? "text-green-500" : "text-red-500"}`}
              >
                {kpiStats.notBlogChange >= 0 ? "↑" : "↓"}{" "}
                {Math.abs(kpiStats.notBlogChange).toFixed(1)}%
              </span>
              <span className="text-muted-foreground text-[10px] ml-1">
                from {formatDate(kpiStats.baselineDate)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Blog: </span>
              <span className="font-semibold">{formatY(kpiStats.blog)}</span>
              <span
                className={`ml-1.5 ${kpiStats.blogChange >= 0 ? "text-green-500" : "text-red-500"}`}
              >
                {kpiStats.blogChange >= 0 ? "↑" : "↓"}{" "}
                {Math.abs(kpiStats.blogChange).toFixed(1)}%
              </span>
              <span className="text-muted-foreground text-[10px] ml-1">
                from {formatDate(kpiStats.baselineDate)}
              </span>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No data
          </p>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient
                    id="grad-not-blog"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="grad-blog" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#84cc16" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#84cc16" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
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
                  tickFormatter={formatDate}
                />
                <YAxis
                  stroke="#52525b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatY}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(255,255,255,0.15)" }}
                  contentStyle={{
                    backgroundColor: "#09090b",
                    border: "1px solid #27272a",
                    borderRadius: "8px",
                    color: "#fafafa",
                    fontSize: "12px",
                  }}
                  labelFormatter={formatDate}
                  formatter={(v: number, name: string) => [
                    formatY(v),
                    name === "not_blog" ? "Not blog" : "Blog",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="not_blog"
                  stackId="1"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#grad-not-blog)"
                />
                <Area
                  type="monotone"
                  dataKey="blog"
                  stackId="1"
                  stroke="#84cc16"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#grad-blog)"
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{
                    fontSize: "11px",
                    color: "#a1a1aa",
                    paddingTop: "12px",
                  }}
                  formatter={(value) =>
                    value === "not_blog" ? "Not blog" : "Blog"
                  }
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
