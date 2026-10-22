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
  it("renders only the points used by bounded chart validation", () => {
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

  it("formats very small custom intervals without collapsing labels to zero", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Monday", value: 0 },
            { day: "Tuesday", value: 3e-10 },
          ],
          valueAxisTickInterval: 1e-10,
        }}
      />,
    );

    expect(markup).toContain(">0.0000000001</text>");
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

    expect(markup).toContain(">0.0000000000012</text>");
    expect(markup).toContain(">0.0000000000024</text>");
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

  it("keeps tightly packed horizontal bars within their category slots", () => {
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
