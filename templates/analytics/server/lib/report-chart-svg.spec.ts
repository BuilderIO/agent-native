import { describe, expect, it } from "vitest";

import {
  REPORT_CHART_FONT_FAMILY,
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

describe("renderReportChartSvg", () => {
  const types: ReportChartType[] = ["bar", "line", "area", "pie"];

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

  it("is deterministic", () => {
    const args = {
      ...base,
      type: "area" as const,
      series: [{ label: "Signups", data: [1, null, -3, 7] }],
    };
    expect(renderReportChartSvg(args)).toBe(renderReportChartSvg(args));
  });
});
