import { OG_FONT_FAMILY } from "@agent-native/core/server";

import {
  estimateTextWidth,
  isCategoryAxis,
  planCategoryAxis,
  trimToWidth,
} from "../../shared/chart-axis-labels";
import {
  funnelOutcomeShare,
  type DashboardFunnelItem,
  type DashboardFunnelOutcomeSummary,
} from "../../shared/dashboard-funnel";
import { formatDollars } from "../../shared/format-dollars";
import {
  FUNNEL_OUTCOME_REPORT_COLORS,
  FUNNEL_OUTCOME_SEGMENTS,
  type FunnelOutcomeSegment,
} from "../../shared/tokens/funnel-outcome-colors";

export { estimateTextWidth };

export type ReportChartType =
  | "bar"
  | "line"
  | "area"
  | "combo"
  | "pie"
  | "funnel";

export type ReportChartEvent = { index: number; label: string; color?: string };

export type ReportChartAxis = "left" | "right";

export type ReportChartValueFormatter = "number" | "currency" | "percent";

export type ReportChartSeries = {
  label: string;
  data: Array<number | null>;
  color?: string;
  axis?: ReportChartAxis;
  formatter?: ReportChartValueFormatter;
  /** Combo charts only: draw this series as bars or as a line. */
  mark?: "bar" | "line";
};

export type ChartSvgTheme = {
  background: string;
  gridColor: string;
  tickColor: string;
  titleColor: string;
  labelColor: string;
};

export const CHART_THEMES: Record<"dark" | "light", ChartSvgTheme> = {
  dark: {
    background: "#09090b",
    gridColor: "#27272a",
    tickColor: "#a1a1aa",
    titleColor: "#fafafa",
    labelColor: "#fafafa",
  },
  light: {
    background: "#ffffff",
    gridColor: "#d4d4d8",
    tickColor: "#71717a",
    titleColor: "#09090b",
    labelColor: "#09090b",
  },
};

export const CHART_PALETTES: Record<"dark" | "light", readonly string[]> = {
  dark: [
    "#00B5FF",
    "#48FFE4",
    "#22c55e",
    "#f59e0b",
    "#0ea5e9",
    "#ef4444",
    "#14b8a6",
    "#f97316",
  ],
  light: [
    "#0284C7",
    "#0D9488",
    "#16a34a",
    "#d97706",
    "#0369a1",
    "#dc2626",
    "#0f766e",
    "#ea580c",
  ],
};

export const REPORT_CHART_FONT_FAMILY = OG_FONT_FAMILY;

const BROWSER_FONT_FAMILY =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const NEUTRAL_COLOR = "#71717a";

