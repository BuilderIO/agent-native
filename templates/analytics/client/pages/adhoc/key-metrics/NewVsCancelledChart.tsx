import { useMemo } from "react";
import {
  LineChart,
  Line,
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

interface NewVsCancelledChartProps {
  rows: Record<string, unknown>[];
  isLoading: boolean;
  error?: string;
  onEditSql?: () => void;
}

export function NewVsCancelledChart({ rows, isLoading, error, onEditSql }: NewVsCancelledChartProps) {
  const data = useMemo(() => {
    // Transform from long format (date, event_type, count) to wide format (date, cancelled, new_sub)
    const byDate = new Map<string, { period: string; cancelled: number; new_sub: number }>();
    
    rows.forEach((r) => {
      const period = String(r.period ?? "");
      const eventType = String(r.event_type ?? "");
      const count = Number(r.count ?? 0);
      
      if (!byDate.has(period)) {
        byDate.set(period, { period, cancelled: 0, new_sub: 0 });
      }
      
      const entry = byDate.get(period)!;
      if (eventType === "subscription plan cancelled") {
        entry.cancelled = count;
      } else if (eventType === "new subscription - payment success") {
        entry.new_sub = count;
      }
    });
    
    return Array.from(byDate.values()).sort((a, b) => a.period.localeCompare(b.period));
  }, [rows]);

  const formatY = (v: number) => {
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return String(v);
  };

  // Calculate KPI stats
  const kpiStats = useMemo(() => {
    if (data.length < 2) return null;
    
    const latest = data[data.length - 1];
    const baseline = data[0];
    
    const cancelledChange = baseline.cancelled > 0 
      ? ((latest.cancelled - baseline.cancelled) / baseline.cancelled) * 100 
      : 0;
    const newSubChange = baseline.new_sub > 0 
      ? ((latest.new_sub - baseline.new_sub) / baseline.new_sub) * 100 
      : 0;
    
    return {
      cancelled: latest.cancelled,
      cancelledChange,
      newSub: latest.new_sub,
      newSubChange,
      baselineDate: baseline.period,
    };
  }, [data]);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">
              New sub plans vs cancelled plans daily
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last 90 Days • Totals
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
              <span className="text-muted-foreground">Cancelled: </span>
              <span className="font-semibold">{kpiStats.cancelled}</span>
              <span className={`ml-1.5 ${kpiStats.cancelledChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {kpiStats.cancelledChange >= 0 ? '↑' : '↓'} {Math.abs(kpiStats.cancelledChange).toFixed(1)}%
              </span>
              <span className="text-muted-foreground text-[10px] ml-1">
                from {formatDate(kpiStats.baselineDate)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">New subs: </span>
              <span className="font-semibold">{kpiStats.newSub}</span>
              <span className={`ml-1.5 ${kpiStats.newSubChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {kpiStats.newSubChange >= 0 ? '↑' : '↓'} {Math.abs(kpiStats.newSubChange).toFixed(1)}%
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
          <p className="text-sm text-muted-foreground py-4 text-center">No data</p>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
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
                    v,
                    name === "cancelled" ? "subscription plan cancelled" : "new subscription - payment success"
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="cancelled"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="new_sub"
                  stroke="#84cc16"
                  strokeWidth={2}
                  dot={false}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: "11px", color: "#a1a1aa", paddingTop: "12px" }}
                  formatter={(value) => 
                    value === "cancelled" 
                      ? "subscription plan cancelled" 
                      : "new subscription - payment success"
                  }
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
