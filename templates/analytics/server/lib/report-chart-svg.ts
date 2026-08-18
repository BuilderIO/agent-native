import { OG_FONT_FAMILY } from "@agent-native/core/server";

import type { DashboardFunnelItem } from "../../shared/dashboard-funnel";

export type ReportChartType = "bar" | "line" | "area" | "pie" | "funnel";

export type ReportChartAxis = "left" | "right";

export type ReportChartValueFormatter = "number" | "currency" | "percent";

export type ReportChartSeries = {
  label: string;
  data: Array<number | null>;
  color?: string;
  axis?: ReportChartAxis;
  formatter?: ReportChartValueFormatter;
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

/**
 * The family resvg actually has bundled. Serverless runtimes ship no system
 * fonts, so asking for any other family renders every `<text>` blank.
 */
export const REPORT_CHART_FONT_FAMILY = OG_FONT_FAMILY;

const BROWSER_FONT_FAMILY =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const NEUTRAL_COLOR = "#71717a";

function escapeXml(value: unknown): string {
  return String(value ?? "")
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
  if (formatter === "currency") return `$${value.toLocaleString()}`;
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

/**
 * resvg gives no text metrics, so every width here is estimated from glyph
 * classes. Overestimating is the safe direction: layout leaves a gap, it does
 * not clip.
 */
export function estimateTextWidth(value: string, fontSize: number): number {
  let units = 0;
  for (const char of value) {
    if (char === " ") {
      units += 0.28;
    } else if (/[MW@#%&]/.test(char)) {
      units += 0.86;
    } else if (/[A-Z]/.test(char)) {
      units += 0.64;
    } else if (/[ilI.,:;|!']/u.test(char)) {
      units += 0.26;
    } else if (/[0-9]/.test(char)) {
      units += 0.56;
    } else {
      units += 0.54;
    }
  }
  return units * fontSize;
}

function trimToWidth(
  value: string,
  fontSize: number,
  maxWidth: number,
): string {
  if (estimateTextWidth(value, fontSize) <= maxWidth) return value;
  let trimmed = value;
  while (trimmed && estimateTextWidth(`${trimmed}...`, fontSize) > maxWidth) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed ? `${trimmed}...` : "";
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
  // Bold glyphs run wider than the regular-weight estimate.
  const titleText = fit ? trimToWidth(title, 22 * 1.06, maxWidth) : title;
  const subtitleLines = !subtitle
    ? []
    : fit
      ? wrapToWidth(subtitle, 13, maxWidth, 2)
      : [subtitle];

  // Email cards already render the title and description as HTML, so the report
  // path passes neither and the header collapses to nothing. Legacy callers
  // always supply a title, so their output is unchanged.
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

/**
 * Every stepped label plus both endpoints, minus any that would collide with
 * the label to its left. The final label wins ties so the range end is always
 * readable, and both endpoints are nudged inward to stay on canvas.
 */
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
  // Only an axis with nothing above zero borrows a headroom of 1; forcing that
  // floor on real data flattens a rate series that never leaves 0..1.
  const observedMax = values.length ? Math.max(...values) : 0;
  const max = observedMax > 0 ? observedMax : min < 0 ? 0 : 1;
  const span = max - min || 1;
  const yFor = (value: number) =>
    chartBottom - ((value - min) / span) * plotHeight;
  return { min, span, yFor, zeroY: yFor(0) };
}

/**
 * Segment edges for a stacked bar group. Positives and negatives stack away
 * from zero separately, and the y-domain has to cover every segment edge — the
 * running total alone puts a mixed-sign stack's tallest bar off-canvas.
 */
function stackSegments(
  series: ResolvedSeries[],
  seriesIndexes: number[],
  labelCount: number,
): Map<string, { base: number; top: number }> {
  const segments = new Map<string, { base: number; top: number }>();
  for (let labelIndex = 0; labelIndex < labelCount; labelIndex += 1) {
    let up = 0;
    let down = 0;
    for (const seriesIndex of seriesIndexes) {
      const value = series[seriesIndex].data[labelIndex];
      if (value === null) continue;
      const base = value >= 0 ? up : down;
      if (value >= 0) up += value;
      else down += value;
      segments.set(`${labelIndex}:${seriesIndex}`, { base, top: base + value });
    }
  }
  return segments;
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
}: {
  title: string;
  subtitle: string;
  labels: string[];
  series: ResolvedSeries[];
  type: "bar" | "line" | "area";
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
  const chartBottom = safeHeight - 48;
  const plotWidth = Math.max(1, chartRight - chartLeft);

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
  // A static image has no tooltip to reveal which scale a series belongs to.
  const legendSeries = dualAxis
    ? series.map((entry) =>
        entry.axis === "right"
          ? { ...entry, label: `${entry.label} (right)` }
          : entry,
      )
    : series;
  const legendLayout =
    fit && series.length > 1 ? layoutLegend(legendSeries, plotWidth) : null;
  const chartTop = !fit
    ? subtitle
      ? 88
      : 66
    : legendLayout
      ? legendTop + (legendLayout.rows.length - 1) * LEGEND_ROW_HEIGHT + 30
      : header.headerBottom + 34;
  const plotHeight = Math.max(1, chartBottom - chartTop);

  const stackedBars = stacked && type === "bar";
  // Stacks group per axis, matching how the dashboard renderer stacks them, so
  // a dual-axis chart never sums two different units into one bar.
  const stackedSegments = stackedBars
    ? new Map([
        ...stackSegments(series, leftAxisIndexes, labels.length),
        ...stackSegments(series, rightAxisIndexes, labels.length),
      ])
    : new Map<string, { base: number; top: number }>();

  const axisValues = (seriesIndexes: number[]): number[] =>
    stackedBars
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

  const slot = plotWidth / Math.max(labels.length, 1);
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  // Both scales use the same five fractional positions, so the right-hand tick
  // labels line up with the gridlines drawn from the left scale.
  const grid = Array.from({ length: 5 }, (_, index) => {
    const fraction = (4 - index) / 4;
    const value = leftScale.min + leftScale.span * fraction;
    const y = leftScale.yFor(value);
    const rightTick = dualAxis
      ? `<text x="${chartRight + 10}" y="${(y + 4).toFixed(1)}" text-anchor="start" font-size="11" fill="${theme.tickColor}">${escapeXml(formatTick(rightScale.min + rightScale.span * fraction, rightFormatter))}</text>`
      : "";
    return `<line x1="${chartLeft}" x2="${chartRight}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${theme.gridColor}" stroke-width="0.8"/><text x="${chartLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.tickColor}">${escapeXml(formatTick(value, leftFormatter))}</text>${rightTick}`;
  }).join("");

  const centerFor = (index: number) => chartLeft + slot * index + slot / 2;
  const xLabels = fit
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
          if (index % labelStep !== 0 && index !== labels.length - 1) return "";
          return `<text x="${centerFor(index).toFixed(1)}" y="${safeHeight - 18}" text-anchor="middle" font-size="11" fill="${theme.tickColor}">${escapeXml(truncate(label, 14))}</text>`;
        })
        .join("");

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
  } else if (type === "bar") {
    const groupWidth = slot * 0.72;
    const barWidth = Math.max(4, groupWidth / Math.max(series.length, 1) - 2);
    marks = labels
      .map((_, labelIndex) =>
        series
          .map((entry, seriesIndex) => {
            const value = entry.data[labelIndex];
            if (value === null) return "";
            const x =
              chartLeft +
              slot * labelIndex +
              slot * 0.14 +
              seriesIndex * (barWidth + 2);
            const { yFor, zeroY } = scaleFor(seriesIndex);
            const y = yFor(value);
            return `<rect x="${x.toFixed(1)}" y="${Math.min(zeroY, y).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(2, Math.abs(zeroY - y)).toFixed(1)}" rx="4" fill="${entry.color}"/>`;
          })
          .join(""),
      )
      .join("");
  } else {
    marks = series
      .map((entry, seriesIndex) => {
        const { yFor, zeroY } = scaleFor(seriesIndex);
        const zeroText = formatCoord(zeroY);
        const segments: Array<{
          start: number;
          points: Array<[string, string]>;
        }> = [];
        labels.forEach((_, index) => {
          const value = entry.data[index];
          if (value === null) return;
          const x = chartLeft + slot * index + slot / 2;
          const point: [string, string] = [
            x.toFixed(1),
            yFor(value).toFixed(1),
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
            // A subpath with a single moveto strokes nothing, so a point with
            // gaps on both sides has to be drawn as its own dot or it vanishes.
            if (points.length === 1) {
              const [x, y] = points[0];
              return `<circle cx="${x}" cy="${y}" r="3.5" fill="${entry.color}"/>`;
            }
            const path = points
              .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x},${y}`)
              .join(" ");
            const area =
              type === "area"
                ? `<path d="${path} L ${chartLeft + slot * (start + points.length - 0.5)},${zeroText} L ${chartLeft + slot * (start + 0.5)},${zeroText} Z" fill="${entry.color}" fill-opacity="0.18"/>`
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

export function renderFunnelChartSvg({
  title,
  subtitle,
  rows,
  width,
  height,
  formatter,
  colors,
}: {
  title?: string;
  subtitle?: string;
  rows: DashboardFunnelItem[];
  width: number;
  height: number;
  formatter?: ReportChartValueFormatter;
  colors?: string[];
}): string {
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

/**
 * Browser-facing renderer: clamps every value to a non-negative number and uses
 * a system font stack. Kept for `generate-chart`'s saved-artifact fallback; the
 * clamping makes it unsuitable for reports, where a gap must stay a gap.
 */
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

/**
 * Email-report renderer: light theme, bundled font, and honest values — `null`
 * stays a gap and negatives keep their sign.
 */
export function renderReportChartSvg({
  title,
  subtitle,
  labels,
  series,
  type,
  width,
  height,
  stacked,
}: {
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
  });
}
