import { useT } from "@agent-native/core/client/i18n";
import { DATA_WIDGET_MAX_CHART_POINTS } from "@agent-native/core/data-widgets";
import { useId, useRef, useState, type PointerEvent } from "react";

import type { AgentChatDataChartLayout } from "../../../agentkit/react/data-chart-layout.js";
import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

const DEFAULT_COLORS: readonly [string, ...string[]] = [
  "hsl(var(--chart-1, var(--primary)))",
  "hsl(var(--chart-2, 199 89% 48%))",
  "hsl(var(--chart-3, 151 55% 42%))",
  "hsl(var(--chart-4, 35 92% 50%))",
];

function defaultColorAt(index: number): string {
  return DEFAULT_COLORS.at(index % DEFAULT_COLORS.length) ?? DEFAULT_COLORS[0];
}

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

type PieSlice = {
  label: string;
  value: number;
  color: string;
  startAngle: number;
  endAngle: number;
};

type ActiveBar = {
  key: string;
  categoryAxisTitle: string;
  category: string;
  valueAxisTitle: string;
  value: string;
  tooltipLines: TooltipLine[];
  x: number;
  y: number;
  width: number;
  tooltipPosition?: { x: number; y: number; side: "left" | "right" };
};

type TooltipLine = { key: string; label: string; value: string };

type DataChartTooltip = {
  enabled?: boolean;
  fields?: string[];
  includeAutomatic?: boolean;
};

type DataChartWithTooltip = DataChartWidgetData & {
  tooltip?: DataChartTooltip;
};

const PIE_CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const PIE_RADIUS = HEIGHT / 2 - 18;
const PIE_INNER_RADIUS = PIE_RADIUS * 0.55;

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
  if (Number.isInteger(value)) {
    return Math.abs(value) >= 1000 ? value.toLocaleString() : String(value);
  }
  if (Math.abs(value) >= 1000) return value.toLocaleString();
  return value.toFixed(1);
}

function formatValueLabel(value: number): string {
  if (Number.isInteger(value)) {
    return Math.abs(value) >= 1000 ? value.toLocaleString() : String(value);
  }
  return formatTick(value);
}

function formatTooltipField(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatValueLabel(value);
  }
  return null;
}

function tooltipLinesForBar(
  chart: DataChartWidgetData,
  row: Record<string, unknown>,
  seriesKey: string,
  categoryAxisTitle: string,
  category: string,
  valueAxisTitle: string,
  value: string,
): TooltipLine[] {
  const tooltip = (chart as DataChartWithTooltip).tooltip;
  const lines: TooltipLine[] = [];
  const includedFields = new Set<string>();

  if (tooltip?.includeAutomatic !== false) {
    lines.push(
      { key: chart.xKey, label: categoryAxisTitle, value: category },
      { key: seriesKey, label: valueAxisTitle, value },
    );
    includedFields.add(chart.xKey);
    includedFields.add(seriesKey);
  }

  for (const field of tooltip?.fields ?? []) {
    if (includedFields.has(field)) continue;
    const fieldValue = formatTooltipField(row[field]);
    if (fieldValue === null) continue;
    includedFields.add(field);
    lines.push({ key: field, label: field, value: fieldValue });
  }

  return lines;
}

function pieSlicesFor(chart: DataChartWidgetData): PieSlice[] {
  const series = chart.series.at(0);
  if (chart.series.length !== 1 || !series || chart.data.length === 0) {
    throw new Error(
      "Pie and donut charts require one series and at least one category",
    );
  }

  const categories = chart.data.map((row, index) => {
    const label = row[chart.xKey];
    const value = numericValue(row, series.key);
    if (
      typeof label !== "string" ||
      !label.trim() ||
      value === null ||
      value < 0
    ) {
      throw new Error(
        `Pie and donut category ${index + 1} needs a label and a non-negative finite value`,
      );
    }
    return { label, value };
  });

  const maxValue = Math.max(...categories.map(({ value }) => value));
  if (maxValue <= 0) {
    throw new Error(
      "Pie and donut charts require at least one positive category value",
    );
  }

  const weights = categories.map(({ value }) => value / maxValue);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const lastPositiveIndex = categories.reduce(
    (lastIndex, { value }, index) => (value > 0 ? index : lastIndex),
    -1,
  );
  const circleStart = -Math.PI / 2;
  let currentAngle = circleStart;

  return categories.map(({ label, value }, index) => {
    const startAngle = currentAngle;
    const endAngle =
      index === lastPositiveIndex
        ? circleStart + Math.PI * 2
        : startAngle + (value / maxValue / totalWeight) * Math.PI * 2;
    if (value > 0) currentAngle = endAngle;

    return {
      label,
      value,
      color: defaultColorAt(index),
      startAngle,
      endAngle,
    };
  });
}

function pointOnCircle(angle: number, radius: number) {
  return {
    x: PIE_CENTER.x + Math.cos(angle) * radius,
    y: PIE_CENTER.y + Math.sin(angle) * radius,
  };
}