function escapeXml(value: unknown): string {
  return (typeof value === "string" ? value : (JSON.stringify(value) ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeColor(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  if (candidate && HEX_COLOR.test(candidate)) return candidate;
  const fallbackCandidate = fallback?.trim();
  if (fallbackCandidate && HEX_COLOR.test(fallbackCandidate)) {
    return fallbackCandidate;
  }
  return NEUTRAL_COLOR;
}

function clampSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatTick(
  value: number,
  formatter?: ReportChartValueFormatter,
): string {
  if (formatter === "currency") return formatDollars(value);
  if (formatter === "percent") {
    const percent = value <= 1 && value >= -1 ? value * 100 : value;
    return `${percent.toFixed(2)}%`;
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function formatCoord(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 2).trimEnd()}...` : value;
}

function wrapToWidth(
  value: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const next = `${current} ${word}`;
    if (estimateTextWidth(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);

  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    kept[maxLines - 1] =
      `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  }
  return kept.map((line) => trimToWidth(line, fontSize, maxWidth));
}

const TITLE_BASELINE = 32;
const SUBTITLE_BASELINE = 54;
const SUBTITLE_LINE_HEIGHT = 17;
const HEADER_INSET = 24;

function renderChartHeader({
  title,
  subtitle,
  width,
  theme,
  fontFamily,
  fit,
}: {
  title: string;
  subtitle: string;
  width: number;
  theme: ChartSvgTheme;
  fontFamily: string;
  fit: boolean;
}): { titleMarkup: string; subtitleMarkup: string; headerBottom: number } {
  const maxWidth = width - HEADER_INSET * 2;
  const titleText = fit ? trimToWidth(title, 22 * 1.06, maxWidth) : title;
  const subtitleLines = !subtitle
    ? []
    : fit
      ? wrapToWidth(subtitle, 13, maxWidth, 2)
      : [subtitle];

  const collapsed = fit && !titleText && subtitleLines.length === 0;

  return {
    titleMarkup: collapsed
      ? ""
      : `<text x="${HEADER_INSET}" y="${TITLE_BASELINE}" font-family="${fontFamily}" font-size="22" font-weight="700" fill="${theme.titleColor}">${escapeXml(titleText)}</text>`,
    subtitleMarkup: subtitleLines
      .map(
        (line, index) =>
          `<text x="${HEADER_INSET}" y="${SUBTITLE_BASELINE + index * SUBTITLE_LINE_HEIGHT}" font-family="${fontFamily}" font-size="13" fill="${theme.tickColor}">${escapeXml(line)}</text>`,
      )
      .join(""),
    headerBottom: collapsed
      ? 0
      : subtitleLines.length
        ? SUBTITLE_BASELINE + (subtitleLines.length - 1) * SUBTITLE_LINE_HEIGHT
        : TITLE_BASELINE,
  };
}

const LEGEND_FONT_SIZE = 12;
const LEGEND_LABEL_INSET = 18;
const LEGEND_ENTRY_GAP = 20;
const LEGEND_ROW_HEIGHT = 18;
const LEGEND_MAX_ROWS = 3;

type LegendEntry = { label: string; color: string; x: number };

function layoutLegend(
  entries: Array<{ label: string; color: string }>,
  maxWidth: number,
): { rows: LegendEntry[][]; marker: string | null; markerX: number } {
  const rows: LegendEntry[][] = [[]];
  let cursor = 0;
  let placed = 0;

  for (const entry of entries) {
    const label = trimToWidth(
      entry.label,
      LEGEND_FONT_SIZE,
      maxWidth - LEGEND_LABEL_INSET,
    );
    const width =
      LEGEND_LABEL_INSET + estimateTextWidth(label, LEGEND_FONT_SIZE);
    if (cursor > 0 && cursor + width > maxWidth) {
      if (rows.length >= LEGEND_MAX_ROWS) break;
      rows.push([]);
      cursor = 0;
    }
    rows[rows.length - 1].push({ label, color: entry.color, x: cursor });
    cursor += width + LEGEND_ENTRY_GAP;
    placed += 1;
  }

  const lastRow = rows[rows.length - 1];
  let hidden = entries.length - placed;
  while (hidden > 0) {
    const marker = `+${hidden} more`;
    const fits =
      cursor + estimateTextWidth(marker, LEGEND_FONT_SIZE) <= maxWidth;
    if (fits) {
      return { rows, marker, markerX: cursor };
    }
    cursor = lastRow[lastRow.length - 1].x;
    lastRow.pop();
    hidden += 1;
  }
  return { rows, marker: null, markerX: 0 };
}

function layoutXLabels(
  texts: string[],
  centerFor: (index: number) => number,
  step: number,
  width: number,
): Array<{ text: string; x: number }> {
  const last = texts.length - 1;
  if (last < 0) return [];
  const candidates = texts
    .map((_, index) => index)
    .filter((index) => index % step === 0 || index === last);

  const drawn: Array<{ text: string; x: number; right: number }> = [];
  for (const index of candidates) {
    const text = texts[index];
    const half = estimateTextWidth(text, 11) / 2;
    const x = Math.min(Math.max(centerFor(index), 6 + half), width - 6 - half);
    const collides = () =>
      drawn.length > 0 && x - half < drawn[drawn.length - 1].right + 8;
    if (index === last) {
      while (drawn.length > 1 && collides()) drawn.pop();
    }
    if (collides()) continue;
    drawn.push({ text, x, right: x + half });
  }
  return drawn.map(({ text, x }) => ({ text, x }));
}

function clampedValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function exactValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type ResolvedSeries = {
  label: string;
  color: string;
  data: Array<number | null>;
  axis?: ReportChartAxis;
  formatter?: ReportChartValueFormatter;
  mark?: "bar" | "line";
};

type AxisScale = {
  min: number;
  span: number;
  yFor: (value: number) => number;
  zeroY: number;
};

function buildAxisScale(
  values: number[],
  chartBottom: number,
  plotHeight: number,
): AxisScale {
  const min = Math.min(0, ...values);
  const observedMax = values.length ? Math.max(...values) : 0;
  const max = observedMax > 0 ? observedMax : min < 0 ? 0 : 1;
  const span = max - min || 1;
  const yFor = (value: number) =>
    chartBottom - ((value - min) / span) * plotHeight;
  return { min, span, yFor, zeroY: yFor(0) };
}

function stackSegments(
  series: ResolvedSeries[],
  seriesIndexes: number[],
  labelCount: number,
  mode: "diverging" | "cumulative",
): Map<string, { base: number; top: number }> {
  const segments = new Map<string, { base: number; top: number }>();
  for (let labelIndex = 0; labelIndex < labelCount; labelIndex += 1) {
    let up = 0;
    let down = 0;
    let total = 0;
    for (const seriesIndex of seriesIndexes) {
      const value = series[seriesIndex].data[labelIndex];
      if (value === null) continue;
      const base = mode === "cumulative" ? total : value >= 0 ? up : down;
      const top = base + value;
      if (mode === "cumulative") total = top;
      else if (value >= 0) up = top;
      else down = top;
      segments.set(`${labelIndex}:${seriesIndex}`, { base, top });
    }
  }
  return segments;
}

const EVENT_LABEL_FONT_SIZE = 10;
const EVENT_LABEL_ROW_HEIGHT = 13;
/** Space between the last label row and the plot, so a peak at the top stays clear of it. */
const EVENT_LABEL_PLOT_GAP = 8;
const EVENT_LABEL_MAX_ROWS = 6;
const EVENT_LABEL_MAX_LINES = 3;
const EVENT_LABEL_GAP = 8;
const EVENT_LABEL_SEPARATOR = " · ";

type EventGroup = { index: number; labels: string[]; color?: string };

/** Same-day events share one line, so their labels join instead of overprinting. */
function groupEventsByIndex(
  events: readonly ReportChartEvent[],
  labelCount: number,
): EventGroup[] {
  const groups = new Map<number, ReportChartEvent[]>();
  for (const event of events) {
    if (event.index < 0 || event.index >= labelCount) continue;
    groups.set(event.index, [...(groups.get(event.index) ?? []), event]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, members]) => ({
      index,
      labels: members.map((member) => member.label),
      color: members[0].color,
    }));
}

const fitsEventLine = (value: string, maxWidth: number) =>
  estimateTextWidth(value, EVENT_LABEL_FONT_SIZE) <= maxWidth;

/** Breaks a label at its spaces; only a single word wider than a line is trimmed. */
function wrapEventLabel(label: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const joined = `${lines[lines.length - 1]} ${word}`;
    if (lines.length > 0 && fitsEventLine(joined, maxWidth)) {
      lines[lines.length - 1] = joined;
    } else {
      lines.push(trimToWidth(word, EVENT_LABEL_FONT_SIZE, maxWidth));
    }
  }
  return lines;
}

/** Joins whole labels into lines; a label that needs its own lines starts one. */
function packEventLabels(labels: readonly string[], maxWidth: number) {
  const lines: string[] = [];
  let lastTakesMore = false;
  for (const label of labels) {
    const joined = `${lines[lines.length - 1]}${EVENT_LABEL_SEPARATOR}${label}`;
    if (lastTakesMore && fitsEventLine(joined, maxWidth)) {
      lines[lines.length - 1] = joined;
      continue;
    }
    const wrapped = wrapEventLabel(label, maxWidth);
    lines.push(...wrapped);
    lastTakesMore = wrapped.length === 1;
  }
  return lines;
}

/**
 * One day's labels as at most `EVENT_LABEL_MAX_LINES` lines. Labels that don't
 * fit are counted in a "+N more" line rather than cut, and a lone label too
 * long for the lines ends on a whole word.
 */
function eventLabelLines(labels: readonly string[], maxWidth: number) {
  for (let shown = labels.length; shown > 0; shown -= 1) {
    const lines = packEventLabels(labels.slice(0, shown), maxWidth);
    const hidden = labels.length - shown;
    if (hidden === 0 && lines.length <= EVENT_LABEL_MAX_LINES) return lines;
    if (hidden > 0 && lines.length < EVENT_LABEL_MAX_LINES) {
      return [...lines, `+${hidden} more`];
    }
  }
  const hidden = labels.length - 1;
  const kept = wrapEventLabel(labels[0], maxWidth).slice(
    0,
    EVENT_LABEL_MAX_LINES - (hidden > 0 ? 1 : 0),
  );
  const words = kept[kept.length - 1].split(" ");
  while (words.length > 1 && !fitsEventLine(`${words.join(" ")} …`, maxWidth)) {
    words.pop();
  }
  kept[kept.length - 1] = `${words.join(" ")} …`;
  return hidden > 0 ? [...kept, `+${hidden} more`] : kept;
}

