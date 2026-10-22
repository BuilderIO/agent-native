import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { DataChartRenderer } from "./DataChartRenderer.js";

const chart: DataChartWidgetData = {
  type: "bar",
  xKey: "day",
  series: [
    { key: "first", label: "First" },
    { key: "second", label: "Second" },
    { key: "third", label: "Third" },
    { key: "fourth", label: "Fourth" },
  ],
  data: [{ day: "Monday", first: 1, second: 2, third: 3, fourth: 4 }],
};

describe("DataChartRenderer theme colors", () => {
  it("uses the validated row range when rendering a capped chart", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: Array.from({ length: 201 }, (_, index) => ({
            day: `Day ${index}`,
            value: index === 200 ? 1000 : 1,
          })),
          valueAxisTickInterval: 1,
        }}
      />,
    );

    expect(Array.from(markup.matchAll(/<rect /g))).toHaveLength(200);
    expect(markup).toContain(">Day 199</text>");
    expect(markup).not.toContain(">Day 200</text>");
  });

  it("resolves its series colors through app chart tokens with legacy fallbacks", () => {
    const markup = renderToStaticMarkup(<DataChartRenderer chart={chart} />);

    expect(markup).toContain('viewBox="0 0 640 360"');
    expect(markup).toContain("block w-full h-auto");
    expect(markup).not.toContain("style=");
    expect(markup).not.toContain("preserveAspectRatio");
    expect(markup).not.toContain("h-60");
    expect(markup).toContain('fill="hsl(var(--chart-1, var(--primary)))"');
    expect(markup).toContain('fill="hsl(var(--chart-2, 199 89% 48%))"');
    expect(markup).toContain('fill="hsl(var(--chart-3, 151 55% 42%))"');
    expect(markup).toContain('fill="hsl(var(--chart-4, 35 92% 50%))"');
    expect(markup).toContain('stroke="hsl(var(--chart-grid, var(--border)))"');
  });

  it("applies app chart sizing, plot insets, typography, and integer tick labels", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "First", value: 0 },
            { day: "Last", value: 1 },
          ],
          valueAxisTickInterval: 0.1,
        }}
        layout={{
          plotInsets: { top: 6, right: 8, bottom: 29 },
          labelFontFamily: "IBM Plex Sans",
          labelFontSize: 14,
          labelTone: "foreground",
        }}
      />,
    );

    expect(markup).toContain('font-family="IBM Plex Sans"');
    expect(markup).toContain('font-size="14"');
    expect(markup).toMatch(
      /<text[^>]*fill="hsl\(var\(--foreground\)\)"[^>]*>First<\/text>/,
    );
    expect(markup).toMatch(/<line x1="[^"]+" x2="632" y1="6" y2="6"/);
    expect(markup).toMatch(/<line x1="[^"]+" x2="632" y1="331" y2="331"/);
    expect(markup).toContain(">1</text>");
    expect(markup).not.toContain(">1.0</text>");
  });

  it("keeps a configured right plot inset while sizing the category labels", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: 3 }],
          showValueLabels: true,
          valueAxisTickInterval: 0.2,
        }}
        layout={{ plotInsets: { right: 8 } }}
      />,
    );

    const plotRightEdge = Number(
      markup.match(/<line x1="[\d.]+" x2="([\d.]+)" y1="14" y2="326"/)?.[1],
    );
    expect(plotRightEdge).toBeLessThanOrEqual(632);
    expect(markup).toContain('fill="hsl(var(--muted-foreground))"');
    const maximumBarValueLabel = markup.match(
      /<text x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="11" font-weight="400" text-anchor="start">3<\/text>/,
    );
    expect(maximumBarValueLabel).not.toBeNull();
    expect(Number(maximumBarValueLabel?.[1]) + 8).toBeLessThanOrEqual(
      plotRightEdge,
    );
  });

  it("rejects inset combinations that leave no positive plot area", () => {
    const renderWithInsets = (plotInsets: { right?: number; top?: number }) =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type: "line",
            xKey: "day",
            series: [{ key: "value", label: "Value" }],
            data: [{ day: "Monday", value: 1 }],
          }}
          layout={{ plotInsets }}
        />,
      );

    expect(() => renderWithInsets({ right: 600 })).toThrow(
      "positive chart plot area",
    );
    expect(() => renderWithInsets({ top: 400 })).toThrow(
      "positive chart plot area",
    );
  });

  it("keeps a vertical bar chart's final category label inside the SVG", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: Array.from({ length: 10 }, (_, index) => ({
            day: index === 9 ? "Last category label" : `Day ${index}`,
            value: index,
          })),
        }}
        layout={{ plotInsets: { right: 8 } }}
      />,
    );
    const finalCategory = markup.match(
      /<text x="([\d.]+)" y="348"[^>]*text-anchor="end">Last category\.\.\.<\/text>/,
    );

    expect(finalCategory).not.toBeNull();
    expect(Number(finalCategory?.[1])).toBeLessThanOrEqual(632);
  });

  it("preserves the top value-axis label when the configured top inset is zero", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Monday", value: 0 },
            { day: "Tuesday", value: 1 },
          ],
          valueAxisTickInterval: 0.5,
        }}
        layout={{ labelFontSize: 12, plotInsets: { top: 0 } }}
      />,
    );
    const topTick = markup.match(
      /<text x="[\d.]+" y="([\d.]+)"[^>]*>1<\/text>/,
    );

    expect(topTick).not.toBeNull();
    expect(Number(topTick?.[1])).toBeGreaterThanOrEqual(12);
  });

  it("keeps horizontal axis tick labels inside the chart at zero edge insets", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: 3 }],
          valueAxisTickInterval: 1,
          xAxisTitle: "Value",
        }}
        layout={{ plotInsets: { right: 0, bottom: 0 } }}
      />,
    );
    const finalTick = Array.from(
      markup.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g),
    )
      .filter((match) => match[3] === "3")
      .slice(-1)[0];

    expect(finalTick).toBeDefined();
    expect(Number(finalTick?.[1])).toBeLessThan(640);
    expect(Number(finalTick?.[1]) + 4).toBeLessThanOrEqual(640);
    expect(Number(finalTick?.[2])).toBeLessThan(340);
  });

  it("uses the requested chart content height", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer chart={{ ...chart, contentHeight: 400 }} />,
    );

    expect(markup).toContain('style="height:400px;padding:0px"');
    expect(markup).toContain(
      'class="agent-data-chart-renderer block w-full h-full"',
    );
    expect(markup).toContain('viewBox="0 0 640 360"');
    expect(markup).toContain('preserveAspectRatio="none"');
  });

  it("fits labels and the chart canvas inside a padded body box", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          ...chart,
          contentHeight: 400,
          contentPadding: 16,
          labelFontFamily: "sans",
          labelFontSize: 14,
        }}
      />,
    );

    expect(markup).toContain('style="height:400px;padding:16px"');
    expect(markup).toContain(
      'font-family="var(--font-sans, ui-sans-serif, system-ui, sans-serif)"',
    );
    expect(markup).toContain('font-size="14"');
  });

  it("renders optional horizontal titles and value labels with their font roles", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          ...chart,
          layout: "horizontal",
          xAxisTitle: "Value",
          yAxisTitle: "Category",
          showValueLabels: true,
          labelFontSize: 10,
          axisTitleFontSize: 11,
          axisTitleFontWeight: 500,
          valueLabelFontSize: 11,
          valueLabelFontWeight: 400,
        }}
      />,
    );

    expect(markup).toContain(">Value</text>");
    expect(markup).toContain(">Category</text>");
    expect(markup).toContain('font-size="10"');
    expect(markup).toContain('font-size="11"');
    expect(markup).toContain('font-weight="500"');
    expect(markup).toContain('font-weight="400"');
    expect(markup).toContain('text-anchor="start"');
    expect(markup).toContain('viewBox="0 0 640 360"');
  });

  it("renders bounded numeric value-axis steps with matching grid labels", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: 3 }],
          valueAxisTickInterval: 0.2,
        }}
      />,
    );
    const numericLabels = Array.from(
      markup.matchAll(/<text[^>]*>([^<]+)<\/text>/g),
      (match) => match[1],
    ).filter((label) => /^\d+\.\d$/.test(label ?? ""));

    expect(numericLabels).toEqual(
      Array.from({ length: 16 }, (_, index) => (index * 0.2).toFixed(1)),
    );
    expect(markup).not.toContain('stroke-dasharray="3 3"');
  });

  it("keeps horizontal-bar spacing by default and accepts an 8% slot gap", () => {
    const renderBar = (horizontalCategoryGapRatio?: number) =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type: "bar",
            layout: "horizontal",
            xKey: "day",
            series: [{ key: "value", label: "Value" }],
            data: [{ day: "Monday", value: 3 }],
            horizontalCategoryGapRatio,
          }}
        />,
      );
    const firstBarHeight = (markup: string) =>
      Number(markup.match(/<rect[^>]*height="([^"]+)"/)?.[1]);

    expect(firstBarHeight(renderBar(0.08))).toBeGreaterThan(
      firstBarHeight(renderBar()),
    );
    expect(renderBar()).toContain('stroke-dasharray="3 3"');
    expect(() => renderBar(0.91)).toThrow(
      "Horizontal category gap ratio must be between 0 and 0.9",
    );
  });

  it("aligns custom value-axis ticks to the interval within the chart range", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: 0.8 }],
          valueAxisTickInterval: 0.3,
        }}
      />,
    );
    const numericLabels = Array.from(
      markup.matchAll(/<text[^>]*>([^<]+)<\/text>/g),
      (match) => match[1],
    ).filter((label) => /^\d+\.\d$/.test(label ?? ""));

    expect(numericLabels).toEqual(["0.0", "0.3", "0.6"]);
  });

  it("limits custom tick-label density without dropping grid lines", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "First", value: 0 },
            { day: "Last", value: 99 },
          ],
          valueAxisTickInterval: 1,
        }}
      />,
    );
    const numericLabels = Array.from(
      markup.matchAll(/<text[^>]*>([^<]+)<\/text>/g),
      (match) => match[1],
    ).filter((label) => /^\d+$/.test(label ?? ""));

    expect(numericLabels.length).toBeLessThanOrEqual(30);
    expect(numericLabels[0]).toBe("0");
    expect(numericLabels.at(-1)).toBe("99");
    const tickLabelPositions = Array.from(
      markup.matchAll(
        /<text x="([\d.]+)"[^>]*text-anchor="middle">\d+<\/text>/g,
      ),
      (match) => Number(match[1]),
    );
    expect(
      tickLabelPositions.at(-1)! - tickLabelPositions.at(-2)!,
    ).toBeGreaterThanOrEqual(22);
    expect(markup.match(/<line /g)).toHaveLength(101);

    const smallRangeMarkup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "First", value: 0 },
            { day: "Last", value: 3 },
          ],
          valueAxisTickInterval: 0.2,
        }}
      />,
    );
    const smallRangeLabels = Array.from(
      smallRangeMarkup.matchAll(/<text[^>]*>([^<]+)<\/text>/g),
      (match) => match[1],
    ).filter((label) => /^\d+\.\d$/.test(label ?? ""));

    expect(smallRangeLabels).toEqual(
      Array.from({ length: 16 }, (_, index) => (index * 0.2).toFixed(1)),
    );
  });

  it("keeps a single value label when the axis cannot fit two", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Only", value: 9.9e60 }],
          valueAxisTickInterval: 1e59,
        }}
      />,
    );
    const numericLabels = Array.from(
      markup.matchAll(/<text[^>]*text-anchor="middle">([^<]+)<\/text>/g),
      (match) => match[1],
    ).filter((label) => /^\d[\d,]*$/.test(label ?? ""));

    expect(numericLabels).toHaveLength(1);
  });

  it("keeps long horizontal value labels inside the chart canvas", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Low", value: -1.9e50 },
            { day: "High", value: 1.9e50 },
          ],
          valueAxisTickInterval: 1e50,
        }}
      />,
    );
    const valueTickLabels = Array.from(
      markup.matchAll(
        /<text x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
      ),
      (match) => ({ x: Number(match[1]), label: match[2] ?? "" }),
    );

    expect(valueTickLabels).toHaveLength(1);
    for (const tick of valueTickLabels) {
      const estimatedWidth = tick.label.length * 11 * 0.65;
      expect(tick.x - estimatedWidth / 2).toBeGreaterThanOrEqual(0);
      expect(tick.x + estimatedWidth / 2).toBeLessThanOrEqual(640);
    }
  });

  it("thins labels using actual tick positions across uneven ranges", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Low", value: -5.1e28 },
            { day: "High", value: 1.49e29 },
          ],
          valueAxisTickInterval: 5e28,
        }}
      />,
    );
    const valueTickLabels = Array.from(
      markup.matchAll(
        /<text x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
      ),
      (match) => ({ x: Number(match[1]), label: match[2] ?? "" }),
    );

    expect(valueTickLabels).toHaveLength(1);
  });

  it("compacts horizontal tick labels that would exceed the chart width", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "High", value: 1e300 }],
          valueAxisTickInterval: 1e299,
        }}
      />,
    );
    const valueTickLabels = Array.from(
      markup.matchAll(
        /<text x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
      ),
      (match) => ({ x: Number(match[1]), label: match[2] ?? "" }),
    );

    expect(valueTickLabels).toHaveLength(11);
    expect(valueTickLabels[1]?.label).toBe("1e+299");
    for (const tick of valueTickLabels) {
      const estimatedWidth = tick.label.length * 11 * 0.65;
      expect(tick.x - estimatedWidth / 2).toBeGreaterThanOrEqual(0);
      expect(tick.x + estimatedWidth / 2).toBeLessThanOrEqual(640);
    }
  });

  it("keeps extreme horizontal bar labels within the chart at large font sizes", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Low", value: -1.2345678901234567e300 },
            { day: "Middle", value: 6.172839450617284e299 },
            { day: "High", value: 1.2345678901234567e300 },
          ],
          showValueLabels: true,
          valueLabelFontSize: 24,
          valueAxisTickInterval: 1e299,
        }}
      />,
    );
    const valueLabels = Array.from(
      markup.matchAll(
        /<text x="([\d.-]+)" y="([\d.]+)"[^>]*font-size="24"[^>]*text-anchor="(start|end)">([^<]+)<\/text>/g,
      ),
      (match) => ({
        x: Number(match[1]),
        anchor: match[3],
        label: match[4] ?? "",
      }),
    );

    expect(valueLabels).toHaveLength(3);
    for (const label of valueLabels) {
      const estimatedWidth = label.label.length * 24 * 0.65;
      const leftEdge =
        label.anchor === "end" ? label.x - estimatedWidth : label.x;
      const rightEdge =
        label.anchor === "end" ? label.x : label.x + estimatedWidth;
      expect(leftEdge).toBeGreaterThanOrEqual(0);
      expect(rightEdge).toBeLessThanOrEqual(640);
    }

    const bars = Array.from(
      markup.matchAll(/<rect x="([\d.-]+)" y="[\d.-]+" width="([\d.-]+)"/g),
      (match) => ({ x: Number(match[1]), width: Number(match[2]) }),
    );
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(640);
    }
  });

  it("formats the minimum supported interval without collapsing ticks", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Monday", value: 0 },
            { day: "Tuesday", value: 3e-12 },
          ],
          valueAxisTickInterval: 1e-12,
        }}
      />,
    );
    const tickLabels = Array.from(
      markup.matchAll(/<text[^>]*text-anchor="end">([^<]+)<\/text>/g),
      (match) => match[1],
    );

    expect(tickLabels).toEqual([
      "0.000000000000",
      "0.000000000001",
      "0.000000000002",
      "0.000000000003",
    ]);
  });

  it("preserves precision for allowed intervals with fractional coefficients", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Monday", value: 0 },
            { day: "Tuesday", value: 3.6e-12 },
          ],
          valueAxisTickInterval: 1.2e-12,
        }}
      />,
    );
    const tickLabels = Array.from(
      markup.matchAll(/<text[^>]*text-anchor="end">([^<]+)<\/text>/g),
      (match) => match[1],
    );

    expect(tickLabels).toEqual([
      "0.0000000000000",
      "0.0000000000012",
      "0.0000000000024",
      "0.0000000000036",
    ]);
  });

  it("compacts wide vertical ticks while keeping them clear of the axis title", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          yAxisTitle: "Revenue",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Low", value: 0 },
            { day: "High", value: 1e300 },
          ],
          valueAxisTickInterval: 1e299,
        }}
      />,
    );
    const tickLabels = Array.from(
      markup.matchAll(
        /<text x="([\d.]+)" y="([\d.]+)"[^>]*text-anchor="end">([^<]+)<\/text>/g,
      ),
      (match) => ({
        x: Number(match[1]),
        y: Number(match[2]),
        label: match[3] ?? "",
      }),
    );
    const plotBounds = markup.match(
      /<line x1="([^"]+)" x2="([^"]+)" y1="[^"]+" y2="[^"]+"/,
    );

    expect(tickLabels).toHaveLength(11);
    expect(tickLabels[1]?.label).toBe("1e+299");
    expect(plotBounds).not.toBeNull();
    expect(
      Number(plotBounds?.[2]) - Number(plotBounds?.[1]),
    ).toBeGreaterThanOrEqual(32);
    const title = markup.match(
      /<text x="([\d.]+)" y="[\d.]+" transform="rotate\(-90 [\d.]+ [\d.]+\)"[^>]*font-size="([\d.]+)"[^>]*>Revenue<\/text>/,
    );
    expect(title).not.toBeNull();
    const titleRight = Number(title?.[1]) + Number(title?.[2]) / 2;
    for (const tick of tickLabels) {
      const estimatedWidth = tick.label.length * 11 * 0.65;
      expect(tick.x - estimatedWidth).toBeGreaterThanOrEqual(0);
      expect(tick.x - estimatedWidth).toBeGreaterThanOrEqual(titleRight + 8);
      expect(tick.x).toBeLessThanOrEqual(640);
      expect(tick.y).toBeGreaterThanOrEqual(0);
      expect(tick.y).toBeLessThanOrEqual(360);
    }
  });

  it("keeps a usable plot width with large ticks and a large axis title", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          yAxisTitle: "Revenue",
          labelFontSize: 24,
          axisTitleFontSize: 24,
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Low", value: -1e26 },
            { day: "High", value: 0 },
          ],
          valueAxisTickInterval: 1e25,
        }}
      />,
    );
    const plotBounds = markup.match(
      /<line x1="([^\"]+)" x2="([^\"]+)" y1="[^\"]+" y2="[^\"]+"/,
    );

    expect(plotBounds).not.toBeNull();
    expect(
      Number(plotBounds?.[2]) - Number(plotBounds?.[1]),
    ).toBeGreaterThanOrEqual(32);
  });

  it("thins dense value labels without dropping grid lines or crowding endpoints", () => {
    const horizontalMarkup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "First", value: 0 },
            { day: "Last", value: 3 },
          ],
          valueAxisTickInterval: 0.04,
        }}
      />,
    );
    const horizontalLabels = Array.from(
      horizontalMarkup.matchAll(
        /<text x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
      ),
      (match) => ({ x: Number(match[1]), label: match[2] ?? "" }),
    );
    const horizontalBoxes = horizontalLabels
      .map(({ x, label }) => ({
        left: x - (label.length * 11 * 0.65) / 2,
        right: x + (label.length * 11 * 0.65) / 2,
        label,
      }))
      .sort((first, second) => first.left - second.left);

    expect(horizontalLabels.length).toBeLessThan(76);
    expect(horizontalLabels.map(({ label }) => label)).toContain("0.00");
    expect(horizontalLabels.map(({ label }) => label)).toContain("3.00");
    expect(horizontalMarkup.match(/<line /g)).toHaveLength(77);
    expect(
      horizontalBoxes.every(
        (box, index) =>
          index === 0 || horizontalBoxes[index - 1]!.right + 8 <= box.left,
      ),
    ).toBe(true);

    const verticalMarkup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "First", value: 0 },
            { day: "Last", value: 3 },
          ],
          valueAxisTickInterval: 0.04,
        }}
      />,
    );
    const verticalLabels = Array.from(
      verticalMarkup.matchAll(
        /<text x="[\d.]+" y="([\d.]+)"[^>]*text-anchor="end">([^<]+)<\/text>/g,
      ),
      (match) => ({ y: Number(match[1]), label: match[2] ?? "" }),
    ).sort((first, second) => first.y - second.y);

    expect(verticalLabels.length).toBeLessThan(76);
    expect(verticalLabels.map(({ label }) => label)).toContain("0.00");
    expect(verticalLabels.map(({ label }) => label)).toContain("3.00");
    expect(verticalMarkup.match(/<line /g)).toHaveLength(77);
    expect(
      verticalLabels.every(
        (label, index) =>
          index === 0 || label.y - verticalLabels[index - 1]!.y >= 15,
      ),
    ).toBe(true);
  });

  it("reserves room for custom decimal value-axis labels", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: 0.0003 }],
          valueAxisTickInterval: 0.0001,
        }}
      />,
    );
    const tickLabels = Array.from(
      markup.matchAll(/<text x="([\d.]+)"[^>]*>(0\.000[123])<\/text>/g),
      (match) => ({ x: Number(match[1]), label: match[2] }),
    );

    expect(tickLabels).toHaveLength(3);
    expect(tickLabels.every(({ x }) => x >= 50)).toBe(true);
  });

  it("keeps grouped horizontal bars within slots at the maximum category gap", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [
            { key: "first", label: "First" },
            { key: "second", label: "Second" },
          ],
          data: Array.from({ length: 10 }, (_, index) => ({
            day: `Day ${index}`,
            first: 1,
            second: 2,
          })),
          horizontalCategoryGapRatio: 0.9,
        }}
      />,
    );
    const bars = Array.from(
      markup.matchAll(
        /<rect x="[^"]+" y="([\d.]+)" width="[^"]+" height="([\d.]+)"/g,
      ),
      (match) => ({ y: Number(match[1]), height: Number(match[2]) }),
    );

    expect(bars).toHaveLength(20);
    expect(
      bars.every(
        (bar, index) =>
          index === 0 || bars[index - 1].y + bars[index - 1].height <= bar.y,
      ),
    ).toBe(true);
  });

  it("keeps four automatic value-axis ticks when no step is set", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: 3 }],
        }}
      />,
    );
    const numericLabels = Array.from(
      markup.matchAll(/<text[^>]*>([^<]+)<\/text>/g),
      (match) => match[1],
    ).filter((label) => /^\d+(?:\.\d)?$/.test(label ?? ""));

    expect(numericLabels).toEqual(["0", "1", "2", "3"]);
  });

  it("rejects intervals that would create an excessive number of ticks", () => {
    expect(() =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type: "bar",
            layout: "horizontal",
            xKey: "day",
            series: [{ key: "value", label: "Value" }],
            data: [{ day: "Monday", value: 3 }],
            valueAxisTickInterval: 0.001,
          }}
        />,
      ),
    ).toThrow("Chart value-axis interval exceeds the tick limit");
  });

  it("rejects non-finite value-axis intervals", () => {
    expect(() =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type: "bar",
            layout: "horizontal",
            xKey: "day",
            series: [{ key: "value", label: "Value" }],
            data: [{ day: "Monday", value: 3 }],
            valueAxisTickInterval: Number.POSITIVE_INFINITY,
          }}
        />,
      ),
    ).toThrow("Chart value-axis interval must be finite and positive");
  });

  it("reserves space for long horizontal category and value labels", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          ...chart,
          layout: "horizontal",
          showValueLabels: true,
          labelFontSize: 10,
          valueLabelFontSize: 11,
          data: [
            {
              day: "A very long category label",
              first: 123456,
              second: 2,
              third: 3,
              fourth: 4,
            },
          ],
        }}
      />,
    );
    const categoryLabel = markup.match(
      /<text x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="10" text-anchor="end">A very long c\.\.\.<\/text>/,
    );
    const largestValueLabel = markup.match(
      /<text x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="11" font-weight="400" text-anchor="start">123,456<\/text>/,
    );

    expect(categoryLabel).not.toBeNull();
    expect(Number(categoryLabel?.[1])).toBeGreaterThan(100);
    expect(largestValueLabel).not.toBeNull();
    expect(Number(largestValueLabel?.[1])).toBeLessThan(590);
  });

  it("places negative horizontal value labels outside the bar's left edge", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: -123456 }],
          showValueLabels: true,
        }}
      />,
    );
    const negativeBarX = markup.match(/<rect x="([\d.]+)"/);
    const negativeBarLabel = markup.match(
      /<text x="([\d.]+)"[^>]*text-anchor="end">-123,456<\/text>/,
    );
    const categoryLabel = markup.match(
      /<text x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="11" text-anchor="end">Monday<\/text>/,
    );

    expect(negativeBarX).not.toBeNull();
    expect(negativeBarLabel).not.toBeNull();
    expect(Number(negativeBarLabel?.[1])).toBeLessThan(
      Number(negativeBarX?.[1]),
    );
    expect(categoryLabel).not.toBeNull();
    expect(
      Number(negativeBarLabel?.[1]) - Number(categoryLabel?.[1]),
    ).toBeGreaterThan(60);
  });

  it.each(["line", "area"] as const)(
    "renders requested value labels for %s charts",
    (type) => {
      const markup = renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type,
            xKey: "day",
            series: [{ key: "value", label: "Value" }],
            data: [
              { day: "Monday", value: 4 },
              { day: "Tuesday", value: 11 },
              { day: "Wednesday", value: 7 },
            ],
            showValueLabels: true,
          }}
        />,
      );

      expect(markup).toContain(">7</text>");
      expect(markup).toContain('font-weight="400"');
    },
  );

  it.each(["line", "area"] as const)(
    "keeps the final %s value label inside the chart bounds",
    (type) => {
      const markup = renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type,
            xKey: "day",
            series: [{ key: "value", label: "Value" }],
            data: [
              { day: "Monday", value: 4 },
              { day: "Tuesday", value: 11 },
              { day: "Wednesday", value: 123456789 },
            ],
            showValueLabels: true,
          }}
        />,
      );
      const finalValueLabel = markup.match(
        /<text x="([\d.]+)" y="[\d.]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="11" font-weight="400" text-anchor="end">123,456,789<\/text>/,
      );

      expect(finalValueLabel).not.toBeNull();
      expect(Number(finalValueLabel?.[1])).toBeLessThan(640);
    },
  );
});
