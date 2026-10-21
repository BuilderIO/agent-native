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
});
