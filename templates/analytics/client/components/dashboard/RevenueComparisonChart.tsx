import { Link } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";

interface RevenueComparisonChartProps {
  title: string;
  data: {
    day: string;
    revenue_in: number;
    churn_out: number;
    net: number;
  }[];
  isLoading?: boolean;
  error?: string;
  sql?: string;
}

const formatCurrency = (value: number) =>
  `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const formatDate = (value: string) => {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-[#09090b] px-3 py-2 text-xs text-foreground shadow-lg">
      <p className="mb-1 font-medium">{formatDate(label)}</p>
      {payload.map((entry: any) => (
        <p
          key={entry.dataKey}
          style={{ color: entry.color }}
          className="flex items-center gap-2"
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function RevenueComparisonChart({
  title,
  data,
  isLoading,
  error,
  sql,
}: RevenueComparisonChartProps) {
  // Flip churn_out to negative for display
  const chartData = data.map((d) => ({
    ...d,
    churn_out_display: -d.churn_out,
  }));

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {sql && (
          <Link
            to={`/query?sql=${encodeURIComponent(sql)}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Query
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[400px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 py-8 text-center">{error}</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No data available
          </p>
        ) : (
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#27272a"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  stroke="#52525b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatDate}
                />
                <YAxis
                  stroke="#52525b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => {
                    const abs = Math.abs(v);
                    if (abs >= 1000) return `$${(v / 1000).toFixed(0)}k`;
                    return `$${v}`;
                  }}
                />
                <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                />
                <Bar
                  dataKey="revenue_in"
                  name="Revenue In (ARR)"
                  fill="#10b981"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={40}
                />
                <Bar
                  dataKey="churn_out_display"
                  name="Churn Out (ARR)"
                  fill="#ef4444"
                  radius={[0, 0, 3, 3]}
                  maxBarSize={40}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