function pieSlicePath(startAngle: number, endAngle: number): string {
  const start = pointOnCircle(startAngle, PIE_RADIUS);
  const end = pointOnCircle(endAngle, PIE_RADIUS);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${PIE_CENTER.x} ${PIE_CENTER.y} L ${start.x} ${start.y} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function formatAxisTick(
  value: number,
  interval: number,
  compactInteger: boolean,
): string {
  const [mantissa, exponent = "0"] = interval
    .toString()
    .toLowerCase()
    .split("e");
  const decimalPlaces = Math.max(
    0,
    (mantissa.split(".")[1]?.length ?? 0) - Number(exponent),
  );
  if (compactInteger && decimalPlaces === 1 && Number.isInteger(value)) {
    return Math.abs(value) >= 1000 ? value.toLocaleString() : String(value);
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    });
  }
  return value.toFixed(decimalPlaces);
}

function lineValueLabelY(
  pointY: number,
  valueLabelFontSize: number,
  plotTop: number,
): number {
  const minimumY = valueLabelFontSize;
  const maximumY = HEIGHT - valueLabelFontSize * 0.25;
  const fitsAbove = pointY - valueLabelFontSize - 5 >= plotTop;
  const fitsBelow = pointY + valueLabelFontSize + 5 <= maximumY;
  const labelY =
    fitsAbove || !fitsBelow ? pointY - 5 : pointY + valueLabelFontSize + 5;

  return Math.min(Math.max(labelY, minimumY), maximumY);
}

function inset(value: number | undefined, name: string, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `dataChartLayout.plotInsets.${name} must be a non-negative CSS length`,
    );
  }
  return value;
}

function plotAdjustment(value: number | undefined, name: string): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `dataChartLayout.horizontalPlotAdjustments.${name} must be finite`,
    );
  }
  return value;
}

function horizontalBarRadius(value: number | undefined): number {
  if (value === undefined) return 3;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "dataChartLayout.horizontalBarRadius must be a non-negative CSS length",
    );
  }
  return value;
}

function fontSize(value: number | undefined, name: string, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `dataChartLayout.${name} must be a positive CSS length`,
    );
  }
  return value;
}

function labelFor(value: unknown): string {
  const normalized =
    value === null ? "NULL" : value === undefined ? "" : String(value);
  const characters = Array.from(normalized);
  return characters.length > MAX_LABEL_LENGTH
    ? `${characters.slice(0, MAX_LABEL_LENGTH - 3).join("")}...`
    : characters.join("");
}

function scatterLegendFor(chart: DataChartWidgetData) {
  if (chart.type !== "scatter" || chart.colorByKey === undefined) return [];

  const categories = new Map<string, { label: string; color: string }>();
  for (const row of chart.data) {
    const value = row[chart.colorByKey];
    if (typeof value !== "string" || categories.has(value)) continue;
    categories.set(value, {
      label: labelFor(value),
      color: defaultColorAt(categories.size),
    });
  }
  return Array.from(categories, ([key, category]) => ({
    key,
    ...category,
  }));
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
  const label = formatValueLabel(value);
  return estimateTextWidth(label, fontSize) > maxWidth
    ? formatCompactTick(value, fontSize, maxWidth)
    : label;
}

function stackedSegmentsForRow(
  chart: DataChartWidgetData,
  row: Record<string, unknown>,
) {
  if (chart.stacking === "percent") {
    const values = chart.series.map((series) => numericValue(row, series.key));
    if (values.some((value) => value === null || value < 0)) {
      throw new Error(
        "Percent-stacked charts require complete non-negative series values",
      );
    }
    const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(
        "Percent-stacked charts require a positive finite category total",
      );
    }
    let start = 0;
    const segments = values.map((value, index) => {
      const amount = value ?? 0;
      const share =
        index === values.length - 1 ? 100 - start : (amount / total) * 100;
      const end = start + share;
      const segment = { value: amount, share, start, end };
      start = end;
      return segment;
    });
    return { segments, total: 100 };
  }

  let positiveTotal = 0;
  let negativeTotal = 0;
  const segments = chart.series.map((series) => {
    const value = numericValue(row, series.key);
    if (value === null) return null;
    const start = value >= 0 ? positiveTotal : negativeTotal;
    const end = start + value;
    if (!Number.isFinite(end)) {
      throw new Error("Stacked chart category totals must be finite");
    }
    if (value >= 0) positiveTotal = end;
    else negativeTotal = end;
    return { value, share: undefined, start, end };
  });
  const total = positiveTotal + negativeTotal;
  if (
    !Number.isFinite(total) ||
    !Number.isFinite(positiveTotal - negativeTotal)
  ) {
    throw new Error("Stacked chart category totals must be finite");
  }
  return { segments, total };
}

