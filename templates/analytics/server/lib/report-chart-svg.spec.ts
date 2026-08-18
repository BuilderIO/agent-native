import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  OG_FONT_FAMILY: "Liberation Sans",
}));

import {
  estimateTextWidth,
  REPORT_CHART_FONT_FAMILY,
  renderFunnelChartSvg,
  renderReportChartSvg,
  type ReportChartType,
} from "./report-chart-svg.js";

const base = {
  title: "Weekly signups",
  subtitle: "Last 4 weeks",
  labels: ["W1", "W2", "W3", "W4"],
  width: 720,
  height: 360,
};

function fontFamilies(svg: string): string[] {
  return [...svg.matchAll(/font-family="([^"]*)"/g)].map((match) => match[1]);
}

function pathCoordinates(svg: string): Array<[number, number]> {
  return [...svg.matchAll(/[ML] (-?[\d.]+),(-?[\d.]+)/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

const SIGNUPS_COLOR = "#0284C7";
const CONVERSION_COLOR = "#0D9488";

/** Vertical travel of one series' stroked path, in user units. */
function strokePathHeight(svg: string, stroke: string): number {
  const ys = [...svg.matchAll(/<path d="([^"]*)"[^>]*stroke="([^"]*)"/g)]
    .filter((match) => match[2] === stroke)
    .flatMap((match) =>
      [...match[1].matchAll(/[ML] -?[\d.]+,(-?[\d.]+)/g)].map((point) =>
        Number(point[1]),
      ),
    );
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
}

function rightAxisTicks(svg: string): string[] {
  return [
    ...svg.matchAll(/<text x="[\d.]+"[^>]*text-anchor="start"[^>]*>([^<]*)</g),
  ].map((match) => match[1]);
}

function legendEntries(
  svg: string,
): Array<{ label: string; x: number; row: number }> {
  const group =
    svg.match(/<g transform="translate\(58,[\d.]+\)">([\s\S]*?)<\/g>/)?.[1] ??
    "";
  return [
    ...group.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)"[^>]*\/><text x="[\d.]+" y="[\d.]+"[^>]*>([^<]*)<\/text>/g,
    ),
  ].map((match) => ({
    x: Number(match[1]),
    row: Number(match[2]),
    label: match[3],
  }));
}

function legendOverflow(svg: string): string | null {
  const group =
    svg.match(/<g transform="translate\(58,[\d.]+\)">([\s\S]*?)<\/g>/)?.[1] ??
    "";
  return group.match(/>(\+\d+ more)</)?.[1] ?? null;
}

function headerLines(svg: string, fontSize: number): string[] {
  return [
    ...svg.matchAll(
      new RegExp(`<text x="24"[^>]*font-size="${fontSize}"[^>]*>([^<]*)<`, "g"),
    ),
  ].map((match) => match[1]);
}

function xAxisLabels(
  svg: string,
  height: number,
): Array<{ text: string; x: number; left: number; right: number }> {
  return [
    ...svg.matchAll(
      new RegExp(
        `<text x="([\\d.]+)" y="${height - 18}" text-anchor="middle"[^>]*>([^<]*)<`,
        "g",
      ),
    ),
  ].map((match) => {
    const x = Number(match[1]);
    const half = estimateTextWidth(match[2], 11) / 2;
    return { text: match[2], x, left: x - half, right: x + half };
  });
}

describe("renderReportChartSvg", () => {
  const types: Array<Exclude<ReportChartType, "funnel">> = [
    "bar",
    "line",
    "area",
    "pie",
  ];

  it.each(types)("renders an svg for %s", (type) => {
    const svg = renderReportChartSvg({
      ...base,
      type,
      series: [{ label: "Signups", data: [4, 9, 2, 7] }],
    });

    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("Weekly signups");
  });

  it.each(types)("uses only the bundled font family for %s", (type) => {
    const svg = renderReportChartSvg({
      ...base,
      type,
      series: [
        { label: "Signups", data: [4, 9, 2, 7] },
        { label: "Churn", data: [1, 2, 3, 4] },
      ],
    });

    const families = fontFamilies(svg);
    expect(families.length).toBeGreaterThan(0);
    expect([...new Set(families)]).toEqual([REPORT_CHART_FONT_FAMILY]);
    expect(svg).not.toContain("ui-sans-serif");
    expect(svg).not.toContain("system-ui");
    expect(svg).not.toContain("Inter");
  });

  it("breaks the line path at a null instead of plotting a zero", () => {
    const svg = renderReportChartSvg({
      ...base,
      labels: [...base.labels, "W5"],
      type: "line",
      series: [{ label: "Signups", data: [10, 10, null, 10, 10] }],
    });

    expect(svg.match(/ d="M /g)).toHaveLength(2);

    const gapless = renderReportChartSvg({
      ...base,
      type: "line",
      series: [{ label: "Signups", data: [10, 10, 10, 10] }],
    });
    expect(gapless.match(/ d="M /g)).toHaveLength(1);

    const zeroed = renderReportChartSvg({
      ...base,
      type: "line",
      series: [{ label: "Signups", data: [10, 0, 10, 10] }],
    });
    const baselineY = Math.max(...pathCoordinates(zeroed).map(([, y]) => y));
    expect(pathCoordinates(svg).some(([, y]) => y === baselineY)).toBe(false);
  });

  it.each(["line", "area"] as const)(
    "draws an isolated %s point as a visible dot",
    (type) => {
      const gapped = renderReportChartSvg({
        ...base,
        type,
        series: [{ label: "Signups", data: [null, 42, null, null] }],
      });

      expect(gapped).toContain("<circle");
      expect(gapped).not.toMatch(/<path d="M [\d.]+,[\d.]+"/);

      const single = renderReportChartSvg({
        ...base,
        labels: ["W1"],
        type,
        series: [{ label: "Signups", data: [42] }],
      });
      expect(single).toContain("<circle");

      const paired = renderReportChartSvg({
        ...base,
        type,
        series: [{ label: "Signups", data: [null, 42, 7, null] }],
      });
      expect(paired).not.toContain("<circle");
      expect(paired.match(/ d="M /g)).toHaveLength(type === "area" ? 2 : 1);
    },
  );

  it("plots a right-axis series against its own domain", () => {
    const dual = renderReportChartSvg({
      ...base,
      type: "line",
      series: [
        { label: "Signups", data: [1000, 2000, 3000, 4000] },
        { label: "Conversion", data: [0.1, 0.2, 0.3, 0.4], axis: "right" },
      ],
    });
    const single = renderReportChartSvg({
      ...base,
      type: "line",
      series: [
        { label: "Signups", data: [1000, 2000, 3000, 4000] },
        { label: "Conversion", data: [0.1, 0.2, 0.3, 0.4] },
      ],
    });

    // Sharing the signups scale squashes the rate onto the baseline; its own
    // axis has to give it the same vertical travel as the series it tracks.
    expect(strokePathHeight(single, CONVERSION_COLOR)).toBeLessThan(1);
    expect(strokePathHeight(dual, CONVERSION_COLOR)).toBeCloseTo(
      strokePathHeight(dual, SIGNUPS_COLOR),
      1,
    );
    expect(rightAxisTicks(dual)).toEqual(["0.4", "0.3", "0.2", "0.1", "0"]);
    expect(rightAxisTicks(single)).toEqual([]);
    expect(legendEntries(dual).map((entry) => entry.label)).toEqual([
      "Signups",
      "Conversion (right)",
    ]);
  });

  it("formats report axis ticks with the same percent formatter as the dashboard", () => {
    const svg = renderReportChartSvg({
      ...base,
      type: "line",
      series: [
        { label: "Signups", data: [10, 20, 30, 40] },
        {
          label: "Conversion",
          data: [0.1, 0.2, 0.3, 0.4],
          axis: "right",
          formatter: "percent",
        },
      ],
    });

    expect(rightAxisTicks(svg)).toEqual([
      "40.00%",
      "30.00%",
      "20.00%",
      "10.00%",
      "0.00%",
    ]);
  });

  it("stacks bars per axis instead of summing two units into one bar", () => {
    const svg = renderReportChartSvg({
      ...base,
      labels: ["Q1"],
      type: "bar",
      stacked: true,
      series: [
        { label: "Revenue", data: [10] },
        { label: "Costs", data: [20] },
        { label: "Margin", data: [0.4], axis: "right" },
      ],
    });

    // Left stack tops out at 30; the right-axis bar starts from its own zero
    // rather than being piled on top of the currency stack.
    expect(svg).toContain(">30<");
    expect(rightAxisTicks(svg)).toEqual(["0.4", "0.3", "0.2", "0.1", "0"]);
  });

  it("keeps a mixed-sign stacked bar inside the plot area", () => {
    const svg = renderReportChartSvg({
      ...base,
      labels: ["Q1"],
      type: "bar",
      stacked: true,
      series: [
        { label: "Revenue", data: [10] },
        { label: "Refunds", data: [-20] },
      ],
    });

    const bars = [...svg.matchAll(/<rect [^>]*y="(-?[\d.]+)"[^>]*rx="4"/g)];
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(Number(bar[1])).toBeGreaterThanOrEqual(0);
    }
    expect(svg).toContain(">10<");

    const positiveOnly = renderReportChartSvg({
      ...base,
      labels: ["Q1"],
      type: "bar",
      stacked: true,
      series: [
        { label: "Revenue", data: [10] },
        { label: "Fees", data: [20] },
      ],
    });
    expect(positiveOnly).toContain(">30<");
  });

  it("omits the bar for a null value", () => {
    const withNull = renderReportChartSvg({
      ...base,
      type: "bar",
      series: [{ label: "Signups", data: [4, null, 2, 7] }],
    });
    const complete = renderReportChartSvg({
      ...base,
      type: "bar",
      series: [{ label: "Signups", data: [4, 5, 2, 7] }],
    });

    expect(withNull.match(/<rect/g)).toHaveLength(
      (complete.match(/<rect/g) ?? []).length - 1,
    );
  });

  it("keeps negative values and draws a zero baseline", () => {
    const svg = renderReportChartSvg({
      ...base,
      type: "bar",
      series: [{ label: "Delta", data: [-4, 8, -2, 6] }],
    });

    expect(svg).toContain(">-4<");
    const gridLines = svg.match(/<line /g) ?? [];
    const positiveOnly = renderReportChartSvg({
      ...base,
      type: "bar",
      series: [{ label: "Delta", data: [4, 8, 2, 6] }],
    });
    expect(gridLines.length).toBe(
      (positiveOnly.match(/<line /g) ?? []).length + 1,
    );
  });

  it("draws a single 100% pie slice as a full circle", () => {
    const svg = renderReportChartSvg({
      ...base,
      labels: ["Only"],
      type: "pie",
      series: [{ label: "Share", data: [42] }],
    });

    expect(svg).toContain("100.0%");
    expect(svg).not.toContain("<path");
    expect(svg.match(/<circle/g)).toHaveLength(2);
  });

  it("draws no slices when every pie value is zero", () => {
    const svg = renderReportChartSvg({
      ...base,
      type: "pie",
      series: [{ label: "Share", data: [0, 0, 0, 0] }],
    });

    expect(svg).not.toContain("<path");
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("n/a");
  });

  it("labels a null pie slice as missing rather than zero", () => {
    const svg = renderReportChartSvg({
      ...base,
      type: "pie",
      series: [{ label: "Share", data: [5, null, 5, 5] }],
    });

    expect(svg).toContain("no data");
    expect(svg.match(/<path/g)).toHaveLength(3);
  });

  it("renders an axis with no marks when there are no series", () => {
    const svg = renderReportChartSvg({ ...base, type: "bar", series: [] });

    expect(svg).toContain("<svg ");
    expect(svg).not.toContain("<rect x=");
  });

  it("cannot be broken out of by a hostile color or label", () => {
    const hostile = '"><script>alert(1)</script>';
    const svg = renderReportChartSvg({
      title: hostile,
      subtitle: hostile,
      labels: [hostile, "ok"],
      width: 720,
      height: 360,
      type: "bar",
      series: [{ label: hostile, data: [1, 2], color: hostile }],
    });

    expect(svg).not.toContain("<script");
    expect(svg).not.toContain('"><');
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&quot;");
    expect(svg).toContain('fill="#0284C7"');
    expect(fontFamilies(svg)).toEqual(
      fontFamilies(svg).map(() => REPORT_CHART_FONT_FAMILY),
    );

    const pieSvg = renderReportChartSvg({
      ...base,
      type: "pie",
      series: [{ label: hostile, data: [1, 2], color: hostile }],
    });
    expect(pieSvg).not.toContain("<script");
  });

  it("clamps out-of-range dimensions", () => {
    const svg = renderReportChartSvg({
      ...base,
      type: "bar",
      series: [{ label: "Signups", data: [1] }],
      width: 40,
      height: 99_999,
    });

    expect(svg).toContain('width="360"');
    expect(svg).toContain('height="1200"');
  });

  it("wraps a many-series legend instead of dropping entries", () => {
    const templates = [
      "analytics",
      "assets",
      "brain",
      "calendar",
      "chat",
      "clips",
      "content",
      "crm",
      "design",
      "forms",
      "mail",
      "plan",
      "slides",
      "todo",
      "workspace",
    ];
    const svg = renderReportChartSvg({
      ...base,
      width: 920,
      type: "area",
      stacked: true,
      series: templates.map((label, index) => ({
        label,
        data: base.labels.map(() => index + 1),
      })),
    });

    const entries = legendEntries(svg);
    expect(entries.map((entry) => entry.label)).toEqual(templates);
    expect(legendOverflow(svg)).toBeNull();
    expect(new Set(entries.map((entry) => entry.row)).size).toBeGreaterThan(1);

    const plotWidth = 920 - 28 - 58;
    for (const entry of entries) {
      const width = 18 + estimateTextWidth(entry.label, 12);
      expect(entry.x + width).toBeLessThanOrEqual(plotWidth);
    }

    // The plot has to start below the taller legend.
    const lastRow = Math.max(...entries.map((entry) => entry.row));
    const legendBottom = 75 + lastRow + 12;
    const firstGridY = Number(svg.match(/<line [^>]*y1="([\d.]+)"/)?.[1]);
    expect(firstGridY).toBeGreaterThan(legendBottom);
  });

  it("marks legend overflow instead of silently dropping series", () => {
    const series = Array.from({ length: 40 }, (_, index) => ({
      label: `a-fairly-long-series-label-${index}`,
      data: base.labels.map(() => index),
    }));
    const svg = renderReportChartSvg({ ...base, type: "bar", series });

    const entries = legendEntries(svg);
    const overflow = legendOverflow(svg);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(series.length);
    expect(overflow).toBe(`+${series.length - entries.length} more`);
    expect(new Set(entries.map((entry) => entry.row)).size).toBe(3);

    const group =
      svg.match(/<g transform="translate\(58,[\d.]+\)">([\s\S]*?)<\/g>/)?.[1] ??
      "";
    const marker = group.match(/<text x="([\d.]+)"[^>]*>(\+\d+ more)<\/text>/);
    expect(marker).not.toBeNull();
    expect(
      Number(marker?.[1]) + estimateTextWidth(marker?.[2] ?? "", 12),
    ).toBeLessThanOrEqual(920 - 28 - 58);
  });

  it("fits a long title and subtitle inside the chart width", () => {
    const subtitle =
      "Distinct signed-in browser identities per day, stacked by inferred template/app. Docs traffic is excluded. This is signed-in activity, not true account-level DAU, so the same person can count once per template and the totals overlap.";
    const svg = renderReportChartSvg({
      ...base,
      title:
        "Signed-In Daily Active Visitors by Template, Excluding Documentation Traffic and Internal Sessions",
      subtitle,
      width: 920,
      type: "line",
      series: [{ label: "Visitors", data: [1, 2, 3, 4] }],
    });

    const available = 920 - 48;
    const titleLines = headerLines(svg, 22);
    expect(titleLines).toHaveLength(1);
    expect(titleLines[0]).toMatch(/\.\.\.$/);
    expect(estimateTextWidth(titleLines[0], 22)).toBeLessThanOrEqual(available);

    const subtitleLines = headerLines(svg, 13);
    expect(subtitleLines.length).toBeGreaterThan(1);
    expect(subtitleLines.length).toBeLessThanOrEqual(2);
    expect(svg).not.toContain(subtitle);
    for (const line of subtitleLines) {
      expect(estimateTextWidth(line, 13)).toBeLessThanOrEqual(available);
    }
  });

  it("never overlaps or clips an x-axis label", () => {
    const labels = Array.from({ length: 31 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 5, 26));
      day.setUTCDate(day.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
    const svg = renderReportChartSvg({
      ...base,
      labels,
      width: 920,
      type: "area",
      series: [{ label: "Visitors", data: labels.map((_, i) => i) }],
    });

    const drawn = xAxisLabels(svg, 360);
    expect(drawn.length).toBeGreaterThan(2);
    expect(drawn[0].text).toBe(labels[0]);
    expect(drawn[drawn.length - 1].text).toBe(labels[labels.length - 1]);
    expect(drawn.map((label) => label.text)).not.toContain(labels[29]);
    expect(drawn[0].left).toBeGreaterThanOrEqual(0);
    expect(drawn[drawn.length - 1].right).toBeLessThanOrEqual(920);
    for (let index = 1; index < drawn.length; index += 1) {
      expect(drawn[index].left).toBeGreaterThan(drawn[index - 1].right);
    }
  });

  it("is deterministic", () => {
    const args = {
      ...base,
      type: "area" as const,
      series: [{ label: "Signups", data: [1, null, -3, 7] }],
    };
    expect(renderReportChartSvg(args)).toBe(renderReportChartSvg(args));
  });
});

describe("renderFunnelChartSvg", () => {
  it("renders ordered stages with conversion metadata", () => {
    const svg = renderFunnelChartSvg({
      title: "Pipeline",
      rows: [
        {
          label: "Visited",
          value: 100,
          percentOfFirst: 100,
          dropOffPercent: null,
        },
        {
          label: "Signed up",
          value: 50,
          percentOfFirst: 50,
          dropOffPercent: 50,
        },
      ],
      width: 720,
      height: 360,
    });

    expect(svg).toContain("Visited");
    expect(svg).toContain("Signed up");
    expect(svg).toContain("↓50.0%");
    expect(svg).toContain('aria-label="Pipeline"');
  });
});
