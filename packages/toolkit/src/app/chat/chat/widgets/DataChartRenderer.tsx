import { useT } from "@agent-native/core/client/i18n";
import { DATA_WIDGET_MAX_CHART_POINTS } from "@agent-native/core/data-widgets";

import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

const DEFAULT_COLORS = [
  "hsl(var(--chart-1, var(--primary)))",
  "hsl(var(--chart-2, 199 89% 48%))",
  "hsl(var(--chart-3, 151 55% 42%))",
  "hsl(var(--chart-4, 35 92% 50%))",
];

const WIDTH = 640;
const HEIGHT = 360;
const MARGIN = { top: 14, right: 18, bottom: 34, left: 46 };
const Y_AXIS_TITLE_X = 14;
const VALUE_AXIS_TICK_LABEL_INSET = 8;
const VALUE_AXIS_TITLE_TICK_GAP = 8;
const MAX_LABEL_LENGTH = 16;
const MIN_PLOT_WIDTH = 32;
const LABEL_FONT_FAMILIES = {
  sans: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
  serif: "ui-serif, Georgia, Cambria, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

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

function formatAxisTick(value: number, interval: number): string {
  const [mantissa, exponent = "0"] = interval
    .toString()
    .toLowerCase()
    .split("e");
  const decimalPlaces = Math.max(
    0,
    (mantissa.split(".")[1]?.length ?? 0) - Number(exponent),
  );
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    });
  }
  return value.toFixed(decimalPlaces);
}

function labelFor(value: unknown): string {
  const characters = Array.from(value == null ? "" : String(value));
  return characters.length > MAX_LABEL_LENGTH
    ? `${characters.slice(0, MAX_LABEL_LENGTH - 3).join("")}...`
    : characters.join("");
}

function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return width + (codePoint >= 0x2e80 ? fontSize : fontSize * 0.65);
  }, 0);
}

function formatCompactTick(
  value: number,
  fontSize: number,
  maxWidth: number,
): string {
  for (let fractionDigits = 15; fractionDigits >= 0; fractionDigits -= 1) {
    const [mantissa = "0", exponent = "0"] = value
      .toExponential(fractionDigits)
      .split("e");
    const label = `${mantissa.replace(/\.?0+$/, "")}e${exponent}`;
    if (estimateTextWidth(label, fontSize) <= maxWidth) return label;
  }
  return value.toExponential(0);
}

function maximumHorizontalLabelWidth(
  categoryMargin: number,
  includeValueLabels: boolean,
): number {
  let lower = 0;
  let upper = WIDTH;
  while (lower < upper) {
    const candidate = Math.ceil((lower + upper) / 2);
    const axisInset = Math.ceil(candidate / 2) + 2;
    const valueLabelInset = includeValueLabels ? candidate + 13 : 0;
    const leftMargin = Math.max(categoryMargin, axisInset) + valueLabelInset;
    const rightMargin = Math.max(MARGIN.right, axisInset, valueLabelInset);
    if (WIDTH - leftMargin - rightMargin >= MIN_PLOT_WIDTH) {
      lower = candidate;
    } else {
      upper = candidate - 1;
    }
  }
  return lower;
}

