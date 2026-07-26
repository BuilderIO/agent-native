export type ReportChartType = "bar" | "line" | "area" | "pie";

export type ReportChartSeries = {
  label: string;
  data: Array<number | null>;
  color?: string;
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
 * Must stay equal to core's `OG_FONT_FAMILY`, the font actually bundled for
 * resvg. Serverless runtimes have no system fonts, so any other family renders
 * every `<text>` blank. Core does not re-export the constant from
 * `@agent-native/core/server`.
 */
export const REPORT_CHART_FONT_FAMILY = "Liberation Sans";

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

function formatTick(value: number): string {
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
};

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
}): string {
  const safeWidth = clampSize(width, 360, 2000);
  const safeHeight = clampSize(height, 240, 1200);
  const chartLeft = 58;
  const chartRight = safeWidth - 28;
  const chartTop = subtitle ? 88 : 66;
  const chartBottom = safeHeight - 48;
  const plotWidth = Math.max(1, chartRight - chartLeft);
  const plotHeight = Math.max(1, chartBottom - chartTop);

  const stackedBars = stacked && type === "bar";
  const stackedTotals = labels.map((_, index) =>
    series.reduce((sum, entry) => sum + (entry.data[index] ?? 0), 0),
  );
  const values = stackedBars
    ? stackedTotals
    : series.flatMap((entry) =>
        entry.data.filter((value): value is number => value !== null),
      );
  const maxValue = Math.max(1, ...values);
  const minValue = Math.min(0, ...values);
  const span = maxValue - minValue;
  const yFor = (value: number) =>
    chartBottom - ((value - minValue) / span) * plotHeight;
  const zeroY = yFor(0);
  const zeroText = formatCoord(zeroY);
  const slot = plotWidth / Math.max(labels.length, 1);
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = minValue + (span / 4) * (4 - index);
    const y = yFor(value);
    return `<line x1="${chartLeft}" x2="${chartRight}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${theme.gridColor}" stroke-width="0.8"/><text x="${chartLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.tickColor}">${escapeXml(formatTick(value))}</text>`;
  }).join("");

  const xLabels = labels
    .map((label, index) => {
      if (index % labelStep !== 0 && index !== labels.length - 1) return "";
      const x = chartLeft + slot * index + slot / 2;
      return `<text x="${x.toFixed(1)}" y="${safeHeight - 18}" text-anchor="middle" font-size="11" fill="${theme.tickColor}">${escapeXml(truncate(label, 14))}</text>`;
    })
    .join("");

  let marks = "";
  if (type === "bar" && stacked) {
    marks = labels
      .map((_, labelIndex) => {
        const x = chartLeft + slot * labelIndex + slot * 0.2;
        const barWidth = Math.max(5, slot * 0.6);
        let total = 0;
        return series
          .map((entry) => {
            const value = entry.data[labelIndex];
            if (value === null) return "";
            const from = yFor(total);
            total += value;
            const to = yFor(total);
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
            const y = yFor(value);
            return `<rect x="${x.toFixed(1)}" y="${Math.min(zeroY, y).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(2, Math.abs(zeroY - y)).toFixed(1)}" rx="4" fill="${entry.color}"/>`;
          })
          .join(""),
      )
      .join("");
  } else {
    marks = series
      .map((entry) => {
        const segments: Array<{ start: number; points: string[] }> = [];
        labels.forEach((_, index) => {
          const value = entry.data[index];
          if (value === null) return;
          const x = chartLeft + slot * index + slot / 2;
          const point = `${x.toFixed(1)},${yFor(value).toFixed(1)}`;
          const open = segments[segments.length - 1];
          if (open && open.start + open.points.length === index) {
            open.points.push(point);
            return;
          }
          segments.push({ start: index, points: [point] });
        });
        return segments
          .map(({ start, points }) => {
            const path = points
              .map((point, index) => `${index === 0 ? "M" : "L"} ${point}`)
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

  const axis = `<line x1="${chartLeft}" x2="${chartRight}" y1="${chartBottom}" y2="${chartBottom}" stroke="${theme.gridColor}" stroke-width="1"/>${
    minValue < 0
      ? `<line x1="${chartLeft}" x2="${chartRight}" y1="${zeroText}" y2="${zeroText}" stroke="${theme.tickColor}" stroke-width="1"/>`
      : ""
  }`;

  const legend =
    series.length > 1
      ? `<g transform="translate(${chartLeft},${subtitle ? 58 : 42})">${series
          .map((entry, index) => {
            const x = index * 148;
            return `<rect x="${x}" y="0" width="12" height="12" rx="3" fill="${entry.color}"/><text x="${x + 18}" y="11" font-size="12" fill="${theme.labelColor}">${escapeXml(entry.label)}</text>`;
          })
          .join("")}</g>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" font-family="${fontFamily}" role="img" aria-label="${escapeXml(title)}">
  <rect width="${safeWidth}" height="${safeHeight}" rx="8" fill="${theme.background}"/>
  <text x="24" y="32" font-family="${fontFamily}" font-size="22" font-weight="700" fill="${theme.titleColor}">${escapeXml(title)}</text>
  ${subtitle ? `<text x="24" y="54" font-family="${fontFamily}" font-size="13" fill="${theme.tickColor}">${escapeXml(subtitle)}</text>` : ""}
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
  const top = subtitle ? 88 : 66;
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
  <text x="24" y="32" font-family="${fontFamily}" font-size="22" font-weight="700" fill="${theme.titleColor}">${escapeXml(title)}</text>
  ${subtitle ? `<text x="24" y="54" font-family="${fontFamily}" font-size="13" fill="${theme.tickColor}">${escapeXml(subtitle)}</text>` : ""}
  ${wedges}
  ${hole}
  ${legend}
  ${overflow}
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
  type: ReportChartType;
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
  });
}
