import { useT } from "@agent-native/core/client/i18n";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import {
  useCallback,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type SVGProps,
} from "react";

import { getCachedNumberFormat } from "@/lib/intl-cache";
import type { ChartMark, ChartSpec } from "@/lib/model/contracts";

import { chartBucketFormatter, type ChartEncoding } from "./chart-config";
import { FunnelOutcomes } from "./FunnelOutcomes";
import { formatCellValue } from "./utils";

import "./notebook.css";

export type ChartDrawingProps = {
  columns: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>;
  mark: ChartMark;
  orientation?: ChartSpec["orientation"];
  stackMode?: ChartSpec["stackMode"];
  binCount?: ChartSpec["binCount"];
  funnelOutcomes?: ChartSpec["funnelOutcomes"];
  encoding?: ChartEncoding | undefined;
  stacked?: boolean | undefined;
  colors?: readonly string[] | undefined;
  yFormatter?: "number" | "percent" | undefined;
  seriesLabels?: Record<string, string> | undefined;
  legend?: boolean | undefined;
  tooltipChannels?: boolean | undefined;
  onMarkClick?: ((mark: { x: string; series: string }) => void) | undefined;
  points?: readonly ChartPoint[] | undefined;
  onMarkSelect?: ((point: ChartPoint, target: SVGElement) => void) | undefined;
  title?: string | null;
  height?: number;
  loading?: boolean;
};

export type ChartPoint = {
  rowIndex: number;
  seriesIndex: number;
  value: number;
};

const TICK_COUNT = 5;
const BAR_RADIUS = 3;

function precise(value: number) {
  return Number(value.toPrecision(12));
}

function digitCount(value: number) {
  return value === 0 ? 1 : Math.floor(Math.log10(Math.abs(value))) + 1;
}

/** A round step near `rough`: 1, 1.5, 2, 2.5 … times a power of ten. */
function roundStep(rough: number, correction: number) {
  if (!(rough > 0)) return 0;
  const digits = digitCount(rough);
  const magnitude = 10 ** digits;
  const unit = digits !== 1 ? 0.05 : 0.1;
  return precise(
    (Math.ceil(precise(rough / magnitude / unit)) + correction) *
      unit *
      magnitude,
  );
}

function niceSteps(
  min: number,
  max: number,
  count: number,
  correction = 0,
): { step: number; low: number; high: number } {
  const step = roundStep((max - min) / (count - 1), correction);
  if (!(step > 0)) return { step: 0, low: min, high: max };
  let middle = 0;
  if (min > 0 || max < 0) {
    const centre = (min + max) / 2;
    middle = precise(centre - (centre % step));
  }
  let below = Math.ceil(precise((middle - min) / step));
  let above = Math.ceil(precise((max - middle) / step));
  const used = below + above + 1;
  if (used > count) return niceSteps(min, max, count, correction + 1);
  if (used < count) {
    if (max > 0) above += count - used;
    else below += count - used;
  }
  return {
    step,
    low: precise(middle - below * step),
    high: precise(middle + above * step),
  };
}

/**
 * Evenly spaced round axis ticks covering [min, max] and zero, the way the
 * reference charts choose them: 0–557 gives 0, 150, 300, 450, 600.
 */
export function niceTicks(
  min: number,
  max: number,
  count = TICK_COUNT,
): number[] {
  let low = Math.min(min, 0);
  let high = Math.max(max, 0);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0];
  if (low === high) high = low + 1;
  const result = niceSteps(low, high, Math.max(count, 2));
  if (!(result.step > 0)) return [low, high];
  low = result.low;
  const ticks: number[] = [];
  for (let value = low; value <= result.high + result.step / 2; ) {
    ticks.push(precise(value));
    value = precise(value + result.step);
  }
  return ticks;
}

/** Axis and tooltip values: grouped numbers, or two-decimal percentages. */
export function formatChartValue(
  value: number,
  formatter?: "number" | "percent",
  locale = "en-US",
): string {
  if (formatter === "percent") {
    const percent = value <= 1 && value >= -1 ? value * 100 : value;
    return `${percent.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`;
  }
  return value.toLocaleString(locale);
}

const CALENDAR_DAY =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function calendarDay(value: string): Date | null {
  const match = CALENDAR_DAY.exec(value.trim());
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026-08-24" → "Aug 24". */
export function formatDayLabel(value: string, locale = "en-US"): string | null {
  const date = calendarDay(value);
  return date
    ? date.toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;
}

type Point = readonly [number, number];

function endSlope(points: readonly Point[], index: number, tangent: number) {
  const [x0, y0] = points[index]!;
  const [x1, y1] = points[index + 1]!;
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - tangent) / 2 : tangent;
}

