import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  brandColor = "#625DF5",
}: EngagementChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
        No engagement data yet.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid
            stroke="#e5e7eb"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tickLine={false}
            axisLine={false}
            fontSize={12}
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={12}
            allowDecimals={false}
            width={32}
          />
          <Tooltip
            cursor={{ stroke: brandColor, strokeOpacity: 0.2 }}
            contentStyle={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(value) => formatDate(String(value))}
          />
          <Line
            type="monotone"
            dataKey="views"
            stroke={brandColor}
            strokeWidth={2}
            dot={false}
            name="Views"
          />
          <Line
            type="monotone"
            dataKey="reactions"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            name="Reactions"
          />
          <Line
            type="monotone"
            dataKey="comments"
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            name="Comments"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
