import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { DataChartRenderer } from "./DataChartRenderer.js";

function renderHorizontalBar(seriesColor?: string, layoutColor?: string) {
  const chart: DataChartWidgetData = {
    type: "bar",
    layout: "horizontal",
    xKey: "category",
    xAxisTitle: "Value",
    yAxisTitle: "Category",
    series: [
      {
        key: "value",
        label: "Value",
        ...(seriesColor ? { color: seriesColor } : {}),
      },
    ],
    data: [
      { category: "gamma", value: 3 },
      { category: "beta", value: 2 },
      { category: "alpha", value: 1 },
    ],
    showValueLabels: true,
  };

  return renderToStaticMarkup(
    <DataChartRenderer
      chart={chart}
      layout={layoutColor ? { horizontalBarColor: layoutColor } : undefined}
    />,
  );
}

function fillForText(
  markup: string,
  text: string,
  valueLabel = false,
): string | undefined {
  const node = Array.from(
    markup.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g),
    ([, attributes, content]) => ({
      attributes: attributes ?? "",
      content: content ?? "",
    }),
  ).find(
    ({ attributes, content }) =>
      content === text &&
      attributes.includes('data-value-label="true"') === valueLabel,
  );

  return node?.attributes.match(/\bfill="([^"]+)"/)?.[1];
}

describe("horizontal bar value-label colors", () => {
  it.each([
    {
      name: "explicit series color",
      seriesColor: "rgb(86, 119, 164)",
      layoutColor: "rgb(20, 30, 40)",
      expected: "rgb(86, 119, 164)",
    },
    {
      name: "horizontal-bar layout color",
      layoutColor: "rgb(20, 30, 40)",
      expected: "rgb(20, 30, 40)",
    },
    {
      name: "default series color",
      expected: "hsl(var(--chart-1, var(--primary)))",
    },
  ] satisfies Array<{
    name: string;
    seriesColor?: string;
    layoutColor?: string;
    expected: string;
  }>)("uses the resolved bar color for labels with $name", (colorCase) => {
    const markup = renderHorizontalBar(
      colorCase.seriesColor,
      colorCase.layoutColor,
    );

    expect(fillForText(markup, "2", true)).toBe(colorCase.expected);
    expect(markup.match(/<rect\b[^>]*\bfill="([^"]+)"/)?.[1]).toBe(
      colorCase.expected,
    );
  });

  it("keeps axis and category labels on their existing tones", () => {
    const markup = renderHorizontalBar("rgb(86, 119, 164)");

    expect(fillForText(markup, "beta")).toBe("hsl(var(--muted-foreground))");
    expect(fillForText(markup, "2")).toBe("hsl(var(--muted-foreground))");
    expect(fillForText(markup, "Value")).toBe("hsl(var(--foreground))");
    expect(fillForText(markup, "Category")).toBe("hsl(var(--foreground))");
  });
});
