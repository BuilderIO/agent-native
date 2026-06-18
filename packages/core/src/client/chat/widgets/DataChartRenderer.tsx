import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

const DEFAULT_COLORS = [
  "hsl(var(--primary))",
  "hsl(199 89% 48%)",
  "hsl(151 55% 42%)",
  "hsl(35 92% 50%)",
];

const WIDTH = 640;
const HEIGHT = 240;
const MARGIN = { top: 14, right: 18, bottom: 34, left: 46 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

function numericValue(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString();
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function labelFor(value: unknown): string {
  const label = value == null ? "" : String(value);
  return label.length > 16 ? `${label.slice(0, 15)}...` : label;
}

function rangeFor(chart: DataChartWidgetData) {
  const values = chart.data.flatMap((row) =>
    chart.series
      .map((series) => numericValue(row, series.key))
      .filter((value): value is number => value !== null),
  );
  if (values.length === 0) return { min: 0, max: 1 };

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (chart.type === "bar" || chart.type === "area") {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const pad = Math.abs(max || 1) * 0.2;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

function ChartBody({ chart }: { chart: DataChartWidgetData }) {
  const { min, max } = rangeFor(chart);
  const yFor = (value: number) =>
    MARGIN.top + ((max - value) / (max - min)) * PLOT_HEIGHT;
  const xForPoint = (index: number) =>
    chart.data.length <= 1
      ? MARGIN.left + PLOT_WIDTH / 2
      : MARGIN.left + (index / (chart.data.length - 1)) * PLOT_WIDTH;
  const gridTicks = Array.from({ length: 4 }, (_, index) => {
    const value = min + ((max - min) * index) / 3;
    return { value, y: yFor(value) };
  });
  const xTickEvery = Math.max(1, Math.ceil(chart.data.length / 6));
  const zeroY = yFor(Math.max(min, Math.min(max, 0)));

  const axes = (
    <g aria-hidden="true">
      {gridTicks.map((tick) => (
        <g key={tick.y}>
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={tick.y}
            y2={tick.y}
            stroke="hsl(var(--border))"
            strokeDasharray="3 3"
          />
          <text
            x={MARGIN.left - 8}
            y={tick.y + 4}
            fill="hsl(var(--muted-foreground))"
            fontSize="11"
            textAnchor="end"
          >
            {formatTick(tick.value)}
          </text>
        </g>
      ))}
      <line
        x1={MARGIN.left}
        x2={WIDTH - MARGIN.right}
        y1={zeroY}
        y2={zeroY}
        stroke="hsl(var(--border))"
      />
      {chart.data.map((row, index) =>
        index % xTickEvery === 0 || index === chart.data.length - 1 ? (
          <text
            key={`${index}-${String(row[chart.xKey] ?? "")}`}
            x={
              chart.type === "bar"
                ? MARGIN.left + (index + 0.5) * (PLOT_WIDTH / chart.data.length)
                : xForPoint(index)
            }
            y={HEIGHT - 12}
            fill="hsl(var(--muted-foreground))"
            fontSize="11"
            textAnchor="middle"
          >
            {labelFor(row[chart.xKey])}
          </text>
        ) : null,
      )}
    </g>
  );

  if (chart.type === "bar") {
    const slotWidth = PLOT_WIDTH / Math.max(1, chart.data.length);
    const groupWidth = slotWidth * 0.72;
    const barWidth = groupWidth / Math.max(1, chart.series.length);
    return (
      <>
        {axes}
        {chart.data.map((row, rowIndex) =>
          chart.series.map((series, seriesIndex) => {
            const value = numericValue(row, series.key);
            if (value === null) return null;
            const color =
              series.color ??
              DEFAULT_COLORS[seriesIndex % DEFAULT_COLORS.length];
            const y = yFor(Math.max(value, 0));
            const height = Math.max(1, Math.abs(zeroY - yFor(value)));
            return (
              <rect
                key={`${rowIndex}-${series.key}`}
                x={
                  MARGIN.left +
                  rowIndex * slotWidth +
                  (slotWidth - groupWidth) / 2 +
                  seriesIndex * barWidth
                }
                y={y}
                width={Math.max(2, barWidth - 2)}
                height={height}
                rx="3"
                fill={color}
              />
            );
          }),
        )}
      </>
    );
  }

  const paths = chart.series.map((series, seriesIndex) => {
    const points = chart.data
      .map((row, rowIndex) => {
        const value = numericValue(row, series.key);
        return value === null
          ? null
          : { x: xForPoint(rowIndex), y: yFor(value) };
      })
      .filter((point): point is { x: number; y: number } => point !== null);
    const color =
      series.color ?? DEFAULT_COLORS[seriesIndex % DEFAULT_COLORS.length];
    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
    const areaPath =
      points.length > 0
        ? `${linePath} L ${points[points.length - 1].x} ${zeroY} L ${points[0].x} ${zeroY} Z`
        : "";
    return { series, color, linePath, areaPath, points };
  });

  return (
    <>
      {axes}
      {paths.map(({ series, color, areaPath }) =>
        chart.type === "area" && areaPath ? (
          <path
            key={series.key}
            d={areaPath}
            fill={color}
            opacity="0.18"
            stroke="none"
          />
        ) : null,
      )}
      {paths.map(({ series, color, linePath, points }) => (
        <g key={series.key}>
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r="3"
              fill="hsl(var(--background))"
              stroke={color}
              strokeWidth="2"
            />
          ))}
        </g>
      ))}
    </>
  );
}

export function DataChartRenderer({ chart }: { chart: DataChartWidgetData }) {
  return (
    <div className="h-60 w-full min-w-0 overflow-hidden">
      <svg
        className="agent-data-chart-renderer h-full w-full"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={chart.title ?? "Data chart"}
        preserveAspectRatio="none"
      >
        <ChartBody chart={chart} />
      </svg>
    </div>
  );
}
