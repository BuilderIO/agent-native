import type { DashboardFunnelItem } from "@agent-native/toolkit/dashboard/funnel-chart";
import {
  BROWSER_FONT_FAMILY,
  renderFunnelChartSvg,
  renderReportChartSvg,
  type ReportChartEvent,
} from "@agent-native/toolkit/dashboard/report-chart-svg";
import type { AnalyticsChartData } from "@shared/analytics-chart-block";

/** Matches the min-h-70 class (280px) on the chart box in AnalyticsChartBlock. */
export const ANALYTICS_CHART_HEIGHT = 280;

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Draws a kept chart with the same renderer Analytics' report emails use, in
 * the page's theme and the browser's font. Metrics and tables aren't SVG and
 * return null.
 */
export function analyticsChartSvg(
  data: AnalyticsChartData,
  options: { width: number; theme: "light" | "dark" },
): string | null {
  const type = data.panel.type;
  if (type === "metric" || type === "table") return null;
  const width = Math.max(280, Math.round(options.width));
  const appearance = {
    theme: options.theme,
    fontFamily: BROWSER_FONT_FAMILY,
  } as const;

  if (type === "funnel") {
    const rows: DashboardFunnelItem[] = data.rows.map((row) => ({
      label: String(row[0] ?? ""),
      value: numberOrNull(row[1]) ?? 0,
      percentOfFirst: numberOrNull(row[2]) ?? 0,
      dropOffPercent: numberOrNull(row[3]),
    }));
    const [series] = data.series ?? [];
    return renderFunnelChartSvg({
      rows,
      width,
      height: ANALYTICS_CHART_HEIGHT,
      ...(series?.formatter ? { formatter: series.formatter } : {}),
      ...(series?.color ? { colors: [series.color] } : {}),
      ...appearance,
    });
  }

  const labels = data.rows.map((row) => String(row[0] ?? ""));
  const indexByLabel = new Map(labels.map((label, index) => [label, index]));
  const events: ReportChartEvent[] = (data.keyDates ?? []).flatMap((date) => {
    const index = indexByLabel.get(date.x);
    return index === undefined
      ? []
      : [
          {
            index,
            label: date.label,
            ...(date.color ? { color: date.color } : {}),
          },
        ];
  });
  return renderReportChartSvg({
    type,
    labels,
    series: (data.series ?? []).map((series, index) => ({
      ...series,
      data: data.rows.map((row) => numberOrNull(row[index + 1])),
    })),
    width,
    height: ANALYTICS_CHART_HEIGHT,
    ...(data.stacked ? { stacked: true } : {}),
    ...(events.length ? { events } : {}),
    ...appearance,
  });
}

/** An SVG as an image source, so nothing in it runs in the page. */
export function svgImageSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
