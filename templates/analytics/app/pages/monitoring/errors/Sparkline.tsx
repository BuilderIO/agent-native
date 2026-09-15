import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

/**
 * Tiny inline volume sparkline for an issue row. Purely decorative — no axes,
 * tooltip, or interaction — so it stays legible at ~100x28px.
 */
export function Sparkline({
  data,
  className,
  color = "hsl(var(--primary))",
}: {
  data: number[];
  className?: string;
  color?: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const points = (data.length ? data : [0]).map((value, index) => ({
    index,
    value: Number.isFinite(value) ? value : 0,
  }));
  const hasVolume = points.some((point) => point.value > 0);

  return (
    <div
      className={className}
      aria-hidden="true"
      style={{ width: 96, height: 28 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            strokeOpacity={hasVolume ? 1 : 0.35}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