function formatHorizontalValueLabel(
  value: number,
  fontSize: number,
  maxWidth: number,
): string {
  const label = formatTick(value);
  return estimateTextWidth(label, fontSize) > maxWidth
    ? formatCompactTick(value, fontSize, maxWidth)
    : label;
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

function ChartBody({
  chart,
  labelFontSize,
}: {
  chart: DataChartWidgetData;
  labelFontSize: number;
}) {
  const categoryGapRatio = chart.horizontalCategoryGapRatio;
  if (
    categoryGapRatio !== undefined &&
    (!Number.isFinite(categoryGapRatio) ||
      categoryGapRatio < 0 ||
      categoryGapRatio > 0.9)
  ) {
    throw new Error("Horizontal category gap ratio must be between 0 and 0.9");
  }
  const { min, max } = rangeFor(chart);
  const isHorizontalBar = chart.type === "bar" && chart.layout === "horizontal";
  const tickInterval = chart.valueAxisTickInterval;
  const gridTickValues =
    tickInterval === undefined
      ? Array.from({ length: 4 }, (_, index) => min + ((max - min) * index) / 3)
      : (() => {
          if (!Number.isFinite(tickInterval) || tickInterval < 1e-12) {
            throw new Error(
              "Chart value-axis interval must be finite and positive",
            );
          }
          if (!Number.isFinite(max - min)) {
            throw new Error("Chart value-axis range must be finite");
          }
          const firstTick = Math.ceil(min / tickInterval - 1e-9);
          const lastTick = Math.floor(max / tickInterval + 1e-9);
          const tickCount = lastTick - firstTick + 1;
          if (
            !Number.isSafeInteger(firstTick) ||
            !Number.isSafeInteger(lastTick) ||
            !Number.isSafeInteger(tickCount) ||
            tickCount <= 0 ||
            tickCount > 100
          ) {
            throw new Error("Chart value-axis interval exceeds the tick limit");
          }
          return Array.from(
            { length: tickCount },
            (_, index) => (firstTick + index) * tickInterval,
          );
        })();
  const axisTitleFontSize = chart.axisTitleFontSize ?? 11;
  const horizontalCategoryWidth = isHorizontalBar
    ? Math.max(
        0,
        ...chart.data.map((row) =>
          estimateTextWidth(labelFor(row[chart.xKey]), labelFontSize),
        ),
      )
    : 0;
  const categoryMargin =
    Math.max(MARGIN.left, horizontalCategoryWidth + 14) +
    (chart.yAxisTitle ? 20 : 0);
  const categoryLabelX = categoryMargin - 8;
  const horizontalTextWidthLimit = isHorizontalBar
    ? maximumHorizontalLabelWidth(
        categoryMargin,
        Boolean(chart.showValueLabels),
      )
    : 0;
  const verticalValueTickMargin = isHorizontalBar
    ? 0
    : chart.yAxisTitle
      ? Y_AXIS_TITLE_X +
        axisTitleFontSize / 2 +
        VALUE_AXIS_TITLE_TICK_GAP +
        VALUE_AXIS_TICK_LABEL_INSET
      : VALUE_AXIS_TICK_LABEL_INSET * 2;
  const valueTickLabels = gridTickValues.map((value) => {
    const label =
      tickInterval === undefined
        ? formatTick(value)
        : formatAxisTick(value, tickInterval);
    const maximumWidth = isHorizontalBar
      ? horizontalTextWidthLimit
      : WIDTH - MARGIN.right - MIN_PLOT_WIDTH - verticalValueTickMargin;
    return estimateTextWidth(label, labelFontSize) > maximumWidth
      ? formatCompactTick(value, labelFontSize, maximumWidth)
      : label;
  });
  const valueTickLabelWidth = Math.max(
    0,
    ...valueTickLabels.map((label) => estimateTextWidth(label, labelFontSize)),
  );
  const customValueTickLabelWidth = isHorizontalBar ? 0 : valueTickLabelWidth;
  const horizontalValueTickLabelInset = isHorizontalBar
    ? Math.ceil(valueTickLabelWidth / 2) + 2
    : 0;
  const customValueTickWidth = isHorizontalBar ? 0 : customValueTickLabelWidth;
  const horizontalPositiveValueWidth =
    isHorizontalBar && chart.showValueLabels
      ? Math.max(
          0,
          ...chart.data.flatMap((row) =>
            chart.series
              .map((series) => numericValue(row, series.key))
              .filter((value): value is number => value !== null && value >= 0)
              .map((value) =>
                estimateTextWidth(
                  formatHorizontalValueLabel(
                    value,
                    chart.valueLabelFontSize ?? 11,
                    horizontalTextWidthLimit,
                  ),
                  chart.valueLabelFontSize ?? 11,
                ),
              ),
          ),
        )
      : 0;
  const horizontalNegativeValueWidth =
    isHorizontalBar && chart.showValueLabels
      ? Math.max(
          0,
          ...chart.data.flatMap((row) =>
            chart.series
              .map((series) => numericValue(row, series.key))
              .filter((value): value is number => value !== null && value < 0)
              .map((value) =>
                estimateTextWidth(
                  formatHorizontalValueLabel(
                    value,
                    chart.valueLabelFontSize ?? 11,
                    horizontalTextWidthLimit,
                  ),
                  chart.valueLabelFontSize ?? 11,
                ),
              ),
          ),
        )
      : 0;
  const margin = {
    ...MARGIN,
    left:
      Math.max(
        categoryMargin,
        customValueTickWidth + verticalValueTickMargin,
        horizontalValueTickLabelInset,
      ) +
      (horizontalNegativeValueWidth > 0
        ? horizontalNegativeValueWidth + 13
        : 0),
    right: Math.max(
      MARGIN.right,
      horizontalPositiveValueWidth + 13,
      horizontalValueTickLabelInset,
    ),
    bottom: MARGIN.bottom + (chart.xAxisTitle ? 16 : 0),
  };
  const plotWidth = WIDTH - margin.left - margin.right;
  const plotHeight = HEIGHT - margin.top - margin.bottom;
  const xForValue = (value: number) =>
    margin.left + ((value - min) / (max - min)) * plotWidth;
  const yForValue = (value: number) =>
    margin.top + ((max - value) / (max - min)) * plotHeight;
  const xForPoint = (index: number) =>
    chart.data.length <= 1
      ? margin.left + plotWidth / 2
      : margin.left + (index / (chart.data.length - 1)) * plotWidth;
  const yForRow = (index: number) =>
    margin.top + ((index + 0.5) * plotHeight) / Math.max(1, chart.data.length);
  const axisLabelMinSpacing = isHorizontalBar
    ? valueTickLabelWidth + 8
    : labelFontSize + 4;
  const visibleAxisLabelCount = Math.max(
    1,
    Math.floor(
      (isHorizontalBar ? plotWidth : plotHeight) / axisLabelMinSpacing,
    ) + 1,
  );
  const axisLabelStride = Math.max(
    1,
    Math.ceil(
      (gridTickValues.length - 1) / Math.max(1, visibleAxisLabelCount - 1),
    ),
  );
  const axisLabelIndexes = new Set(
    gridTickValues.flatMap((_, index) =>
      index % axisLabelStride === 0 &&
      (visibleAxisLabelCount > 1 || index === 0)
        ? [index]
        : [],
    ),
  );
  const finalAxisLabelIndex = gridTickValues.length - 1;
  if (
    visibleAxisLabelCount > 1 &&
    finalAxisLabelIndex >= 0 &&
    !axisLabelIndexes.has(finalAxisLabelIndex)
  ) {
    if (isHorizontalBar) {
      axisLabelIndexes.add(finalAxisLabelIndex);
    } else {
      const precedingAxisLabelIndex =
        Math.floor(finalAxisLabelIndex / axisLabelStride) * axisLabelStride;
      const tickSpacing = plotHeight / Math.max(1, finalAxisLabelIndex);
      const finalLabelSpacing =
        (finalAxisLabelIndex - precedingAxisLabelIndex) * tickSpacing;
      if (finalLabelSpacing < axisLabelMinSpacing) {
        axisLabelIndexes.delete(precedingAxisLabelIndex);
      }
      axisLabelIndexes.add(finalAxisLabelIndex);
    }
  }
  const axisLabelPosition = (index: number) =>
    isHorizontalBar
      ? xForValue(gridTickValues[index]!)
      : yForValue(gridTickValues[index]!);
  while (true) {
    const selectedAxisLabelIndexes = [...axisLabelIndexes].sort(
      (first, second) => first - second,
    );
    const crowdedPair = selectedAxisLabelIndexes.findIndex(
      (currentIndex, position) => {
        if (position === 0) return false;
        const precedingIndex = selectedAxisLabelIndexes[position - 1]!;
        const centerSpacing = Math.abs(
          axisLabelPosition(currentIndex) - axisLabelPosition(precedingIndex),
        );
        const requiredSpacing = isHorizontalBar
          ? (estimateTextWidth(valueTickLabels[currentIndex]!, labelFontSize) +
              estimateTextWidth(
                valueTickLabels[precedingIndex]!,
                labelFontSize,
              )) /
              2 +
            8
          : labelFontSize + 4;
        return centerSpacing < requiredSpacing;
      },
    );
    if (crowdedPair < 0) break;
    const precedingIndex = selectedAxisLabelIndexes[crowdedPair - 1]!;
    const currentIndex = selectedAxisLabelIndexes[crowdedPair]!;
    axisLabelIndexes.delete(
      currentIndex === finalAxisLabelIndex ? precedingIndex : currentIndex,
    );
  }
  const gridTicks = gridTickValues.map((value, index) => ({
    value,
    index,
    x: xForValue(value),
    y: yForValue(value),
  }));
  const xTickEvery = Math.max(1, Math.ceil(chart.data.length / 6));
  const zero = Math.max(min, Math.min(max, 0));
  const zeroX = xForValue(zero);
  const zeroY = yForValue(zero);
  const axisTitleFontWeight = chart.axisTitleFontWeight ?? 500;
  const valueLabelFontSize = chart.valueLabelFontSize ?? 11;
  const valueLabelFontWeight = chart.valueLabelFontWeight ?? 400;

  const axes = (
    <g aria-hidden="true">
      {gridTicks.map((tick) =>
        isHorizontalBar ? (
          <g key={tick.x}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={margin.top}
              y2={HEIGHT - margin.bottom}
              stroke="hsl(var(--chart-grid, var(--border)))"
              strokeDasharray={tickInterval === undefined ? "3 3" : undefined}
            />
            {axisLabelIndexes.has(tick.index) ? (
              <text
                x={tick.x}
                y={HEIGHT - margin.bottom + 14}
                fill="hsl(var(--muted-foreground))"
                fontSize={labelFontSize}
                textAnchor="middle"
              >
                {valueTickLabels[tick.index]}
              </text>
            ) : null}
          </g>
        ) : (
          <g key={tick.y}>
            <line
              x1={margin.left}
              x2={WIDTH - margin.right}
              y1={tick.y}
              y2={tick.y}
              stroke="hsl(var(--chart-grid, var(--border)))"
              strokeDasharray={tickInterval === undefined ? "3 3" : undefined}
            />
            {axisLabelIndexes.has(tick.index) ? (
              <text
                x={margin.left - VALUE_AXIS_TICK_LABEL_INSET}
                y={tick.y + 4}
                fill="hsl(var(--muted-foreground))"
                fontSize={labelFontSize}
                textAnchor="end"
              >
                {valueTickLabels[tick.index]}
              </text>
            ) : null}
          </g>
        ),
      )}
      <line
        x1={isHorizontalBar ? zeroX : margin.left}
        x2={isHorizontalBar ? zeroX : WIDTH - margin.right}
        y1={isHorizontalBar ? margin.top : zeroY}
        y2={isHorizontalBar ? HEIGHT - margin.bottom : zeroY}
        stroke="hsl(var(--chart-grid, var(--border)))"
      />
      {chart.data.map((row, index) =>
        isHorizontalBar ? (
          <text
            key={`${index}-${String(row[chart.xKey] ?? "")}`}
            x={categoryLabelX}
            y={yForRow(index) + labelFontSize * 0.35}
            fill="hsl(var(--muted-foreground))"
            fontSize={labelFontSize}
            textAnchor="end"
          >
            {labelFor(row[chart.xKey])}
          </text>
        ) : index % xTickEvery === 0 || index === chart.data.length - 1 ? (
          <text
            key={`${index}-${String(row[chart.xKey] ?? "")}`}
            x={
              chart.type === "bar"
                ? margin.left + (index + 0.5) * (plotWidth / chart.data.length)
                : xForPoint(index)
            }
            y={HEIGHT - 12}
            fill="hsl(var(--muted-foreground))"
            fontSize={labelFontSize}
            textAnchor="middle"
          >
            {labelFor(row[chart.xKey])}
          </text>
        ) : null,
      )}
      {chart.xAxisTitle ? (
        <text
          x={margin.left + plotWidth / 2}
          y={HEIGHT - 4}
          fill="hsl(var(--foreground))"
          fontSize={axisTitleFontSize}
          fontWeight={axisTitleFontWeight}
          textAnchor="middle"
        >
          {chart.xAxisTitle}
        </text>
      ) : null}
      {chart.yAxisTitle ? (
        <text
          x={Y_AXIS_TITLE_X}
          y={margin.top + plotHeight / 2}
          transform={`rotate(-90 ${Y_AXIS_TITLE_X} ${margin.top + plotHeight / 2})`}
          fill="hsl(var(--foreground))"
          fontSize={axisTitleFontSize}
          fontWeight={axisTitleFontWeight}
          textAnchor="middle"
        >
          {chart.yAxisTitle}
        </text>
      ) : null}
    </g>
  );

  if (chart.type === "bar") {
    const slotSize =
      (isHorizontalBar ? plotHeight : plotWidth) /
      Math.max(1, chart.data.length);
    const groupSize =
      slotSize *
      (isHorizontalBar && categoryGapRatio !== undefined
        ? 1 - categoryGapRatio
        : 0.72);
    const barSize = groupSize / Math.max(1, chart.series.length);
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
            const valueX = xForValue(value);
            const valueY = yForValue(value);
            const x = isHorizontalBar
              ? Math.min(zeroX, valueX)
              : margin.left +
                rowIndex * slotSize +
                (slotSize - groupSize) / 2 +
                seriesIndex * barSize;
            const y = isHorizontalBar
              ? margin.top +
                rowIndex * slotSize +
                (slotSize - groupSize) / 2 +
                seriesIndex * barSize
              : yForValue(Math.max(value, 0));
            const width = isHorizontalBar
              ? Math.max(2, Math.abs(valueX - zeroX))
              : Math.max(2, barSize - 2);
            const height = isHorizontalBar
              ? Math.max(0, barSize - Math.min(2, barSize * 0.1))
              : Math.max(1, Math.abs(zeroY - valueY));
            return (
              <g key={`${rowIndex}-${series.key}`}>
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  rx="3"
                  fill={color}
                />
                {chart.showValueLabels ? (
                  <text
                    x={
                      isHorizontalBar
                        ? valueX + (value < 0 ? -5 : 5)
                        : x + width / 2
                    }
                    y={
                      isHorizontalBar
                        ? y + height / 2 + valueLabelFontSize * 0.35
                        : y - 5
                    }
                    fill="hsl(var(--muted-foreground))"
                    fontSize={valueLabelFontSize}
                    fontWeight={valueLabelFontWeight}
                    textAnchor={
                      isHorizontalBar ? (value < 0 ? "end" : "start") : "middle"
                    }
                  >
                    {isHorizontalBar
                      ? formatHorizontalValueLabel(
                          value,
                          valueLabelFontSize,
                          horizontalTextWidthLimit,
                        )
                      : formatTick(value)}
                  </text>
                ) : null}
              </g>
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
          : { x: xForPoint(rowIndex), y: yForValue(value), value };
      })
      .filter(
        (point): point is { x: number; y: number; value: number } =>
          point !== null,
      );
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
          {chart.showValueLabels
            ? points.map((point, index) => {
                const abovePoint =
                  point.y - valueLabelFontSize - 5 >= margin.top;
                return (
                  <text
                    key={`value-${index}`}
                    x={point.x}
                    y={
                      abovePoint
                        ? point.y - 5
                        : point.y + valueLabelFontSize + 5
                    }
                    fill="hsl(var(--muted-foreground))"
                    fontSize={valueLabelFontSize}
                    fontWeight={valueLabelFontWeight}
                    textAnchor={
                      point.x <= margin.left
                        ? "start"
                        : point.x >= WIDTH - margin.right
                          ? "end"
                          : "middle"
                    }
                  >
                    {formatTick(point.value)}
                  </text>
                );
              })
            : null}
        </g>
      ))}
    </>
  );
}