/** One line: the first label, ending on a whole word if cut, then "+N more". */
function compactEventLabel(labels: readonly string[], maxWidth: number) {
  const more = labels.length > 1 ? ` +${labels.length - 1} more` : "";
  const room = maxWidth - estimateTextWidth(more, EVENT_LABEL_FONT_SIZE);
  const words = labels[0].split(/\s+/).filter(Boolean);
  if (fitsEventLine(words.join(" "), room)) return `${words.join(" ")}${more}`;
  while (words.length > 1 && !fitsEventLine(`${words.join(" ")} …`, room)) {
    words.pop();
  }
  const cut = trimToWidth(
    `${words.join(" ")} …`,
    EVENT_LABEL_FONT_SIZE,
    room,
    "…",
  );
  return `${cut}${more}`;
}

type PlacedEventLabel = {
  x: number;
  color?: string;
  lines: string[];
  row: number;
  anchor: "start" | "end";
};

type EventLabelLayout = {
  labels: PlacedEventLabel[];
  /** Days with no clear rows left: drawn as a rule and dot, without text. */
  unlabeled: Array<{ x: number; color?: string }>;
  /** Counts the unlabeled days, so a dropped label shows. */
  notice: { text: string; row: number } | null;
  rowCount: number;
};

/**
 * Puts each day's lines on the first rows where they clear the labels already
 * there, never on top of one. Labels open toward the side with room, so one
 * near the right edge is never cut off by the chart boundary. A day that finds
 * no room tries one compact line, then goes unlabeled and is counted.
 */
function layoutEventLabels(
  groups: readonly EventGroup[],
  centerFor: (index: number) => number,
  chartLeft: number,
  chartRight: number,
): EventLabelLayout {
  const rows: Array<Array<[number, number]>> = [];
  const maxWidth = (chartRight - chartLeft) / 2;
  const clear = (row: number, span: [number, number]) =>
    (rows[row] ?? []).every(
      ([start, end]) =>
        span[1] + EVENT_LABEL_GAP <= start || span[0] >= end + EVENT_LABEL_GAP,
    );
  const place = (x: number, lines: string[]) => {
    const width = Math.max(
      ...lines.map((line) => estimateTextWidth(line, EVENT_LABEL_FONT_SIZE)),
    );
    const anchor: "start" | "end" =
      x + 5 + width > chartRight ? "end" : "start";
    const span: [number, number] =
      anchor === "end" ? [x - 5 - width, x] : [x, x + 5 + width];
    for (let row = 0; row + lines.length <= EVENT_LABEL_MAX_ROWS; row += 1) {
      if (lines.every((_, offset) => clear(row + offset, span))) {
        lines.forEach((_, offset) => (rows[row + offset] ??= []).push(span));
        return { x, lines, row, anchor };
      }
    }
    return null;
  };

  const labels: PlacedEventLabel[] = [];
  const unlabeled: EventLabelLayout["unlabeled"] = [];
  for (const group of groups) {
    const x = centerFor(group.index);
    const placed =
      place(x, eventLabelLines(group.labels, maxWidth)) ??
      place(x, [compactEventLabel(group.labels, maxWidth)]);
    if (placed) labels.push({ ...placed, color: group.color });
    else unlabeled.push({ x, color: group.color });
  }

  let notice: EventLabelLayout["notice"] = null;
  if (unlabeled.length > 0) {
    const text = `+${unlabeled.length} ${unlabeled.length === 1 ? "date" : "dates"} not labeled`;
    const span: [number, number] = [
      chartRight - estimateTextWidth(text, EVENT_LABEL_FONT_SIZE),
      chartRight,
    ];
    let row = 0;
    while (row < rows.length && !clear(row, span)) row += 1;
    (rows[row] ??= []).push(span);
    notice = { text, row };
  }
  return { labels, unlabeled, notice, rowCount: rows.length };
}