/**
 * Cubic segments through `points` that never overshoot between two values
 * (monotone in x, after Fritsch and Carlson), continuing a path that already
 * stands on the first point.
 */
function monotoneSegments(points: readonly Point[]): string {
  const n = points.length;
  if (n < 2) return "";
  if (n === 2) return ` L ${points[1]![0]} ${points[1]![1]}`;
  const tangents: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    const h0 = x1 - x0;
    const h1 = x2 - x1;
    const s0 = h0 ? (y1 - y0) / h0 : 0;
    const s1 = h1 ? (y2 - y1) / h1 : 0;
    const p = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
    tangents[i] =
      (Math.sign(s0) + Math.sign(s1)) *
        Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  tangents[0] = endSlope(points, 0, tangents[1]!);
  tangents[n - 1] = endSlope(points, n - 2, tangents[n - 2]!);
  let path = "";
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const dx = (x1 - x0) / 3;
    path += ` C ${x0 + dx} ${y0 + dx * tangents[i]!} ${x1 - dx} ${y1 - dx * tangents[i + 1]!} ${x1} ${y1}`;
  }
  return path;
}

/** A smooth monotone path through `points`. */
export function monotonePath(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return "";
  return `M ${first[0]} ${first[1]}${points.length === 1 ? "" : monotoneSegments(points)}`;
}

function pointList(points: readonly Point[]) {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

/** A bar with its far corners (away from the baseline) rounded. */
function roundedBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  roundTop: boolean,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  if (r === 0) return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
  return roundTop
    ? `M ${x} ${y + height} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + width - r} Q ${x + width} ${y} ${x + width} ${y + r} V ${y + height} Z`
    : `M ${x} ${y} H ${x + width} V ${y + height - r} Q ${x + width} ${y + height} ${x + width - r} ${y + height} H ${x + r} Q ${x} ${y + height} ${x} ${y + height - r} Z`;
}

/**
 * A chart is drawn as a chart, not as the table it was built from: the category
 * column is the first column and the value column is the first numeric one
 * unless the cell's own configuration names others. The drawing uses plain SVG
 * so a chart cell needs no extra dependency, and a chart with nothing usable to
 * plot falls back to the table with its columns named, so an empty result still
 * says what came back.
 */