export function DataChartRenderer({ chart }: { chart: DataChartWidgetData }) {
  const t = useT();
  const renderedChart =
    chart.data.length > DATA_WIDGET_MAX_CHART_POINTS
      ? {
          ...chart,
          data: chart.data.slice(0, DATA_WIDGET_MAX_CHART_POINTS),
        }
      : chart;
  const contentHeight = renderedChart.contentHeight;
  const contentPadding = renderedChart.contentPadding ?? 0;
  const hasContentBox = contentHeight !== undefined || contentPadding > 0;
  const labelFontFamily =
    LABEL_FONT_FAMILIES[renderedChart.labelFontFamily ?? "sans"];
  const labelFontSize = renderedChart.labelFontSize ?? 11;
  return (
    <div
      className="box-border w-full min-w-0 overflow-hidden"
      style={
        hasContentBox
          ? {
              ...(contentHeight !== undefined
                ? { height: `${contentHeight}px` }
                : {}),
              padding: `${contentPadding}px`,
            }
          : undefined
      }
    >
      <svg
        className={`agent-data-chart-renderer block w-full ${contentHeight !== undefined ? "h-full" : "h-auto"}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio={contentHeight !== undefined ? "none" : undefined}
        fontFamily={labelFontFamily}
        role="img"
        aria-label={renderedChart.title ?? t("agentChat.widget.dataChart")}
      >
        <ChartBody chart={renderedChart} labelFontSize={labelFontSize} />
      </svg>
    </div>
  );
}