function rangeFor(chart: DataChartWidgetData) {
  const values =
    chart.stacking !== undefined
      ? chart.data.flatMap((row) =>
          stackedSegmentsForRow(chart, row).segments.flatMap((segment) =>
            segment ? [segment.start, segment.end] : [],
          ),
        )
      : chart.data.flatMap((row) =>
          chart.series
            .map((series) => numericValue(row, series.key))
            .filter((value): value is number => value !== null),
        );
  if (values.length === 0) return { min: 0, max: 1 };

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (
    chart.type === "bar" ||
    chart.type === "area" ||
    chart.type === "scatter" ||
    chart.type === "histogram"
  ) {
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
  layout,
  labelFontSize,
  pieSlices,
  activeBarKey,
  focusedBarKey,
  onBarHover,
  onBarLeave,
  onBarFocus,
  onBarBlur,
}: {
  chart: DataChartWidgetData;
  layout?: AgentChatDataChartLayout;
  labelFontSize: number;
  pieSlices?: PieSlice[];
  activeBarKey?: string;
  focusedBarKey?: string;
  onBarHover?: (bar: ActiveBar, event: PointerEvent<SVGRectElement>) => void;
  onBarLeave?: (key: string) => void;
  onBarFocus?: (bar: ActiveBar) => void;
  onBarBlur?: (key: string) => void;
}) {
  if (chart.type === "pie" || chart.type === "donut") {
    if (!pieSlices) {
      throw new Error(
        "Pie and donut chart data was not prepared for rendering",
      );
    }
    const activeSlices = pieSlices.filter(({ value }) => value > 0);
    const hasOneFullSlice = activeSlices.length === 1;

    return (
      <g>
        {pieSlices.map((slice, index) => {
          if (slice.value <= 0) return null;
          if (hasOneFullSlice) {
            return (
              <circle
                key={index}
                data-pie-slice="true"
                data-pie-category={slice.label}
                data-pie-value={slice.value}
                cx={PIE_CENTER.x}
                cy={PIE_CENTER.y}
                r={PIE_RADIUS}
                fill={slice.color}
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            );
          }
          return (
            <path
              key={index}
              data-pie-slice="true"
              data-pie-category={slice.label}
              data-pie-value={slice.value}
              d={pieSlicePath(slice.startAngle, slice.endAngle)}
              fill={slice.color}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            />
          );
        })}
        {chart.type === "donut" ? (
          <circle
            data-pie-hole="true"
            cx={PIE_CENTER.x}
            cy={PIE_CENTER.y}
            r={PIE_INNER_RADIUS}
            fill="hsl(var(--background))"
          />
        ) : null}
      </g>
    );
  }

  if (chart.type === "number") {
    const series = chart.series.at(0);
    const row = chart.data.at(0);
    const value = series && row ? numericValue(row, series.key) : null;
    if (
      chart.series.length !== 1 ||
      chart.data.length !== 1 ||
      !series ||
      value === null
    ) {
      throw new Error(
        "Number charts require exactly one series and one data point with a finite numeric value",
      );
    }

    return (
      <g>
        <text
          x={WIDTH / 2}
          y={HEIGHT / 2 - labelFontSize}
          fill="hsl(var(--foreground))"
          fontSize={Math.min(48, Math.max(32, labelFontSize * 3.5))}
          fontWeight={500}
          textAnchor="middle"
        >
          {formatValueLabel(value)}
        </text>
        <text
          x={WIDTH / 2}
          y={HEIGHT / 2 + labelFontSize * 2}
          fill={
            layout?.labelTone === "foreground"
              ? "hsl(var(--foreground))"
              : "hsl(var(--muted-foreground))"
          }
          fontSize={labelFontSize}
          textAnchor="middle"
        >
          {chart.title ?? series.label}
        </text>
      </g>
    );
  }

  const categoryGapRatio =
    chart.horizontalCategoryGapRatio ?? layout?.horizontalCategoryGapRatio;
  if (
    categoryGapRatio !== undefined &&
    (!Number.isFinite(categoryGapRatio) ||
      categoryGapRatio < 0 ||
      categoryGapRatio > 0.9)
  ) {
    throw new Error("Horizontal category gap ratio must be between 0 and 0.9");
  }
  const { min, max } = rangeFor(chart);
  const isHistogram = chart.type === "histogram";
  const isHorizontalBar = chart.type === "bar" && chart.layout === "horizontal";
  const isVerticalBar =
    isHistogram || (chart.type === "bar" && !isHorizontalBar);
  const isStackedBar = chart.type === "bar" && chart.stacking !== undefined;
  const isStackedHorizontalBar = isStackedBar && isHorizontalBar;
  const isStackedVerticalBar = isStackedBar && chart.layout === "vertical";
  const isStackedArea = chart.type === "area" && chart.stacking !== undefined;
  const hasStackedLayout =
    isStackedHorizontalBar ||
    isStackedVerticalBar ||
    (isStackedArea && chart.layout !== "horizontal");
  if (chart.stacking !== undefined && !hasStackedLayout) {
    throw new Error(
      "Stacking requires bar or area charts with a supported orientation",
    );
  }
  const cornerRadius = isHorizontalBar
    ? horizontalBarRadius(layout?.horizontalBarRadius)
    : 3;
  const tickInterval = chart.valueAxisTickInterval;
  const valueLabelFontSize = chart.valueLabelFontSize ?? 11;
  const defaultTickCount = chart.type === "scatter" ? 11 : 4;
  const gridTickValues =
    tickInterval === undefined
      ? Array.from(
          { length: defaultTickCount },
          (_, index) => min + ((max - min) * index) / (defaultTickCount - 1),
        )
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
  const categoryLabelX = categoryMargin - 5;
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
    const baseLabel =
      tickInterval === undefined
        ? formatTick(value)
        : formatAxisTick(value, tickInterval, layout !== undefined);
    const maximumWidth = isHorizontalBar
      ? horizontalTextWidthLimit
      : WIDTH - MARGIN.right - MIN_PLOT_WIDTH - verticalValueTickMargin;
    const label = chart.stacking === "percent" ? `${baseLabel}%` : baseLabel;
    if (estimateTextWidth(label, labelFontSize) <= maximumWidth) return label;
    const compact = formatCompactTick(value, labelFontSize, maximumWidth);
    return chart.stacking === "percent" ? `${compact}%` : compact;
  });
  const valueTickLabelWidth = Math.max(
    0,
    ...valueTickLabels.map((label) => estimateTextWidth(label, labelFontSize)),
  );
  const customValueTickLabelWidth = isHorizontalBar ? 0 : valueTickLabelWidth;
  const horizontalValueTickLabelInset = isHorizontalBar
    ? Math.ceil(valueTickLabelWidth / 2) + 2
    : 0;
  const minimumHorizontalTickBottom = isHorizontalBar
    ? 14 +
      labelFontSize * 0.25 +
      4 +
      (chart.xAxisTitle ? axisTitleFontSize * 0.8 + 6 : 0)
    : 0;
  const axisTitleBottomInset = chart.xAxisTitle ? 16 : 0;
  const minimumVerticalCategoryBottom =
    isHorizontalBar || layout?.plotInsets?.bottom === undefined
      ? 0
      : labelFontSize + 12 + (chart.xAxisTitle ? axisTitleFontSize + 2 : 0);
  const configuredTopInset = inset(layout?.plotInsets?.top, "top", MARGIN.top);
  const minimumVerticalValueLabelTop =
    isVerticalBar && chart.showValueLabels ? valueLabelFontSize + 5 : 0;
  const configuredBottomInset = inset(
    layout?.plotInsets?.bottom,
    "bottom",
    MARGIN.bottom,
  );
  const horizontalPlotAdjustments = isHorizontalBar
    ? layout?.horizontalPlotAdjustments
    : undefined;
  const plotLeftAdjustment = plotAdjustment(
    horizontalPlotAdjustments?.left,
    "left",
  );
  const plotRightAdjustment = plotAdjustment(
    horizontalPlotAdjustments?.right,
    "right",
  );
  const plotTopAdjustment = plotAdjustment(
    horizontalPlotAdjustments?.top,
    "top",
  );
  const plotBottomAdjustment = plotAdjustment(
    horizontalPlotAdjustments?.bottom,
    "bottom",
  );
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
  const verticalBarValueLabelInset =
    isVerticalBar && chart.showValueLabels
      ? Math.ceil(
          Math.max(
            0,
            ...chart.data.flatMap((row) =>
              chart.series
                .map((series) => numericValue(row, series.key))
                .filter((value): value is number => value !== null)
                .map((value) =>
                  estimateTextWidth(
                    formatValueLabel(value),
                    valueLabelFontSize,
                  ),
                ),
            ),
          ) / 2,
        ) + 4
      : 0;
  const margin = {
    ...MARGIN,
    top:
      Math.max(configuredTopInset, minimumVerticalValueLabelTop) +
      plotTopAdjustment,
    left:
      Math.max(
        categoryMargin,
        customValueTickWidth + verticalValueTickMargin,
        horizontalValueTickLabelInset,
      ) +
      (horizontalNegativeValueWidth > 0
        ? horizontalNegativeValueWidth + 13
        : 0) +
      plotLeftAdjustment,
    right:
      layout?.plotInsets?.right === undefined
        ? Math.max(
            MARGIN.right,
            horizontalPositiveValueWidth + 13,
            horizontalValueTickLabelInset,
            verticalBarValueLabelInset,
          ) + plotRightAdjustment
        : Math.max(
            inset(layout.plotInsets.right, "right", MARGIN.right),
            horizontalPositiveValueWidth > 0
              ? horizontalPositiveValueWidth + 13
              : 0,
            horizontalValueTickLabelInset,
            verticalBarValueLabelInset,
          ) + plotRightAdjustment,
    bottom:
      Math.max(
        configuredBottomInset,
        minimumHorizontalTickBottom - axisTitleBottomInset,
        minimumVerticalCategoryBottom - axisTitleBottomInset,
      ) +
      axisTitleBottomInset +
      plotBottomAdjustment,
  };
  if (
    horizontalPlotAdjustments &&
    (margin.left < 0 || margin.right < 0 || margin.top < 0 || margin.bottom < 0)
  ) {
    throw new RangeError(
      "dataChartLayout.horizontalPlotAdjustments must leave non-negative plot insets",
    );
  }
  const plotWidth = WIDTH - margin.left - margin.right;
  const plotHeight = HEIGHT - margin.top - margin.bottom;
  if (plotWidth <= 0 || plotHeight <= 0) {
    throw new RangeError(
      "dataChartLayout.plotInsets must leave a positive chart plot area",
    );
  }
  const labelColor =
    layout?.labelTone === "foreground"
      ? "hsl(var(--foreground))"
      : "hsl(var(--muted-foreground))";
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
  if (chart.type === "scatter") {
    const xValues = chart.data.map((row) => numericValue(row, chart.xKey));
    if (xValues.some((value) => value === null)) {
      throw new Error("Scatter charts require finite numeric X values");
    }
    const numericXValues = xValues.filter(
      (value): value is number => value !== null,
    );
    const xMin = Math.min(0, ...numericXValues) - 0.5;
    const xMax = Math.max(0, ...numericXValues) + 0.5;
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) {
      throw new Error("Scatter chart X range must be finite and positive");
    }
    const xForScatterValue = (value: number) =>
      margin.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
    const xTickCount = 9;
    const xTicks = Array.from(
      { length: xTickCount },
      (_, index) => xMin + ((xMax - xMin) * index) / (xTickCount - 1),
    );
    const categoryColors = new Map(
      scatterLegendFor(chart).map(({ key, color }) => [key, color]),
    );
    const yAxisTitle = chart.yAxisTitle ?? chart.series[0]?.label;
    return (
      <>
        <g aria-hidden="true">
          {gridTickValues.map((tick, index) => {
            const y = yForValue(tick);
            return (
              <g key={`y-${index}`}>
                <line
                  x1={margin.left}
                  x2={WIDTH - margin.right}
                  y1={y}
                  y2={y}
                  stroke="hsl(var(--chart-grid, var(--border)))"
                />
                <text
                  data-value-axis-tick="true"
                  x={margin.left - VALUE_AXIS_TICK_LABEL_INSET}
                  y={Math.min(
                    Math.max(y + 4, labelFontSize),
                    HEIGHT - labelFontSize * 0.25,
                  )}
                  fill={labelColor}
                  fontSize={labelFontSize}
                  textAnchor="end"
                >
                  {valueTickLabels[index]}
                </text>
              </g>
            );
          })}
          {xTicks.map((tick, index) => {
            const x = xForScatterValue(tick);
            return (
              <g key={`x-${index}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={margin.top}
                  y2={HEIGHT - margin.bottom}
                  stroke="hsl(var(--chart-grid, var(--border)))"
                />
                <text
                  data-scatter-x-tick="true"
                  x={x}
                  y={HEIGHT - margin.bottom + 14}
                  fill={labelColor}
                  fontSize={labelFontSize}
                  textAnchor="middle"
                >
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}
          <line
            x1={margin.left}
            x2={WIDTH - margin.right}
            y1={HEIGHT - margin.bottom}
            y2={HEIGHT - margin.bottom}
            stroke="hsl(var(--chart-grid, var(--border)))"
          />
          <line
            x1={margin.left}
            x2={margin.left}
            y1={margin.top}
            y2={HEIGHT - margin.bottom}
            stroke="hsl(var(--chart-grid, var(--border)))"
          />
          {chart.xAxisTitle ? (
            <text
              x={margin.left + plotWidth / 2}
              y={HEIGHT - 4}
              fill="hsl(var(--foreground))"
              fontSize={axisTitleFontSize}
              fontWeight={chart.axisTitleFontWeight ?? 500}
              textAnchor="middle"
            >
              {chart.xAxisTitle}
            </text>
          ) : null}
          {yAxisTitle ? (
            <text
              x={Y_AXIS_TITLE_X}
              y={margin.top + plotHeight / 2}
              transform={`rotate(-90 ${Y_AXIS_TITLE_X} ${margin.top + plotHeight / 2})`}
              fill="hsl(var(--foreground))"
              fontSize={axisTitleFontSize}
              fontWeight={chart.axisTitleFontWeight ?? 500}
              textAnchor="middle"
            >
              {yAxisTitle}
            </text>
          ) : null}
        </g>
        {chart.data.flatMap((row, rowIndex) => {
          const xValue = xValues[rowIndex];
          if (typeof xValue !== "number") return [];
          return chart.series.flatMap((series, seriesIndex) => {
            const yValue = numericValue(row, series.key);
            if (yValue === null) return [];
            const category =
              chart.colorByKey === undefined
                ? undefined
                : row[chart.colorByKey];
            const categoryLabel =
              typeof category === "string" ? labelFor(category) : undefined;
            const color =
              (typeof category === "string"
                ? categoryColors.get(category)
                : undefined) ??
              series.color ??
              defaultColorAt(seriesIndex);
            const xTitle = chart.xAxisTitle ?? chart.xKey;
            const pointLabel = [
              `${xTitle}: ${formatValueLabel(xValue)}`,
              `${series.label}: ${formatValueLabel(yValue)}`,
              categoryLabel === undefined
                ? undefined
                : `${chart.colorByKey}: ${categoryLabel}`,
            ]
              .filter((label): label is string => label !== undefined)
              .join(", ");
            return [
              <circle
                key={`${rowIndex}-${series.key}`}
                data-scatter-point="true"
                data-scatter-category={categoryLabel}
                data-scatter-x={xValue}
                data-scatter-y={yValue}
                cx={xForScatterValue(xValue)}
                cy={yForValue(yValue)}
                r={4}
                fill={color}
                stroke="hsl(var(--background))"
                strokeWidth={1.5}
                tabIndex={0}
                role="img"
                aria-label={pointLabel}
              />,
            ];
          });
        })}
      </>
    );
  }
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
  const valueLabelFontWeight = chart.valueLabelFontWeight ?? 400;
  const xAxisTitleY = HEIGHT - (isHorizontalBar ? 6 : 4);

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
                fill={labelColor}
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
                data-value-axis-tick="true"
                x={margin.left - VALUE_AXIS_TICK_LABEL_INSET}
                y={Math.min(
                  Math.max(tick.y + 4, labelFontSize),
                  HEIGHT - labelFontSize * 0.25,
                )}
                fill={labelColor}
                fontSize={labelFontSize}
                textAnchor="end"
              >
                {valueTickLabels[tick.index]}
              </text>
            ) : null}
          </g>
        ),
      )}
      {isHorizontalBar && layout?.horizontalCategoryGridlines
        ? chart.data.map((_, index) => {
            const y = yForRow(index);
            return (
              <line
                key={`category-${index}`}
                x1={margin.left}
                x2={WIDTH - margin.right}
                y1={y}
                y2={y}
                stroke="hsl(var(--chart-grid, var(--border)))"
              />
            );
          })
        : null}
      <line
        x1={isHorizontalBar ? zeroX : margin.left}
        x2={isHorizontalBar ? zeroX : WIDTH - margin.right}
        y1={isHorizontalBar ? margin.top : zeroY}
        y2={isHorizontalBar ? HEIGHT - margin.bottom : zeroY}
        stroke="hsl(var(--chart-grid, var(--border)))"
      />
      {chart.data.map((row, index) => {
        if (isHorizontalBar) {
          const label = labelFor(row[chart.xKey]);
          return (
            <text
              key={`${index}-${String(row[chart.xKey] ?? "")}`}
              x={categoryLabelX}
              y={yForRow(index) + labelFontSize * 0.35}
              fill={labelColor}
              fontSize={labelFontSize}
              textAnchor="end"
            >
              {label}
            </text>
          );
        }
        if (index % xTickEvery !== 0 && index !== chart.data.length - 1) {
          return null;
        }

        const label = labelFor(row[chart.xKey]);
        const categoryLabelY =
          layout?.plotInsets?.bottom === undefined
            ? HEIGHT - 12
            : chart.xAxisTitle
              ? HEIGHT - axisTitleFontSize - 12
              : Math.max(
                  HEIGHT - 12,
                  HEIGHT - margin.bottom + labelFontSize + 1,
                );
        const x =
          chart.type === "bar" || isHistogram
            ? margin.left + (index + 0.5) * (plotWidth / chart.data.length)
            : xForPoint(index);
        const labelHalfWidth = estimateTextWidth(label, labelFontSize) / 2;
        const leftEndpointOverflows = index === 0 && x - labelHalfWidth < 0;
        const rightEndpointOverflows =
          index === chart.data.length - 1 && x + labelHalfWidth > WIDTH;

        return (
          <text
            key={`${index}-${String(row[chart.xKey] ?? "")}`}
            x={x}
            y={categoryLabelY}
            fill={labelColor}
            fontSize={labelFontSize}
            textAnchor={
              leftEndpointOverflows
                ? "start"
                : rightEndpointOverflows
                  ? "end"
                  : "middle"
            }
          >
            {label}
          </text>
        );
      })}
      {chart.xAxisTitle ? (
        <text
          x={margin.left + plotWidth / 2}
          y={xAxisTitleY}
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

  if (chart.type === "bar" || isHistogram) {
    const slotSize =
      (isHorizontalBar ? plotHeight : plotWidth) /
      Math.max(1, chart.data.length);
    const groupSize =
      slotSize *
      (isHorizontalBar && categoryGapRatio !== undefined
        ? 1 - categoryGapRatio
        : 0.72);
    const isStacked = isStackedHorizontalBar || isStackedVerticalBar;
    const barSize = isStacked
      ? groupSize
      : groupSize / Math.max(1, chart.series.length);
    return (
      <>
        {axes}
        {chart.data.map((row, rowIndex) => {
          const stackedRow = isStacked
            ? stackedSegmentsForRow(chart, row)
            : undefined;
          return chart.series.map((series, seriesIndex) => {
            const segment = stackedRow?.segments[seriesIndex];
            const value = segment?.value ?? numericValue(row, series.key);
            if (value === null) return null;
            const color =
              series.color ??
              (isHorizontalBar && !isStackedHorizontalBar
                ? layout?.horizontalBarColor
                : undefined) ??
              DEFAULT_COLORS[seriesIndex % DEFAULT_COLORS.length];
            const startValue = segment?.start ?? 0;
            const endValue = segment?.end ?? value;
            const startX = xForValue(startValue);
            const valueX = xForValue(endValue);
            const valueY = yForValue(value);
            const startY = yForValue(startValue);
            const endY = yForValue(endValue);
            const x = isHorizontalBar
              ? Math.min(startX, valueX)
              : margin.left +
                rowIndex * slotSize +
                (slotSize - groupSize) / 2 +
                (isStackedVerticalBar ? 0 : seriesIndex * barSize);
            const y = isHorizontalBar
              ? margin.top +
                rowIndex * slotSize +
                (slotSize - groupSize) / 2 +
                (isStackedHorizontalBar ? 0 : seriesIndex * barSize)
              : isStackedVerticalBar
                ? Math.min(startY, endY)
                : yForValue(Math.max(value, 0));
            const width = isHorizontalBar
              ? isStackedHorizontalBar
                ? Math.abs(valueX - startX)
                : Math.max(2, Math.abs(valueX - zeroX))
              : Math.max(2, barSize - 2);
            const height = isHorizontalBar
              ? Math.max(0, barSize - Math.min(2, barSize * 0.1))
              : isStackedVerticalBar
                ? Math.abs(startY - endY)
                : Math.max(1, Math.abs(zeroY - valueY));
            const valueLabel =
              chart.stacking === "percent"
                ? `${formatValueLabel(segment?.share ?? 0)}%`
                : isHorizontalBar
                  ? formatHorizontalValueLabel(
                      value,
                      valueLabelFontSize,
                      horizontalTextWidthLimit,
                    )
                  : formatValueLabel(value);
            const valueLabelWidth = estimateTextWidth(
              valueLabel,
              valueLabelFontSize,
            );
            const valueLabelX =
              isHorizontalBar && value >= 0
                ? Math.min(valueX + 5, WIDTH - valueLabelWidth - 4)
                : valueX + (value < 0 ? -5 : 5);
            const barKey = `${rowIndex}-${series.key}`;
            const category = labelFor(row[chart.xKey]);
            const categoryAxisTitle = isHorizontalBar
              ? (chart.yAxisTitle ?? chart.xKey)
              : (chart.xAxisTitle ?? chart.xKey);
            const valueAxisTitle = isHorizontalBar
              ? (chart.xAxisTitle ?? series.label)
              : (chart.yAxisTitle ?? series.label);
            const stackedBarLabel = stackedRow
              ? chart.stacking === "percent"
                ? `${categoryAxisTitle}: ${category}, ${series.label}: ${formatValueLabel(value)} (${formatValueLabel(segment?.share ?? 0)}%), ${valueAxisTitle}: 100%`
                : `${categoryAxisTitle}: ${category}, ${series.label}: ${formatValueLabel(value)}, ${valueAxisTitle}: ${formatValueLabel(stackedRow.total)}`
              : undefined;
            const bar: ActiveBar = {
              key: barKey,
              categoryAxisTitle,
              category,
              valueAxisTitle,
              value: formatValueLabel(value),
              tooltipLines: tooltipLinesForBar(
                chart,
                row,
                series.key,
                categoryAxisTitle,
                category,
                valueAxisTitle,
                formatValueLabel(value),
              ),
              x,
              y,
              width,
            };
            const isActive = activeBarKey === barKey;
            return (
              <g key={`${rowIndex}-${series.key}`}>
                <rect
                  data-histogram-mark={isHistogram ? "true" : undefined}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  rx={isStacked ? 0 : cornerRadius}
                  fill={color}
                  opacity={activeBarKey && !isActive ? 0.3 : undefined}
                  stroke={
                    isActive && focusedBarKey === barKey
                      ? "hsl(var(--foreground))"
                      : undefined
                  }
                  strokeWidth={
                    isActive && focusedBarKey === barKey ? 2 : undefined
                  }
                  tabIndex={0}
                  role="img"
                  aria-label={
                    stackedBarLabel ??
                    (bar.tooltipLines.length > 0
                      ? bar.tooltipLines
                          .map(
                            ({ label, value: tooltipValue }) =>
                              `${label}: ${tooltipValue}`,
                          )
                          .join(", ")
                      : `${categoryAxisTitle}: ${category}, ${valueAxisTitle}: ${formatValueLabel(value)}`)
                  }
                  onPointerOver={(event) => onBarHover?.(bar, event)}
                  onPointerMove={(event) => onBarHover?.(bar, event)}
                  onPointerOut={() => onBarLeave?.(barKey)}
                  onFocus={() => onBarFocus?.(bar)}
                  onBlur={() => onBarBlur?.(barKey)}
                />
                {chart.showValueLabels ? (
                  <text
                    data-value-label="true"
                    x={isHorizontalBar ? valueLabelX : x + width / 2}
                    y={
                      isHorizontalBar
                        ? y + height / 2 + valueLabelFontSize * 0.35
                        : Math.max(valueLabelFontSize, y - 5)
                    }
                    fill={isHorizontalBar ? color : labelColor}
                    fontSize={valueLabelFontSize}
                    fontWeight={valueLabelFontWeight}
                    textAnchor={
                      isHorizontalBar ? (value < 0 ? "end" : "start") : "middle"
                    }
                  >
                    {valueLabel}
                  </text>
                ) : null}
              </g>
            );
          });
        })}
      </>
    );
  }

  const stackedAreaRows = isStackedArea
    ? chart.data.map((row) => stackedSegmentsForRow(chart, row))
    : undefined;
  const paths = chart.series.map((series, seriesIndex) => {
    const points = chart.data.flatMap((row, rowIndex) => {
      const value = numericValue(row, series.key);
      if (value === null) return [];
      const segment = stackedAreaRows?.[rowIndex]?.segments[seriesIndex];
      if (isStackedArea && !segment) {
        throw new Error("Stacked area results require complete series values");
      }
      const startValue = segment?.start ?? 0;
      const endValue = segment?.end ?? value;
      return [
        {
          x: xForPoint(rowIndex),
          y: yForValue(endValue),
          value,
          lowerY: yForValue(startValue),
          share: segment?.share,
        },
      ];
    });
    const color =
      series.color ?? DEFAULT_COLORS[seriesIndex % DEFAULT_COLORS.length];
    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
    const firstPoint = points.at(0);
    const lastPoint = points.at(-1);
    const areaPath =
      points.length === 0
        ? ""
        : isStackedArea
          ? `${linePath} ${[...points]
              .reverse()
              .map((point) => `L ${point.x} ${point.lowerY}`)
              .join(" ")} Z`
          : `${linePath} L ${lastPoint?.x ?? 0} ${zeroY} L ${firstPoint?.x ?? 0} ${zeroY} Z`;
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
            opacity={isStackedArea ? "1" : "0.18"}
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
                return (
                  <text
                    key={`value-${index}`}
                    data-value-label="true"
                    x={point.x}
                    y={lineValueLabelY(point.y, valueLabelFontSize, margin.top)}
                    fill={labelColor}
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
                    {chart.stacking === "percent" && point.share !== undefined
                      ? `${formatValueLabel(point.share)}%`
                      : formatValueLabel(point.value)}
                  </text>
                );
              })
            : null}
        </g>
      ))}
    </>
  );
}

export function DataChartRenderer({
  chart,
  layout,
}: {
  chart: DataChartWidgetData;
  layout?: AgentChatDataChartLayout;
}) {
  const t = useT();
  const tooltipId = useId();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [hoveredBar, setHoveredBar] = useState<ActiveBar | null>(null);
  const [focusedBar, setFocusedBar] = useState<ActiveBar | null>(null);
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
    layout?.labelFontFamily ??
    LABEL_FONT_FAMILIES[renderedChart.labelFontFamily ?? "sans"];
  const labelFontSize = fontSize(
    layout?.labelFontSize,
    "labelFontSize",
    renderedChart.labelFontSize ?? 11,
  );
  const isPieChart =
    renderedChart.type === "pie" || renderedChart.type === "donut";
  const pieSlices = isPieChart ? pieSlicesFor(renderedChart) : undefined;
  const numberSeries = renderedChart.series.at(0);
  const numberValue =
    renderedChart.type === "number" &&
    renderedChart.series.length === 1 &&
    numberSeries !== undefined
      ? numericValue(renderedChart.data[0] ?? {}, numberSeries.key)
      : null;
  const ariaLabel =
    renderedChart.type === "number" && numberValue !== null
      ? `${renderedChart.title ?? numberSeries?.label ?? ""}: ${formatValueLabel(numberValue)}`
      : (renderedChart.title ??
        (isPieChart ? renderedChart.series[0]?.label : undefined) ??
        t("agentChat.widget.dataChart"));
  const activeBar =
    renderedChart.type === "bar" || renderedChart.type === "histogram"
      ? (hoveredBar ?? focusedBar)
      : null;
  const hasStackedLegend = renderedChart.stacking !== undefined;
  const scatterLegend = scatterLegendFor(renderedChart);
  const tooltipEnabled =
    (renderedChart as DataChartWithTooltip).tooltip?.enabled !== false;
  const activeTooltipLines = tooltipEnabled
    ? (activeBar?.tooltipLines ?? [])
    : [];
  return (
    <div
      ref={chartContainerRef}
      className="relative box-border w-full min-w-0 overflow-hidden"
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
        aria-label={ariaLabel}
        aria-describedby={activeTooltipLines.length > 0 ? tooltipId : undefined}
      >
        <ChartBody
          chart={renderedChart}
          layout={layout}
          labelFontSize={labelFontSize}
          pieSlices={pieSlices}
          activeBarKey={activeBar?.key}
          focusedBarKey={hoveredBar ? undefined : focusedBar?.key}
          onBarHover={(bar, event) => {
            const bounds = chartContainerRef.current?.getBoundingClientRect();
            if (!bounds) {
              setHoveredBar(bar);
              return;
            }
            const x = event.clientX - bounds.left;
            const side = x > bounds.width * 0.38 ? "left" : "right";
            setHoveredBar({
              ...bar,
              tooltipPosition: {
                x: side === "left" ? x - 8 : x + 8,
                y: Math.max(
                  0,
                  Math.min(bounds.height - 56, event.clientY - bounds.top - 8),
                ),
                side,
              },
            });
          }}
          onBarLeave={(key) =>
            setHoveredBar((current) => (current?.key === key ? null : current))
          }
          onBarFocus={setFocusedBar}
          onBarBlur={(key) =>
            setFocusedBar((current) => (current?.key === key ? null : current))
          }
        />
      </svg>
      {hasStackedLegend || scatterLegend.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-3 text-xs text-muted-foreground">
          {(hasStackedLegend
            ? renderedChart.series.map((series, index) => ({
                key: series.key,
                label: series.label,
                color:
                  series.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length],
              }))
            : scatterLegend
          ).map(({ key, label, color }) => (
            <li key={key} className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[1px]"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 truncate">{label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {activeBar && activeTooltipLines.length > 0 ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[calc(100%-0.5rem)] rounded border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-5 text-popover-foreground shadow-sm"
          style={{
            left: activeBar.tooltipPosition
              ? `${activeBar.tooltipPosition.x}px`
              : `${Math.min(84, Math.max(1, ((activeBar.x + activeBar.width + 8) / WIDTH) * 100))}%`,
            top: activeBar.tooltipPosition
              ? `${activeBar.tooltipPosition.y}px`
              : `${Math.min(90, Math.max(4, (activeBar.y / HEIGHT) * 100))}%`,
            transform:
              activeBar.tooltipPosition?.side === "left"
                ? "translateX(-100%)"
                : undefined,
          }}
        >
          {activeTooltipLines.map(({ key, label, value }) => (
            <div key={key}>
              {label}: {value}
            </div>
          ))}
        </div>
      ) : null}
      {pieSlices ? (
        <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {pieSlices.map((slice, index) => (
            <li
              key={index}
              data-pie-category={slice.label}
              data-pie-value={slice.value}
              className="flex min-w-0 items-center gap-2 text-xs"
            >
              <svg
                aria-hidden="true"
                className="size-3 shrink-0"
                viewBox="0 0 12 12"
              >
                <circle cx="6" cy="6" r="5" fill={slice.color} />
              </svg>
              <span className="min-w-0 flex-1 truncate">{slice.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatValueLabel(slice.value)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