function renderCartesianChartSvg({
  title,
  subtitle,
  labels,
  series,
  type,
  width,
  height,
  theme,
  fontFamily,
  stacked,
  fit,
  events,
}: {
  title: string;
  subtitle: string;
  labels: string[];
  series: ResolvedSeries[];
  events?: ReportChartEvent[];
  type: "bar" | "line" | "area" | "combo";
  width: number;
  height: number;
  theme: ChartSvgTheme;
  fontFamily: string;
  stacked: boolean;
  fit: boolean;
}): string {
  const safeWidth = clampSize(width, 360, 2000);
  const safeHeight = clampSize(height, 240, 1200);
  const rightAxisIndexes = series
    .map((entry, index) => (entry.axis === "right" ? index : -1))
    .filter((index) => index >= 0);
  const leftAxisIndexes = series
    .map((entry, index) => (entry.axis === "right" ? -1 : index))
    .filter((index) => index >= 0);
  const dualAxis = rightAxisIndexes.length > 0 && leftAxisIndexes.length > 0;
  const chartLeft = 58;
  const chartRight = safeWidth - (dualAxis ? 62 : 28);
  const plotWidth = Math.max(1, chartRight - chartLeft);
  // Bars over named categories label every bar; dates and numbers thin out.
  const categoryAxis =
    type === "bar" && isCategoryAxis(labels)
      ? planCategoryAxis(labels, plotWidth, chartLeft, 11)
      : null;
  const chartBottom =
    categoryAxis && categoryAxis.angle !== 0
      ? safeHeight - categoryAxis.height - 6
      : safeHeight - 48;

  const header = renderChartHeader({
    title,
    subtitle,
    width: safeWidth,
    theme,
    fontFamily,
    fit,
  });
  const legendTop = !header.headerBottom
    ? 18
    : subtitle
      ? header.headerBottom + 4
      : 42;
  const legendSeries = dualAxis
    ? series.map((entry) =>
        entry.axis === "right"
          ? { ...entry, label: `${entry.label} (right)` }
          : entry,
      )
    : series;
  const legendLayout =
    fit && series.length > 1 ? layoutLegend(legendSeries, plotWidth) : null;
  const slot = plotWidth / Math.max(labels.length, 1);
  const centerFor = (index: number) => chartLeft + slot * index + slot / 2;
  const eventLayout = layoutEventLabels(
    groupEventsByIndex(events ?? [], labels.length),
    centerFor,
    chartLeft,
    chartRight,
  );
  const eventsTop = !fit
    ? subtitle
      ? 88
      : 66
    : legendLayout
      ? legendTop + (legendLayout.rows.length - 1) * LEGEND_ROW_HEIGHT + 30
      : header.headerBottom + 34;
  // Event labels get their own rows above the plot so they never sit on the data.
  const chartTop =
    eventsTop +
    (eventLayout.rowCount > 0
      ? eventLayout.rowCount * EVENT_LABEL_ROW_HEIGHT + EVENT_LABEL_PLOT_GAP
      : 0);
  const plotHeight = Math.max(1, chartBottom - chartTop);

  const stackedBars = stacked && type === "bar";
  const stackedAreas = stacked && type === "area";
  const stackedSegments =
    stackedBars || stackedAreas
      ? new Map([
          ...stackSegments(
            series,
            leftAxisIndexes,
            labels.length,
            stackedAreas ? "cumulative" : "diverging",
          ),
          ...stackSegments(
            series,
            rightAxisIndexes,
            labels.length,
            stackedAreas ? "cumulative" : "diverging",
          ),
        ])
      : new Map<string, { base: number; top: number }>();

  const axisValues = (seriesIndexes: number[]): number[] =>
    stackedBars || stackedAreas
      ? seriesIndexes.flatMap((seriesIndex) =>
          labels.flatMap((_, labelIndex) => {
            const segment = stackedSegments.get(`${labelIndex}:${seriesIndex}`);
            return segment ? [segment.base, segment.top] : [];
          }),
        )
      : seriesIndexes.flatMap((seriesIndex) =>
          series[seriesIndex].data.filter(
            (value): value is number => value !== null,
          ),
        );

  const leftScale = buildAxisScale(
    axisValues(
      dualAxis ? leftAxisIndexes : leftAxisIndexes.concat(rightAxisIndexes),
    ),
    chartBottom,
    plotHeight,
  );
  const rightScale = dualAxis
    ? buildAxisScale(axisValues(rightAxisIndexes), chartBottom, plotHeight)
    : leftScale;
  const leftFormatter = series[leftAxisIndexes[0]]?.formatter;
  const rightFormatter = series[rightAxisIndexes[0]]?.formatter;
  const scaleFor = (seriesIndex: number): AxisScale =>
    dualAxis && series[seriesIndex].axis === "right" ? rightScale : leftScale;

  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  const grid = Array.from({ length: 5 }, (_, index) => {
    const fraction = (4 - index) / 4;
    const value = leftScale.min + leftScale.span * fraction;
    const y = leftScale.yFor(value);
    const rightTick = dualAxis
      ? `<text x="${chartRight + 10}" y="${(y + 4).toFixed(1)}" text-anchor="start" font-size="11" fill="${theme.tickColor}">${escapeXml(formatTick(rightScale.min + rightScale.span * fraction, rightFormatter))}</text>`
      : "";
    return `<line x1="${chartLeft}" x2="${chartRight}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${theme.gridColor}" stroke-width="0.8"/><text x="${chartLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.tickColor}">${escapeXml(formatTick(value, leftFormatter))}</text>${rightTick}`;
  }).join("");

  const xLabels = categoryAxis
    ? labels
        .map((label, index) => {
          if (index % (categoryAxis.interval + 1) !== 0) return "";
          const text = escapeXml(
            trimToWidth(label, 11, categoryAxis.labelWidth),
          );
          const x = centerFor(index).toFixed(1);
          if (categoryAxis.angle === 0) {
            return `<text x="${x}" y="${safeHeight - 18}" text-anchor="middle" font-size="11" fill="${theme.tickColor}">${text}</text>`;
          }
          const y = (chartBottom + 12).toFixed(1);
          return `<text x="${x}" y="${y}" dy="0.35em" text-anchor="end" transform="rotate(${categoryAxis.angle} ${x} ${y})" font-size="11" fill="${theme.tickColor}">${text}</text>`;
        })
        .join("")
    : fit
      ? layoutXLabels(
          labels.map((label) => truncate(label, 14)),
          centerFor,
          labelStep,
          safeWidth,
        )
          .map(
            ({ text, x }) =>
              `<text x="${x.toFixed(1)}" y="${safeHeight - 18}" text-anchor="middle" font-size="11" fill="${theme.tickColor}">${escapeXml(text)}</text>`,
          )
          .join("")
      : labels
          .map((label, index) => {
            if (index % labelStep !== 0 && index !== labels.length - 1)
              return "";
            return `<text x="${centerFor(index).toFixed(1)}" y="${safeHeight - 18}" text-anchor="middle" font-size="11" fill="${theme.tickColor}">${escapeXml(truncate(label, 14))}</text>`;
          })
          .join("");

  const barIndexes =
    type === "combo"
      ? series.flatMap((entry, index) => (entry.mark === "bar" ? [index] : []))
      : type === "bar"
        ? series.map((_, index) => index)
        : [];
  const lineIndexes =
    type === "combo"
      ? series.flatMap((entry, index) => (entry.mark === "bar" ? [] : [index]))
      : type === "bar"
        ? []
        : series.map((_, index) => index);

  let marks = "";
  if (stackedBars) {
    marks = labels
      .map((_, labelIndex) => {
        const x = chartLeft + slot * labelIndex + slot * 0.2;
        const barWidth = Math.max(5, slot * 0.6);
        return series
          .map((entry, seriesIndex) => {
            const segment = stackedSegments.get(`${labelIndex}:${seriesIndex}`);
            if (!segment) return "";
            const { yFor } = scaleFor(seriesIndex);
            const from = yFor(segment.base);
            const to = yFor(segment.top);
            return `<rect x="${x.toFixed(1)}" y="${Math.min(from, to).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, Math.abs(to - from)).toFixed(1)}" rx="4" fill="${entry.color}"/>`;
          })
          .join("");
      })
      .join("");
  } else {
    const groupWidth = slot * 0.72;
    const barWidth = Math.max(
      4,
      groupWidth / Math.max(barIndexes.length, 1) - 2,
    );
    marks = labels
      .map((_, labelIndex) =>
        barIndexes
          .map((seriesIndex, barSlot) => {
            const entry = series[seriesIndex];
            const value = entry.data[labelIndex];
            if (value === null) return "";
            const x =
              chartLeft +
              slot * labelIndex +
              slot * 0.14 +
              barSlot * (barWidth + 2);
            const { yFor, zeroY } = scaleFor(seriesIndex);
            const y = yFor(value);
            return `<rect x="${x.toFixed(1)}" y="${Math.min(zeroY, y).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(2, Math.abs(zeroY - y)).toFixed(1)}" rx="4" fill="${entry.color}"/>`;
          })
          .join(""),
      )
      .join("");
    marks += lineIndexes
      .map((seriesIndex) => {
        const entry = series[seriesIndex];
        const { yFor, zeroY } = scaleFor(seriesIndex);
        const zeroText = formatCoord(zeroY);
        const segments: Array<{
          start: number;
          points: Array<[string, string, string]>;
        }> = [];
        labels.forEach((_, index) => {
          const value = entry.data[index];
          if (value === null) return;
          const stack = stackedAreas
            ? stackedSegments.get(`${index}:${seriesIndex}`)
            : undefined;
          const x = chartLeft + slot * index + slot / 2;
          const point: [string, string, string] = [
            x.toFixed(1),
            yFor(stack?.top ?? value).toFixed(1),
            yFor(stack?.base ?? 0).toFixed(1),
          ];
          const open = segments[segments.length - 1];
          if (open && open.start + open.points.length === index) {
            open.points.push(point);
            return;
          }
          segments.push({ start: index, points: [point] });
        });
        return segments
          .map(({ start, points }) => {
            if (points.length === 1) {
              const [x, y] = points[0];
              return `<circle cx="${x}" cy="${y}" r="3.5" fill="${entry.color}"/>`;
            }
            const path = points
              .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x},${y}`)
              .join(" ");
            const area =
              type === "area"
                ? `<path d="${path} ${
                    stackedAreas
                      ? points
                          .slice()
                          .reverse()
                          .map(([x, , baseY]) => `L ${x},${baseY}`)
                          .join(" ")
                      : `L ${chartLeft + slot * (start + points.length - 0.5)},${zeroText} L ${chartLeft + slot * (start + 0.5)},${zeroText}`
                  } Z" fill="${entry.color}" fill-opacity="0.18"/>`
                : "";
            return `${area}<path d="${path}" fill="none" stroke="${entry.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
          })
          .join("");
      })
      .join("");
  }

  const leftZeroText = formatCoord(leftScale.zeroY);
  const axis = `<line x1="${chartLeft}" x2="${chartRight}" y1="${chartBottom}" y2="${chartBottom}" stroke="${theme.gridColor}" stroke-width="1"/>${
    leftScale.min < 0
      ? `<line x1="${chartLeft}" x2="${chartRight}" y1="${leftZeroText}" y2="${leftZeroText}" stroke="${theme.tickColor}" stroke-width="1"/>`
      : ""
  }`;

  const rowTopFor = (row: number) => eventsTop + row * EVENT_LABEL_ROW_HEIGHT;
  const placedEvents = eventLayout.labels.map((event) => ({
    ...event,
    color: safeColor(event.color, theme.labelColor),
    rowTop: rowTopFor(event.row),
  }));
  // An unlabeled day's rule starts at the plot, clear of the label rows.
  const eventRules = [
    ...placedEvents,
    ...eventLayout.unlabeled.map((event) => ({
      ...event,
      color: safeColor(event.color, theme.labelColor),
      rowTop: chartTop,
    })),
  ];
  const eventText = (
    x: number,
    rowTop: number,
    anchor: "start" | "end",
    fill: string,
    text: string,
  ) =>
    `<text x="${x.toFixed(1)}" y="${rowTop + 10}" text-anchor="${anchor}" font-size="${EVENT_LABEL_FONT_SIZE}" fill="${fill}" stroke="${theme.background}" stroke-width="3" paint-order="stroke">${escapeXml(text)}</text>`;
  // Every rule goes down before any text, so no event's line crosses another's label.
  const eventMarkup = [
    ...eventRules.map(
      ({ x, color, rowTop }) =>
        `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${rowTop}" y2="${chartBottom}" stroke="${color}" stroke-opacity="0.4" stroke-width="1" stroke-dasharray="3 3"/>`,
    ),
    ...placedEvents.flatMap(({ x, color, rowTop, anchor, lines }) =>
      lines.map((line, offset) =>
        eventText(
          anchor === "end" ? x - 5 : x + 5,
          rowTop + offset * EVENT_LABEL_ROW_HEIGHT,
          anchor,
          color,
          line,
        ),
      ),
    ),
    ...(eventLayout.notice
      ? [
          eventText(
            chartRight,
            rowTopFor(eventLayout.notice.row),
            "end",
            theme.tickColor,
            eventLayout.notice.text,
          ),
        ]
      : []),
    ...eventRules.map(
      ({ x, color }) =>
        `<circle cx="${x.toFixed(1)}" cy="${chartBottom}" r="5" fill="${color}" stroke="${theme.background}" stroke-width="2"/>`,
    ),
  ].join("");

  const legendEntries = legendLayout
    ? legendLayout.rows
        .map((row, rowIndex) => {
          const y = rowIndex * LEGEND_ROW_HEIGHT;
          return row
            .map(
              (entry) =>
                `<rect x="${formatCoord(entry.x)}" y="${y}" width="12" height="12" rx="3" fill="${entry.color}"/><text x="${formatCoord(entry.x + LEGEND_LABEL_INSET)}" y="${y + 11}" font-size="12" fill="${theme.labelColor}">${escapeXml(entry.label)}</text>`,
            )
            .join("");
        })
        .join("") +
      (legendLayout.marker
        ? `<text x="${formatCoord(legendLayout.markerX)}" y="${(legendLayout.rows.length - 1) * LEGEND_ROW_HEIGHT + 11}" font-size="12" fill="${theme.tickColor}">${escapeXml(legendLayout.marker)}</text>`
        : "")
    : legendSeries
        .map((entry, index) => {
          const x = index * 148;
          return `<rect x="${x}" y="0" width="12" height="12" rx="3" fill="${entry.color}"/><text x="${x + 18}" y="11" font-size="12" fill="${theme.labelColor}">${escapeXml(entry.label)}</text>`;
        })
        .join("");
  const legend =
    series.length > 1
      ? `<g transform="translate(${chartLeft},${legendTop})">${legendEntries}</g>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" font-family="${fontFamily}" role="img" aria-label="${escapeXml(title)}">
  <rect width="${safeWidth}" height="${safeHeight}" rx="8" fill="${theme.background}"/>
  ${header.titleMarkup}
  ${header.subtitleMarkup}
  ${legend}
  <g font-family="${fontFamily}">
    ${grid}
    ${axis}
    ${marks}
    ${xLabels}
    ${eventMarkup}
  </g>
</svg>`;
}

function polar(cx: number, cy: number, radius: number, angle: number): string {
  return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
}

function renderPieChartSvg({
  title,
  subtitle,
  labels,
  series,
  width,
  height,
  theme,
  palette,
  fontFamily,
}: {
  title: string;
  subtitle: string;
  labels: string[];
  series: ReportChartSeries[];
  width: number;
  height: number;
  theme: ChartSvgTheme;
  palette: readonly string[];
  fontFamily: string;
}): string {
  const safeWidth = clampSize(width, 360, 2000);
  const safeHeight = clampSize(height, 240, 1200);
  const header = renderChartHeader({
    title,
    subtitle,
    width: safeWidth,
    theme,
    fontFamily,
    fit: true,
  });
  const top = header.headerBottom + 34;
  const bottom = safeHeight - 24;
  const diameter = Math.max(
    60,
    Math.min(bottom - top, Math.round(safeWidth * 0.42)),
  );
  const radius = diameter / 2;
  const cx = 32 + radius;
  const cy = top + (bottom - top) / 2;

  const slices = labels.map((label, index) => ({
    label,
    value: exactValue(series[0]?.data[index]),
    color: safeColor(
      index === 0 ? series[0]?.color : undefined,
      palette[index % palette.length],
    ),
  }));
  const total = slices.reduce(
    (sum, slice) =>
      sum + (slice.value !== null && slice.value > 0 ? slice.value : 0),
    0,
  );

  let angle = -Math.PI / 2;
  const wedges = slices
    .map((slice) => {
      if (total <= 0 || slice.value === null || slice.value <= 0) return "";
      const fraction = slice.value / total;
      if (fraction >= 1) {
        return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" fill="${slice.color}"/>`;
      }
      const sweep = fraction * Math.PI * 2;
      const from = polar(cx, cy, radius, angle);
      angle += sweep;
      const to = polar(cx, cy, radius, angle);
      const largeArc = sweep > Math.PI ? 1 : 0;
      return `<path d="M ${cx.toFixed(2)},${cy.toFixed(2)} L ${from} A ${radius.toFixed(2)},${radius.toFixed(2)} 0 ${largeArc} 1 ${to} Z" fill="${slice.color}"/>`;
    })
    .join("");

  const holeRadius = radius * 0.56;
  const hole =
    total > 0
      ? `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${holeRadius.toFixed(2)}" fill="${theme.background}"/><text x="${cx.toFixed(2)}" y="${(cy + 6).toFixed(2)}" text-anchor="middle" font-family="${fontFamily}" font-size="20" font-weight="700" fill="${theme.titleColor}">${escapeXml(formatTick(total))}</text>`
      : `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(radius - 1).toFixed(2)}" fill="none" stroke="${theme.gridColor}" stroke-width="1.5" stroke-dasharray="4 4"/>`;

  const rowHeight = 22;
  const maxRows = Math.max(1, Math.floor((bottom - top) / rowHeight));
  const visible =
    slices.length > maxRows ? slices.slice(0, maxRows - 1) : slices;
  const hidden = slices.length - visible.length;
  const rows = visible.length + (hidden > 0 ? 1 : 0);
  const legendX = cx + radius + 28;
  const legendTop = Math.max(top + 12, cy - (rows * rowHeight) / 2 + 12);
  const legend = visible
    .map((slice, index) => {
      const y = legendTop + index * rowHeight;
      const share =
        total > 0 && slice.value !== null && slice.value > 0
          ? `${((slice.value / total) * 100).toFixed(1)}%`
          : "n/a";
      const value = slice.value === null ? "no data" : formatTick(slice.value);
      return `<rect x="${legendX.toFixed(1)}" y="${(y - 9).toFixed(1)}" width="12" height="12" rx="3" fill="${slice.color}"/><text x="${(legendX + 20).toFixed(1)}" y="${y.toFixed(1)}" font-family="${fontFamily}" font-size="12" fill="${theme.labelColor}">${escapeXml(`${truncate(slice.label, 22)}  ${value}  ${share}`)}</text>`;
    })
    .join("");
  const overflow =
    hidden > 0
      ? `<text x="${(legendX + 20).toFixed(1)}" y="${(legendTop + visible.length * rowHeight).toFixed(1)}" font-family="${fontFamily}" font-size="12" fill="${theme.tickColor}">${escapeXml(`+${hidden} more`)}</text>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" font-family="${fontFamily}" role="img" aria-label="${escapeXml(title)}">
  <rect width="${safeWidth}" height="${safeHeight}" rx="8" fill="${theme.background}"/>
  ${header.titleMarkup}
  ${header.subtitleMarkup}
  ${wedges}
  ${hole}
  ${legend}
  ${overflow}
</svg>`;
}

const FUNNEL_OUTCOME_LEGEND: Record<FunnelOutcomeSegment, string> = {
  completed: "Completed",
  skipped: "Skipped",
  movedOn: "Moved on without either",
  left: "Left the app",
};
const FUNNEL_LEFT_HERE = "Left the app here";
const FUNNEL_SKIPPED_PATTERN_ID = "funnel-skipped";

function outcomeFill(segment: FunnelOutcomeSegment): string {
  return segment === "skipped"
    ? `url(#${FUNNEL_SKIPPED_PATTERN_ID})`
    : FUNNEL_OUTCOME_REPORT_COLORS[segment];
}

/**
 * The emailed form of a funnel with `config.funnelOutcomes`: every stage is a
 * full-width bar split by what the people shown it did, led by the share who
 * left the app there. A stage whose outcomes don't add up draws a plain bar.
 */
function renderOutcomeFunnelSvg({
  title,
  subtitle,
  rows,
  outcomes,
  width,
  height,
  formatter,
  colors,
}: {
  title?: string;
  subtitle?: string;
  rows: DashboardFunnelItem[];
  outcomes: DashboardFunnelOutcomeSummary;
  width: number;
  height: number;
  formatter?: ReportChartValueFormatter;
  colors?: string[];
}): string {
  const theme = CHART_THEMES.light;
  const palette = CHART_PALETTES.light;
  const font = REPORT_CHART_FONT_FAMILY;
  const safeWidth = clampSize(width, 360, 2000);
  const header = renderChartHeader({
    title: title ?? "",
    subtitle: subtitle ?? "",
    width: safeWidth,
    theme,
    fontFamily: font,
    fit: true,
  });
  const left = HEADER_INSET;
  const right = safeWidth - HEADER_INSET;
  const barWidth = Math.max(1, right - left);
  const segments = FUNNEL_OUTCOME_SEGMENTS.filter(
    (segment) => segment !== "skipped" || !!outcomes.keys.skippedKey,
  );

  const legendY = header.headerBottom + 26;
  let cursor = left;
  const legend = segments
    .map((segment) => {
      const label = FUNNEL_OUTCOME_LEGEND[segment];
      const markup = `<rect x="${cursor.toFixed(1)}" y="${(legendY - 9).toFixed(1)}" width="10" height="10" rx="2" fill="${outcomeFill(segment)}"/><text x="${(cursor + 15).toFixed(1)}" y="${legendY.toFixed(1)}" font-size="11" fill="${theme.tickColor}">${escapeXml(label)}</text>`;
      cursor += 15 + estimateTextWidth(label, 11) + 16;
      return markup;
    })
    .join("");
  const leftHere = `<text x="${right.toFixed(1)}" y="${legendY.toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.tickColor}">${FUNNEL_LEFT_HERE}</text>`;

  const top = legendY + 18;
  const rowHeight = 40;
  // Grows past `height` to fit every stage, up to the size cap.
  const safeHeight = clampSize(
    Math.max(height, top + rows.length * rowHeight + 24),
    240,
    1200,
  );
  const maxRows = Math.max(1, Math.floor((safeHeight - 24 - top) / rowHeight));
  const visible = rows.slice(0, maxRows);
  const hidden = rows.length - visible.length;
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const stages = visible
    .map((row, index) => {
      const y = top + index * rowHeight;
      const textY = y + 13;
      const barY = y + 19;
      const shownText = `${formatTick(row.value, formatter)} shown`;
      const share = row.outcomes
        ? `${funnelOutcomeShare(row.outcomes.left, row.value).toFixed(1)}%`
        : "";
      const shareWidth = share ? estimateTextWidth(share, 13) + 16 : 0;
      const pillWidth = row.outcomes?.optional ? 56 : 0;
      const labelRoom =
        barWidth -
        shareWidth -
        pillWidth -
        estimateTextWidth(shownText, 11) -
        16;
      // Labels are semibold, wider than the regular-weight estimate at 12px.
      const label = trimToWidth(row.label, 13, Math.max(40, labelRoom));
      let x = left + estimateTextWidth(label, 13) + 8;
      const pill = row.outcomes?.optional
        ? `<rect x="${x.toFixed(1)}" y="${(textY - 11).toFixed(1)}" width="50" height="15" rx="7.5" fill="none" stroke="${theme.gridColor}"/><text x="${(x + 25).toFixed(1)}" y="${(textY - 0.5).toFixed(1)}" text-anchor="middle" font-size="10" fill="${theme.labelColor}">Optional</text>`
        : "";
      x += pillWidth;
      const head = `<text x="${left}" y="${textY.toFixed(1)}" font-size="12" font-weight="600" fill="${theme.labelColor}">${escapeXml(label)}</text>${pill}<text x="${x.toFixed(1)}" y="${textY.toFixed(1)}" font-size="11" fill="${theme.tickColor}">${escapeXml(shownText)}</text>${share ? `<text x="${right.toFixed(1)}" y="${(textY + 1).toFixed(1)}" text-anchor="end" font-size="13" font-weight="700" fill="${theme.labelColor}">${share}</text>` : ""}`;
      const track = `<rect x="${left}" y="${barY}" width="${barWidth.toFixed(1)}" height="16" rx="4" fill="${theme.gridColor}"/>`;
      if (!row.outcomes) {
        const fillWidth = row.value > 0 ? (row.value / maxValue) * barWidth : 0;
        const color = safeColor(
          colors?.[index],
          palette[index % palette.length],
        );
        return `${head}${track}<rect x="${left}" y="${barY}" width="${fillWidth.toFixed(1)}" height="16" rx="4" fill="${color}"/>`;
      }
      const stageOutcomes = row.outcomes;
      let segmentX = left;
      const parts = segments
        .map((segment) => {
          const partWidth =
            (funnelOutcomeShare(stageOutcomes[segment], row.value) / 100) *
            barWidth;
          if (partWidth <= 0) return "";
          const markup = `<rect x="${segmentX.toFixed(1)}" y="${barY}" width="${partWidth.toFixed(1)}" height="16" fill="${outcomeFill(segment)}"/>`;
          segmentX += partWidth;
          return markup;
        })
        .join("");
      const clipId = `funnel-stage-${index}`;
      return `${head}<clipPath id="${clipId}"><rect x="${left}" y="${barY}" width="${barWidth.toFixed(1)}" height="16" rx="4"/></clipPath>${track}<g clip-path="url(#${clipId})">${parts}</g>`;
    })
    .join("");
  const overflow =
    hidden > 0
      ? `<text x="${left}" y="${(top + visible.length * rowHeight + 14).toFixed(1)}" font-size="12" fill="${theme.tickColor}">${escapeXml(`+${hidden} more stages`)}</text>`
      : "";
  const skipped = FUNNEL_OUTCOME_REPORT_COLORS.skipped;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" font-family="${font}" role="img" aria-label="${escapeXml(title ?? "Funnel chart")}">
  <defs><pattern id="${FUNNEL_SKIPPED_PATTERN_ID}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="4" height="8" fill="${skipped}" fill-opacity="0.55"/><rect x="4" width="4" height="8" fill="${skipped}" fill-opacity="0.25"/></pattern></defs>
  <rect width="${safeWidth}" height="${safeHeight}" rx="8" fill="${theme.background}"/>
  ${header.titleMarkup}
  ${header.subtitleMarkup}
  <g font-family="${font}">
    ${legend}
    ${leftHere}
    ${stages}
    ${overflow}
  </g>
</svg>`;
}

export function renderFunnelChartSvg({
  title,
  subtitle,
  rows,
  outcomes,
  width,
  height,
  formatter,
  colors,
}: {
  title?: string;
  subtitle?: string;
  rows: DashboardFunnelItem[];
  /** The resolved `config.funnelOutcomes`; splits each stage when set. */
  outcomes?: DashboardFunnelOutcomeSummary;
  width: number;
  height: number;
  formatter?: ReportChartValueFormatter;
  colors?: string[];
}): string {
  if (outcomes) {
    return renderOutcomeFunnelSvg({
      title,
      subtitle,
      rows,
      outcomes,
      width,
      height,
      formatter,
      colors,
    });
  }
  const theme = CHART_THEMES.light;
  const palette = CHART_PALETTES.light;
  const safeWidth = clampSize(width, 360, 2000);
  const safeHeight = clampSize(height, 240, 1200);
  const header = renderChartHeader({
    title: title ?? "",
    subtitle: subtitle ?? "",
    width: safeWidth,
    theme,
    fontFamily: REPORT_CHART_FONT_FAMILY,
    fit: true,
  });
  const top = header.headerBottom + 30;
  const bottom = safeHeight - 24;
  const labelWidth = Math.min(190, Math.max(120, safeWidth * 0.2));
  const valueWidth = 150;
  const barLeft = labelWidth;
  const barRight = safeWidth - valueWidth;
  const barWidth = Math.max(1, barRight - barLeft);
  const rowHeight = 31;
  const maxRows = Math.max(1, Math.floor((bottom - top) / rowHeight));
  const visible = rows.slice(0, maxRows);
  const hidden = rows.length - visible.length;
  const maxValue = Math.max(...rows.map((row) => row.value), 1);
  const bars = visible
    .map((row, index) => {
      const y = top + index * rowHeight;
      const fillWidth = row.value > 0 ? (row.value / maxValue) * barWidth : 0;
      const color = safeColor(colors?.[index], palette[index % palette.length]);
      const dropOff =
        row.dropOffPercent === null
          ? ""
          : `  ${row.dropOffPercent < 0 ? "↑" : "↓"}${Math.abs(row.dropOffPercent).toFixed(1)}%`;
      return `<text x="${(labelWidth - 12).toFixed(1)}" y="${(y + 20).toFixed(1)}" text-anchor="end" font-size="12" fill="${theme.labelColor}">${escapeXml(truncate(row.label, 24))}</text><rect x="${barLeft.toFixed(1)}" y="${(y + 7).toFixed(1)}" width="${barWidth.toFixed(1)}" height="16" rx="4" fill="${theme.gridColor}"/><rect x="${barLeft.toFixed(1)}" y="${(y + 7).toFixed(1)}" width="${fillWidth.toFixed(1)}" height="16" rx="4" fill="${color}"/><text x="${(barRight + 12).toFixed(1)}" y="${(y + 19).toFixed(1)}" font-size="12" fill="${theme.labelColor}">${escapeXml(`${formatTick(row.value, formatter)}  ${row.percentOfFirst.toFixed(1)}%${dropOff}`)}</text>`;
    })
    .join("");
  const overflow =
    hidden > 0
      ? `<text x="${barLeft.toFixed(1)}" y="${(top + visible.length * rowHeight + 18).toFixed(1)}" font-size="12" fill="${theme.tickColor}">${escapeXml(`+${hidden} more stages`)}</text>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" font-family="${REPORT_CHART_FONT_FAMILY}" role="img" aria-label="${escapeXml(title ?? "Funnel chart")}">
  <rect width="${safeWidth}" height="${safeHeight}" rx="8" fill="${theme.background}"/>
  ${header.titleMarkup}
  ${header.subtitleMarkup}
  <g font-family="${REPORT_CHART_FONT_FAMILY}">
    ${bars}
    ${overflow}
  </g>
</svg>`;
}

export function renderStaticChartSvg({
  title,
  subtitle,
  labels,
  datasets,
  type,
  width,
  height,
  theme,
  palette,
  primaryColor,
  stacked,
}: {
  title: string;
  subtitle: string;
  labels: string[];
  datasets: Array<{ label: string; data: number[]; color?: string }>;
  type: "bar" | "line" | "area";
  width: number;
  height: number;
  theme: ChartSvgTheme;
  palette: readonly string[];
  primaryColor: string;
  stacked: boolean;
}): string {
  const normalizedLabels = labels.map((label) => String(label ?? ""));
  const series: ResolvedSeries[] = datasets.map((dataset, index) => ({
    label: dataset.label || `Series ${index + 1}`,
    color: safeColor(
      dataset.color,
      index === 0 ? primaryColor : palette[index % palette.length],
    ),
    data: normalizedLabels.map((_, dataIndex) =>
      clampedValue(dataset.data?.[dataIndex]),
    ),
  }));

  return renderCartesianChartSvg({
    title,
    subtitle,
    labels: normalizedLabels,
    series: series.length
      ? series
      : [
          {
            label: title,
            color: safeColor(primaryColor, palette[0]),
            data: normalizedLabels.map(() => 0),
          },
        ],
    type,
    width,
    height,
    theme,
    fontFamily: BROWSER_FONT_FAMILY,
    stacked,
    fit: false,
  });
}

export function renderReportChartSvg({
  title,
  subtitle,
  labels,
  series,
  type,
  width,
  height,
  stacked,
  events,
}: {
  events?: ReportChartEvent[];
  title?: string;
  subtitle?: string;
  labels: string[];
  series: ReportChartSeries[];
  type: Exclude<ReportChartType, "funnel">;
  width: number;
  height: number;
  stacked?: boolean;
}): string {
  const theme = CHART_THEMES.light;
  const palette = CHART_PALETTES.light;
  const normalizedLabels = labels.map((label) => String(label ?? ""));

  if (type === "pie") {
    return renderPieChartSvg({
      title: title ?? "",
      subtitle: subtitle ?? "",
      labels: normalizedLabels,
      series,
      width,
      height,
      theme,
      palette,
      fontFamily: REPORT_CHART_FONT_FAMILY,
    });
  }

  return renderCartesianChartSvg({
    title: title ?? "",
    subtitle: subtitle ?? "",
    labels: normalizedLabels,
    series: series.map((entry, index) => ({
      label: entry.label || `Series ${index + 1}`,
      color: safeColor(entry.color, palette[index % palette.length]),
      axis: entry.axis,
      ...(entry.formatter ? { formatter: entry.formatter } : {}),
      ...(type === "combo" && entry.mark ? { mark: entry.mark } : {}),
      data: normalizedLabels.map((_, dataIndex) =>
        exactValue(entry.data?.[dataIndex]),
      ),
    })),
    type,
    width,
    height,
    theme,
    fontFamily: REPORT_CHART_FONT_FAMILY,
    stacked: stacked ?? false,
    fit: true,
    events,
  });
}