export function ChartDrawing({
  columns,
  rows,
  mark,
  funnelOutcomes,
  encoding,
  stacked,
  colors,
  yFormatter,
  seriesLabels,
  legend,
  tooltipChannels = true,
  onMarkClick,
  points,
  onMarkSelect,
  title,
  height = 260,
  loading = false,
}: ChartDrawingProps) {
  const t = useT();
  const locale = useReaderLocale();
  const [width, setWidth] = useState(640);
  const measureSvg = useCallback((svg: SVGSVGElement | null) => {
    if (!svg) return;
    const measure = (nextWidth: number) => {
      if (nextWidth > 0) setWidth(nextWidth);
    };
    measure(svg.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  const aggregateEncoding =
    encoding?.aggregation == null ? undefined : encoding;
  const timeUnit = encoding?.timeUnit;
  const dateFormatter =
    timeUnit == null ? null : chartBucketFormatter(timeUnit, locale, t);
  if (mark === "funnel" && funnelOutcomes) {
    return (
      <FunnelOutcomes
        columns={columns}
        rows={rows}
        binding={funnelOutcomes}
        colors={colors}
        seriesLabels={seriesLabels}
        onMarkClick={onMarkClick}
      />
    );
  }
  const rawCategories = rows.map((row) => formatCellValue(row[0] ?? null));
  const datedAxis =
    dateFormatter == null &&
    rawCategories.some((value) => value !== "") &&
    rawCategories.every((value) => value === "" || calendarDay(value) !== null);
  const categories = rows.map((row, index) => {
    if (dateFormatter && typeof row[0] === "number")
      return dateFormatter(row[0]);
    const value = rawCategories[index] ?? "";
    if (value === "") return String(index + 1);
    if (seriesLabels && Object.hasOwn(seriesLabels, value))
      return seriesLabels[value] ?? value;
    return (datedAxis ? formatDayLabel(value, locale) : null) ?? value;
  });
  const allSeries: ChartPoint[][] = columns.slice(1).map(() => []);
  const chartPoints =
    points ??
    rows.flatMap((row, rowIndex) =>
      row
        .slice(1)
        .flatMap((value, seriesIndex) =>
          typeof value === "number" ? [{ rowIndex, seriesIndex, value }] : [],
        ),
    );
  for (const point of chartPoints) allSeries[point.seriesIndex]?.push(point);
  const firstPointByRow = new Map<number, ChartPoint>();
  for (const point of chartPoints) {
    if (!firstPointByRow.has(point.rowIndex)) {
      firstPointByRow.set(point.rowIndex, point);
    }
  }
  const values = rows.map((row, rowIndex) => {
    const numeric = row.find(
      (value, index): value is number => index > 0 && typeof value === "number",
    );
    return numeric ?? firstPointByRow.get(rowIndex)?.value ?? null;
  });
  const plottable = (
    mark === "sankey" ? values : chartPoints.map(({ value }) => value)
  ).filter((value): value is number => value !== null);
  if (plottable.length === 0) {
    return (
      <div
        className={`nb-output${loading ? " is-loading" : ""}`}
        aria-busy={loading || undefined}
      >
        <div className="nb-table-scroll">
          <table className="nb-table">
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={`${column}-${index}`} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((value, columnIndex) => (
                    <td key={columnIndex}>{formatCellValue(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const label = (name: string) =>
    seriesLabels && Object.hasOwn(seriesLabels, name)
      ? (seriesLabels[name] ?? name)
      : name;
  const formatValue = (value: number) =>
    formatChartValue(value, yFormatter, locale);
  const seriesColor = (index: number) => {
    if (!encoding)
      return colors?.[index] ?? `hsl(var(--chart-${(index % 5) + 1}))`;
    const colorIndex = encoding.colorIndices?.[index] ?? index;
    return colors?.[colorIndex] ?? `var(--nb-tableau-${(colorIndex % 10) + 1})`;
  };
  const seriesStyle = (index: number): CSSProperties =>
    ({
      "--nb-series-color": seriesColor(index),
    }) as CSSProperties;
  const firstInteractivePoint =
    mark === "pie"
      ? chartPoints.find(({ value }) => value > 0)
      : chartPoints[0];
  const markInteraction = (point: ChartPoint): MarkInteraction => {
    if (!onMarkClick && !onMarkSelect) return {};
    const { rowIndex, seriesIndex, value } = point;
    const activate = (target: SVGElement) => {
      if (onMarkSelect) {
        onMarkSelect(point, target);
        return;
      }
      const x = rows[rowIndex]?.[0];
      onMarkClick?.({
        x:
          timeUnit != null && typeof x === "number"
            ? new Date(x).toISOString()
            : String(x ?? ""),
        series: columns[seriesIndex + 1] ?? "",
      });
    };
    return {
      role: "button" as const,
      "aria-label": pointTooltip(rowIndex, seriesIndex, value),
      "data-chart-mark": "",
      tabIndex: !onMarkSelect || point === firstInteractivePoint ? 0 : -1,
      onFocus: (event: FocusEvent<SVGElement>) => {
        if (!onMarkSelect) return;
        const target = event.currentTarget;
        target.ownerSVGElement
          ?.querySelector('[data-chart-mark][tabindex="0"]')
          ?.setAttribute("tabindex", "-1");
        target.setAttribute("tabindex", "0");
      },
      onClick: (event: MouseEvent<SVGElement>) => activate(event.currentTarget),
      onKeyDown: (event: KeyboardEvent<SVGElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          activate(event.currentTarget);
        } else if (
          onMarkSelect &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          const target = event.currentTarget;
          const marks = Array.from(
            target.ownerSVGElement?.querySelectorAll<SVGElement>(
              "[data-chart-mark]",
            ) ?? [],
          );
          const move =
            event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
          marks[
            (marks.length + marks.indexOf(target) + move) % marks.length
          ]?.focus();
        }
      },
    };
  };
  const isStacked =
    mark === "area" ? stacked !== false : mark === "bar" && stacked === true;
  const stacks = new Map<ChartPoint, { base: number; top: number }>();
  const positiveTotals = new Map<number, number>();
  const negativeTotals = new Map<number, number>();
  if (isStacked) {
    for (const point of allSeries.flat()) {
      const totals = point.value < 0 ? negativeTotals : positiveTotals;
      const base = totals.get(point.rowIndex) ?? 0;
      const top = base + point.value;
      totals.set(point.rowIndex, top);
      stacks.set(point, { base, top });
    }
  }
  const topmost = new Map<number, { positive: number; negative: number }>();
  for (const point of allSeries.flat()) {
    const end = topmost.get(point.rowIndex) ?? { positive: -1, negative: -1 };
    if (point.value >= 0) end.positive = point.seriesIndex;
    else end.negative = point.seriesIndex;
    topmost.set(point.rowIndex, end);
  }
  const bounds = isStacked
    ? [...positiveTotals.values(), ...negativeTotals.values()]
    : plottable;
  const ticks = niceTicks(Math.min(...bounds), Math.max(...bounds));
  const min = Math.min(...ticks);
  const max = Math.max(...ticks);
  const magnitude = Math.max(-min, max);
  const tickFormatter = getCachedNumberFormat(locale, {
    style: yFormatter === "percent" ? "percent" : "decimal",
    notation:
      magnitude >= 1e12 || (magnitude > 0 && magnitude < 0.001)
        ? "scientific"
        : "standard",
    maximumSignificantDigits: 12,
  });
  const tickLabels = ticks.map((value) => ({
    value,
    text: tickFormatter.format(value),
  }));
  const labelWidth = Math.max(...tickLabels.map(({ text }) => text.length)) * 7;
  const padding = {
    top: 16,
    right: aggregateEncoding ? 26 : 16,
    bottom: aggregateEncoding ? 46 : 34,
    left: aggregateEncoding ? 34 + labelWidth : Math.max(56, 12 + labelWidth),
  };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;
  const span = max - min || 1;
  const scale = (value: number) =>
    padding.top + plotHeight - ((value - min) / span) * plotHeight;
  const zeroY = scale(0);
  const slot = plotWidth / Math.max(rows.length, 1);
  const start = Number(rows[0]?.[0]);
  const end = Number(rows.at(-1)?.[0]);
  const temporalInset = mark === "bar" ? slot / 2 : 0;
  const centre = (index: number) =>
    timeUnit == null
      ? padding.left + slot * index + slot / 2
      : padding.left +
        (end === start
          ? plotWidth / 2
          : temporalInset +
            (plotWidth - 2 * temporalInset) *
              ((Number(rows[index]?.[0]) - start) / (end - start)));
  const barSlot =
    timeUnit == null
      ? slot
      : rows.slice(1).reduce((shortest, _, index) => {
          const gap = centre(index + 1) - centre(index);
          return gap > 0 ? Math.min(shortest, gap) : shortest;
        }, slot);
  const xTickIndices = chartTickIndices(
    rows.length,
    centre,
    aggregateEncoding ? 98 : Math.max(60, plotWidth / 5),
  );
  const fieldLabel = (field: string, operation: string | null) =>
    operation == null
      ? field
      : t("chartAxis.fieldOperation", { field, operation });
  const xTitle = fieldLabel(
    columns[0] ?? "",
    timeUnit == null || timeUnit === "none"
      ? null
      : t(`chartAxis.timeUnits.${timeUnit}`),
  );
  const aggregation = encoding?.aggregation;
  const measureTitle = (field: string) =>
    encoding?.countRecords
      ? t("chartData.countRecords")
      : fieldLabel(
          field,
          aggregation == null || aggregation === "none"
            ? null
            : t(`chartAxis.aggregations.${aggregation}`),
        );
  const yTitle = encoding
    ? [
        ...new Set(encoding.measures.map(({ field }) => measureTitle(field))),
      ].join(", ")
    : (columns[1] ?? t("notebook.chartValueLabel"));
  const pointTooltip = (
    rowIndex: number,
    seriesIndex: number,
    value: number,
  ) => {
    const measure = aggregateEncoding?.measures[seriesIndex];
    if (!aggregateEncoding || !measure) {
      const series =
        allSeries.length > 1 || mark !== "bar"
          ? ` — ${label(columns[seriesIndex + 1] ?? "")}`
          : "";
      return `${categories[rowIndex]}${series}: ${formatValue(value)}`;
    }
    const fields = [
      t("chartAxis.tooltipField", {
        label: xTitle,
        value: categories[rowIndex] ?? "",
      }),
      t("chartAxis.tooltipField", {
        label: measureTitle(measure.field),
        value: formatValue(value),
      }),
    ];
    if (aggregateEncoding.colorField)
      fields.push(
        t("chartAxis.tooltipField", {
          label: aggregateEncoding.colorField,
          value: formatCellValue(measure.colorValue),
        }),
      );
    return fields.join("\n");
  };
  const caption =
    title != null && title.trim() !== ""
      ? title
      : t("notebook.chartCaption", {
          measure: yTitle,
          category: xTitle || t("notebook.chartCategoryLabel"),
        });
  if (mark === "funnel") {
    const stageHeight = 44;
    const funnelHeight = Math.max(stageHeight, rows.length * stageHeight);
    const first = values[0] ?? 0;
    const largest = Math.max(...values.map((value) => value ?? 0), 1);
    return (
      <div
        className={`nb-output nb-chart nb-chart-mark-funnel${loading ? " is-loading" : ""}`}
        aria-busy={loading || undefined}
      >
        <svg
          className="nb-chart-svg"
          width={width}
          ref={measureSvg}
          style={{ height: funnelHeight }}
          viewBox={`0 0 ${width} ${funnelHeight}`}
          role={onMarkSelect ? "group" : "img"}
          aria-label={caption}
        >
          {values.map((value, index) => {
            if (value === null) return null;
            const previous = index > 0 ? values[index - 1] : null;
            const ofFirst = first > 0 ? (value / first) * 100 : 0;
            const drop =
              previous != null && previous > 0
                ? ((previous - value) / previous) * 100
                : null;
            const share = value > 0 ? Math.max(0.02, value / largest) : 0;
            const summary = `${formatValue(value)} · ${ofFirst.toFixed(1)}%${
              drop === null
                ? ""
                : ` · ${drop < 0 ? "↑" : "↓"} ${Math.abs(drop).toFixed(1)}%`
            }`;
            const y = index * stageHeight;
            return (
              <g
                key={index}
                data-funnel-stage={categories[index]}
                aria-label={`${categories[index]}: ${summary}`}
              >
                <text className="nb-chart-ticks" x={0} y={y + 12}>
                  {categories[index]}
                </text>
                <text
                  className="nb-chart-ticks"
                  x={width}
                  y={y + 12}
                  textAnchor="end"
                >
                  {summary}
                </text>
                <rect
                  x={0}
                  y={y + 18}
                  width={width}
                  height={20}
                  rx={2}
                  fill="currentColor"
                  fillOpacity={0.1}
                />
                <rect
                  className="nb-chart-bar nb-chart-funnel-stage"
                  {...markInteraction(
                    firstPointByRow.get(index) ?? {
                      rowIndex: index,
                      seriesIndex: 0,
                      value,
                    },
                  )}
                  style={seriesStyle(index)}
                  x={0}
                  y={y + 18}
                  width={share * width}
                  height={20}
                  rx={2}
                >
                  {tooltipChannels ? (
                    <title>{pointTooltip(index, 0, value)}</title>
                  ) : null}
                </rect>
              </g>
            );
          })}
        </svg>
        <div className="nb-chart-caption">{caption}</div>
      </div>
    );
  }

  if (mark === "sankey") {
    const links = rows.flatMap((row, index) => {
      const value = row[2];
      return typeof row[0] === "string" &&
        typeof row[1] === "string" &&
        typeof value === "number" &&
        value > 0
        ? [{ source: row[0], target: row[1], value, index }]
        : [];
    });
    const sources = [...new Set(links.map((link) => link.source))];
    const targets = [...new Set(links.map((link) => link.target))];
    const leftNode = (width * 150) / 640;
    const rightNode = width - leftNode;
    const middle = width / 2;
    const yFor = (index: number, count: number) =>
      28 + ((height - 56) * (index + 0.5)) / Math.max(count, 1);
    return (
      <div
        className={`nb-output nb-chart nb-chart-mark-sankey${loading ? " is-loading" : ""}`}
        aria-busy={loading || undefined}
      >
        <svg
          className="nb-chart-svg"
          width={width}
          ref={measureSvg}
          style={{ height }}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={caption}
        >
          {links.map((link) => {
            const sourceIndex = sources.indexOf(link.source);
            const targetIndex = targets.indexOf(link.target);
            const y1 = yFor(sourceIndex, sources.length);
            const y2 = yFor(targetIndex, targets.length);
            return (
              <path
                key={link.index}
                className="nb-chart-sankey-link"
                d={`M ${leftNode} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${rightNode} ${y2}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth={Math.max(1, Math.min(24, link.value))}
              >
                <title>{`${link.source} → ${link.target}: ${link.value}`}</title>
              </path>
            );
          })}
          {sources.map((node, index) => (
            <g key={`s-${node}`}>
              <rect
                className="nb-chart-bar"
                x={leftNode - 14}
                y={yFor(index, sources.length) - 10}
                width="14"
                height="20"
              />
              <text
                x={leftNode - 20}
                y={yFor(index, sources.length) + 4}
                textAnchor="end"
              >
                {node}
              </text>
            </g>
          ))}
          {targets.map((node, index) => (
            <g key={`t-${node}`}>
              <rect
                className="nb-chart-bar"
                x={rightNode}
                y={yFor(index, targets.length) - 10}
                width="14"
                height="20"
              />
              <text x={rightNode + 20} y={yFor(index, targets.length) + 4}>
                {node}
              </text>
            </g>
          ))}
        </svg>
        <div className="nb-chart-caption">{caption}</div>
      </div>
    );
  }

  const showLegend =
    (legend ?? (Boolean(encoding?.colorField) || allSeries.length > 1)) &&
    (mark === "bar" || mark === "line" || mark === "area");
  const outsideLegend = showLegend && aggregateEncoding != null;
  return (
    <div
      className={`nb-output nb-chart nb-chart-mark-${mark}${outsideLegend ? " nb-chart-has-legend" : ""}${loading ? " is-loading" : ""}`}
      aria-busy={loading || undefined}
    >
      {aggregateEncoding && title?.trim() ? (
        <div className="nb-chart-caption">{title}</div>
      ) : null}
      <svg
        className="nb-chart-svg"
        width={width}
        ref={measureSvg}
        style={{ height }}
        viewBox={`0 0 ${width} ${height}`}
        role={onMarkSelect ? "group" : "img"}
        aria-label={caption}
      >
        {mark !== "pie" ? (
          <g className="nb-chart-grid">
            {ticks.map((tick) => (
              <line
                key={tick}
                x1={padding.left}
                y1={scale(tick)}
                x2={width - padding.right}
                y2={scale(tick)}
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeDasharray="3 3"
              />
            ))}
          </g>
        ) : null}
        <line
          x1={padding.left}
          y1={zeroY}
          x2={width - padding.right}
          y2={zeroY}
          className="nb-chart-axis"
        />
        {mark !== "pie" ? (
          <g className="nb-chart-ticks">
            <g className="nb-chart-yticks">
              {tickLabels.map(({ value, text }) => (
                <text
                  key={value}
                  x={padding.left - 8}
                  y={scale(value) + 4}
                  textAnchor="end"
                >
                  {text}
                </text>
              ))}
            </g>
            <g className="nb-chart-xticks">
              {categories.map((category, index) => {
                if (!xTickIndices.has(index)) return null;
                const x = centre(index);
                const text =
                  aggregateEncoding && category.length > 18
                    ? `${category.slice(0, 17)}…`
                    : category;
                const halfWidth = text.length * 3.5;
                return (
                  <text
                    key={index}
                    x={x}
                    y={aggregateEncoding ? height - 29 : height - 8}
                    textAnchor={
                      aggregateEncoding && x + halfWidth > width - 4
                        ? "end"
                        : aggregateEncoding && x - halfWidth < 4
                          ? "start"
                          : "middle"
                    }
                  >
                    {text}
                    {text !== category ? <title>{category}</title> : null}
                  </text>
                );
              })}
            </g>
            {aggregateEncoding ? (
              <>
                <text
                  x={padding.left + plotWidth / 2}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {xTitle}
                </text>
                <text
                  transform={`translate(14 ${padding.top + plotHeight / 2}) rotate(-90)`}
                  textAnchor="middle"
                >
                  {yTitle}
                </text>
              </>
            ) : null}
          </g>
        ) : null}
        {mark === "bar"
          ? allSeries.flatMap((series, seriesIndex) =>
              series.map((point) => {
                const { value, rowIndex: index } = point;
                const barWidth = Math.max(
                  1,
                  (barSlot * 0.7) / (isStacked ? 1 : allSeries.length),
                );
                const stack = stacks.get(point);
                const y = scale(isStacked && stack ? stack.top : value);
                const baseline = isStacked && stack ? scale(stack.base) : zeroY;
                const x =
                  centre(index) -
                  (barWidth * (isStacked ? 1 : allSeries.length)) / 2 +
                  (isStacked ? 0 : barWidth * seriesIndex);
                const barY = Math.min(y, baseline);
                const barHeight = Math.max(1, Math.abs(baseline - y));
                const end = topmost.get(index);
                const rounded =
                  !isStacked ||
                  (value >= 0
                    ? end?.positive === seriesIndex
                    : end?.negative === seriesIndex);
                const radius = rounded
                  ? Math.min(BAR_RADIUS, barWidth / 2, barHeight)
                  : 0;
                return (
                  <g key={`${seriesIndex}-${index}`}>
                    <rect
                      className="nb-chart-bar"
                      {...markInteraction(point)}
                      style={{
                        ...seriesStyle(seriesIndex),
                        ...(radius > 0 ? { fillOpacity: 0 } : {}),
                      }}
                      x={x}
                      y={barY}
                      width={barWidth}
                      height={barHeight}
                    >
                      {tooltipChannels ? (
                        <title>{pointTooltip(index, seriesIndex, value)}</title>
                      ) : null}
                    </rect>
                    {radius > 0 ? (
                      <path
                        className="nb-chart-rounded"
                        d={roundedBarPath(
                          x,
                          barY,
                          barWidth,
                          barHeight,
                          radius,
                          value >= 0,
                        )}
                        fill={seriesColor(seriesIndex)}
                        opacity={0.85}
                        pointerEvents="none"
                      />
                    ) : null}
                  </g>
                );
              }),
            )
          : null}
        {mark === "line" || mark === "area"
          ? allSeries.map((series, seriesIndex) => {
              if (series.length === 0) return null;
              const segments: ChartPoint[][] = [];
              let previous: ChartPoint | undefined;
              for (const point of series) {
                if (previous?.rowIndex !== point.rowIndex - 1)
                  segments.push([]);
                segments.at(-1)?.push(point);
                previous = point;
              }
              return (
                <g key={seriesIndex} style={seriesStyle(seriesIndex)}>
                  {segments.map((segment) => {
                    const upper: Point[] = segment.map((point) => {
                      const stack = stacks.get(point);
                      return [
                        centre(point.rowIndex),
                        scale(isStacked && stack ? stack.top : point.value),
                      ];
                    });
                    const lower: Point[] = segment
                      .map((point): Point => {
                        const stack = stacks.get(point);
                        return [
                          centre(point.rowIndex),
                          scale(isStacked && stack ? stack.base : 0),
                        ];
                      })
                      .reverse();
                    const linePath = monotonePath(upper);
                    const lowerStart = lower[0];
                    return (
                      <g key={segment[0]?.rowIndex}>
                        {mark === "area" && lowerStart ? (
                          <path
                            className="nb-chart-area"
                            data-points={`${pointList(upper)} ${pointList(lower)}`}
                            d={`${linePath} L ${lowerStart[0]} ${lowerStart[1]}${monotoneSegments(lower)} Z`}
                          />
                        ) : null}
                        <path
                          className="nb-chart-line"
                          data-points={pointList(upper)}
                          d={linePath}
                          strokeLinecap="round"
                        >
                          <title>{label(columns[seriesIndex + 1] ?? "")}</title>
                        </path>
                      </g>
                    );
                  })}
                  {aggregateEncoding || onMarkClick || onMarkSelect
                    ? series.map((point) => {
                        const { value, rowIndex: index } = point;
                        const stack = stacks.get(point);
                        return (
                          <circle
                            key={index}
                            className="nb-chart-point"
                            cx={centre(index)}
                            cy={scale(isStacked && stack ? stack.top : value)}
                            r={4}
                            {...markInteraction(point)}
                          >
                            {tooltipChannels ? (
                              <title>
                                {pointTooltip(index, seriesIndex, value)}
                              </title>
                            ) : null}
                          </circle>
                        );
                      })
                    : null}
                </g>
              );
            })
          : null}
        {mark === "scatter"
          ? (
              points ??
              values.flatMap((value, rowIndex) =>
                value === null ? [] : [{ rowIndex, seriesIndex: 0, value }],
              )
            ).map((point) => {
              const { rowIndex: index, seriesIndex, value } = point;
              return (
                <circle
                  key={`${seriesIndex}-${index}`}
                  className="nb-chart-point"
                  cx={centre(index)}
                  cy={scale(value)}
                  r={4}
                  style={points ? seriesStyle(seriesIndex) : undefined}
                  {...markInteraction(point)}
                >
                  {tooltipChannels ? (
                    <title>
                      {points
                        ? pointTooltip(index, seriesIndex, value)
                        : `${categories[index]}: ${formatCellValue(value)}`}
                    </title>
                  ) : null}
                </circle>
              );
            })
          : null}
        {mark === "pie" ? (
          <PieSlices
            categories={
              points
                ? points.map(({ rowIndex }) => categories[rowIndex] ?? "")
                : categories
            }
            values={points ? points.map(({ value }) => value) : values}
            colors={colors}
            pointStyle={
              points
                ? (index) => seriesStyle(points[index]?.seriesIndex ?? 0)
                : undefined
            }
            pointInteraction={
              points
                ? (index) => {
                    const point = points[index];
                    return point ? markInteraction(point) : {};
                  }
                : undefined
            }
            centreX={padding.left + plotWidth / 2}
            centreY={padding.top + plotHeight / 2}
            radius={Math.min(plotWidth, plotHeight) / 2}
          />
        ) : null}
      </svg>
      {!aggregateEncoding ? (
        <div className="nb-chart-caption">{caption}</div>
      ) : null}
      {outsideLegend ? (
        <ul
          className="nb-chart-legend"
          aria-label={aggregateEncoding.colorField ?? t("notebook.chartSeries")}
        >
          {columns.slice(1).map((name, index) => (
            <li key={`${name}-${index}`} style={seriesStyle(index)}>
              {aggregateEncoding.countRecords && !aggregateEncoding.colorField
                ? t("chartData.countRecords")
                : label(name)}
            </li>
          ))}
        </ul>
      ) : null}
      {!outsideLegend && showLegend ? (
        <div className="nb-chart-caption">
          {columns.slice(1).map((name, index) => (
            <span
              key={`${name}-${index}`}
              style={{
                ...seriesStyle(index),
                color: seriesColor(index),
                marginRight: 12,
              }}
            >
              ● {label(name)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function chartTickIndices(
  count: number,
  centre: (index: number) => number,
  spacing: number,
) {
  const indices = new Set([0]);
  const last = count - 1;
  let previousX = centre(0);
  for (let index = 1; index < last; index++) {
    const x = centre(index);
    if (x - previousX >= spacing && centre(last) - x >= spacing) {
      indices.add(index);
      previousX = x;
    }
  }
  if (last > 0) indices.add(last);
  return indices;
}

/**
 * A pie is drawn from the same value column: each slice's angle is its share of
 * the total of the positive values, so a pie of one row is the whole circle and
 * a pie whose values cancel out draws nothing rather than a wrong shape.
 */
type MarkInteraction = Pick<
  SVGProps<SVGElement>,
  "role" | "aria-label" | "tabIndex" | "onFocus" | "onClick" | "onKeyDown"
> & { "data-chart-mark"?: string };

function PieSlices({
  categories,
  values,
  colors,
  pointStyle,
  pointInteraction,
  centreX,
  centreY,
  radius,
}: {
  categories: readonly string[];
  values: ReadonlyArray<number | null>;
  colors?: readonly string[] | undefined;
  pointStyle?: ((index: number) => CSSProperties) | undefined;
  pointInteraction?: ((index: number) => MarkInteraction) | undefined;
  centreX: number;
  centreY: number;
  radius: number;
}) {
  const positives = values.map((value) =>
    value != null && value > 0 ? value : 0,
  );
  const total = positives.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  let start = -Math.PI / 2;
  return (
    <>
      {positives.map((value, index) => {
        if (value <= 0) return null;
        const sweep = (value / total) * Math.PI * 2;
        const end = start + sweep;
        const x1 = centreX + radius * Math.cos(start);
        const y1 = centreY + radius * Math.sin(start);
        const x2 = centreX + radius * Math.cos(end);
        const y2 = centreY + radius * Math.sin(end);
        const largeArc = sweep > Math.PI ? 1 : 0;
        const path = `M ${centreX} ${centreY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
        start = end;
        return (
          <path
            key={index}
            className="nb-chart-slice"
            d={path}
            {...pointInteraction?.(index)}
            style={
              pointStyle?.(index) ??
              ({
                "--nb-series-color":
                  colors?.[index] ?? `hsl(var(--chart-${(index % 5) + 1}))`,
              } as CSSProperties)
            }
          >
            <title>{`${categories[index]}: ${value}`}</title>
          </path>
        );
      })}
    </>
  );
}
