// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
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

function chartWithTooltip(tooltip: {
  enabled?: boolean;
  fields?: string[];
  includeAutomatic?: boolean;
}): DataChartWidgetData {
  return {
    type: "bar",
    layout: "horizontal",
    xKey: "category",
    xAxisTitle: "Value",
    yAxisTitle: "Category",
    series: [{ key: "value", label: "Value" }],
    data: [{ category: "beta", value: 2, region: "west" }],
    tooltip,
  } as DataChartWidgetData;
}

function areaPathPoints(path: SVGPathElement) {
  return Array.from(
    path.getAttribute("d")?.matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g) ?? [],
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );
}

async function hoverFirstBar(chart: DataChartWidgetData) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<DataChartRenderer chart={chart} />);
    });

    const mark = container.querySelector<SVGRectElement>("svg rect");
    if (!mark) throw new Error("Expected a rendered bar mark");

    await act(async () => {
      mark.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
    });

    return {
      ariaLabel: mark.getAttribute("aria-label"),
      tooltipText: container.querySelector('[role="tooltip"]')?.textContent,
    };
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
}

describe("DataChartRenderer theme colors", () => {
  it("makes bar marks focusable with category and value labels", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "category",
          xAxisTitle: "Value",
          yAxisTitle: "Category",
          series: [{ key: "value", label: "Value" }],
          data: [{ category: "beta", value: 2 }],
        }}
      />,
    );

    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Category: beta, Value: 2"');
  });

  it("plots numeric scatter pairs and colors the points by category", () => {
    const data = [
      { category: "alpha", series_one: 1, series_two: 2 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ];
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "scatter",
          xKey: "series_one",
          xAxisTitle: "series_one",
          yAxisTitle: "Sum of series_two",
          colorByKey: "category",
          series: [{ key: "series_two", label: "Sum of series_two" }],
          data,
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const chart = container.querySelector<SVGSVGElement>(
      'svg[role="img"][aria-label="agentChat.widget.dataChart"]',
    );
    const points = Array.from(
      chart?.querySelectorAll<SVGCircleElement>(
        "[data-scatter-point='true']",
      ) ?? [],
    );

    expect(points).toHaveLength(3);
    expect(points.map((point) => point.getAttribute("aria-label"))).toEqual([
      "series_one: 1, Sum of series_two: 2, category: alpha",
      "series_one: 2, Sum of series_two: 1, category: beta",
      "series_one: 3, Sum of series_two: 2, category: gamma",
    ]);
    expect(points.map((point) => point.getAttribute("data-scatter-x"))).toEqual(
      ["1", "2", "3"],
    );
    expect(points.map((point) => point.getAttribute("data-scatter-y"))).toEqual(
      ["2", "1", "2"],
    );
    expect(
      new Set(points.map((point) => point.getAttribute("fill"))).size,
    ).toBe(3);
    expect(Number(points[0]?.getAttribute("cx"))).toBeLessThan(
      Number(points[1]?.getAttribute("cx")),
    );
    expect(Number(points[1]?.getAttribute("cx"))).toBeLessThan(
      Number(points[2]?.getAttribute("cx")),
    );
    expect(points[0]?.getAttribute("cy")).toBe(points[2]?.getAttribute("cy"));
    expect(Number(points[1]?.getAttribute("cy"))).toBeGreaterThan(
      Number(points[0]?.getAttribute("cy")),
    );
    expect(
      Array.from(
        chart?.querySelectorAll<SVGTextElement>(
          "[data-scatter-x-tick='true']",
        ) ?? [],
        (tick) => tick.textContent,
      ),
    ).toEqual(["-0.5", "0", "0.5", "1", "1.5", "2", "2.5", "3", "3.5"]);
    expect(
      Array.from(container.querySelectorAll("ul > li"), (item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["alpha", "beta", "gamma"]);
    expect(data).toEqual([
      { category: "alpha", series_one: 1, series_two: 2 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ]);
  });

  it("plots one histogram count for each unique numeric value", () => {
    const data = [
      { value: 1, count: 1 },
      { value: 2, count: 1 },
      { value: 3, count: 1 },
    ];
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "histogram",
          xKey: "value",
          xAxisTitle: "value",
          yAxisTitle: "Count of Records",
          series: [{ key: "count", label: "Count of Records" }],
          data,
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const marks = Array.from(
      container.querySelectorAll<SVGRectElement>(
        "rect[data-histogram-mark='true']",
      ),
    );

    expect(marks).toHaveLength(3);
    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "value: 1, Count of Records: 1",
      "value: 2, Count of Records: 1",
      "value: 3, Count of Records: 1",
    ]);
    expect(marks.map((mark) => Number(mark.getAttribute("x")))).toStrictEqual(
      [...marks]
        .map((mark) => Number(mark.getAttribute("x")))
        .sort((a, b) => a - b),
    );
    expect(data).toEqual([
      { value: 1, count: 1 },
      { value: 2, count: 1 },
      { value: 3, count: 1 },
    ]);
  });

  it("renders ordered horizontal stack segments, category totals, and legend", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          stacking: "stacked",
          title: "Synthetic regional mix",
          xKey: "region",
          xAxisTitle: "Value",
          yAxisTitle: "Region",
          series: [
            { key: "core", label: "Core" },
            { key: "support", label: "Support" },
          ],
          data: [
            { region: "North", core: 4, support: 3 },
            { region: "South", core: 2, support: 5 },
          ],
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;

    const chart = container.querySelector<SVGSVGElement>(
      'svg[role="img"][aria-label="Synthetic regional mix"]',
    );
    const marks = Array.from(
      container.querySelectorAll<SVGRectElement>('rect[role="img"]'),
    );
    expect(chart).not.toBeNull();
    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "Region: North, Core: 4, Value: 7",
      "Region: North, Support: 3, Value: 7",
      "Region: South, Core: 2, Value: 7",
      "Region: South, Support: 5, Value: 7",
    ]);
    expect(
      Array.from(container.querySelectorAll("ul > li"), (item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Core", "Support"]);

    for (const [first, second] of [
      [marks[0], marks[1]],
      [marks[2], marks[3]],
    ] as const) {
      expect(first?.getAttribute("y")).toBe(second?.getAttribute("y"));
      expect(
        Number(first?.getAttribute("x")) + Number(first?.getAttribute("width")),
      ).toBeCloseTo(Number(second?.getAttribute("x")), 6);
    }
    expect(marks[0]?.getAttribute("y")).not.toBe(marks[2]?.getAttribute("y"));
  });

  it("normalizes percent-stacked horizontal bars without changing rows", () => {
    const data = [
      { category: "alpha", series_one: 1, series_two: 3 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ];
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          stacking: "percent",
          title: "Synthetic category shares",
          xKey: "category",
          xAxisTitle: "Share",
          yAxisTitle: "Category",
          series: [
            { key: "series_one", label: "First" },
            { key: "series_two", label: "Second" },
          ],
          data,
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const chartElement = container.querySelector<SVGSVGElement>(
      'svg[role="img"][aria-label="Synthetic category shares"]',
    );
    const marks = Array.from(
      chartElement?.querySelectorAll<SVGRectElement>('rect[role="img"]') ?? [],
    );
    const tickLabels = Array.from(
      chartElement?.querySelectorAll<SVGTextElement>("text") ?? [],
      (tick) => tick.textContent,
    );

    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "Category: alpha, First: 1 (25%), Share: 100%",
      "Category: alpha, Second: 3 (75%), Share: 100%",
      "Category: beta, First: 2 (66.7%), Share: 100%",
      "Category: beta, Second: 1 (33.3%), Share: 100%",
      "Category: gamma, First: 3 (60%), Share: 100%",
      "Category: gamma, Second: 2 (40%), Share: 100%",
    ]);
    expect(tickLabels).toContain("100%");

    for (let row = 0; row < 3; row += 1) {
      const first = marks[row * 2]!;
      const second = marks[row * 2 + 1]!;
      const firstWidth = Number(first.getAttribute("width"));
      const secondWidth = Number(second.getAttribute("width"));
      expect(first.getAttribute("y")).toBe(second.getAttribute("y"));
      expect(Number(first.getAttribute("x")) + firstWidth).toBeCloseTo(
        Number(second.getAttribute("x")),
        6,
      );
      expect(firstWidth / (firstWidth + secondWidth)).toBeCloseTo(
        [0.25, 2 / 3, 0.6][row]!,
        3,
      );
    }
    expect(data).toEqual([
      { category: "alpha", series_one: 1, series_two: 3 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ]);
  });

  it("renders stacked columns with ordered segments and category totals", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "vertical",
          stacking: "stacked",
          title: "Synthetic regional mix",
          xKey: "region",
          xAxisTitle: "Region",
          yAxisTitle: "Value",
          series: [
            { key: "core", label: "Core" },
            { key: "support", label: "Support" },
          ],
          data: [
            { region: "North", core: 4, support: 3 },
            { region: "South", core: 2, support: 5 },
          ],
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const marks = Array.from(
      container.querySelectorAll<SVGRectElement>('rect[role="img"]'),
    );

    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "Region: North, Core: 4, Value: 7",
      "Region: North, Support: 3, Value: 7",
      "Region: South, Core: 2, Value: 7",
      "Region: South, Support: 5, Value: 7",
    ]);
    expect(
      Array.from(container.querySelectorAll("ul > li"), (item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Core", "Support"]);

    for (const [lower, upper] of [
      [marks[0], marks[1]],
      [marks[2], marks[3]],
    ] as const) {
      expect(lower?.getAttribute("x")).toBe(upper?.getAttribute("x"));
      expect(lower?.getAttribute("width")).toBe(upper?.getAttribute("width"));
      expect(
        Number(upper?.getAttribute("y")) +
          Number(upper?.getAttribute("height")),
      ).toBeCloseTo(Number(lower?.getAttribute("y")), 6);
    }
    expect(marks[0]?.getAttribute("x")).not.toBe(marks[2]?.getAttribute("x"));
  });

  it("normalizes percent-stacked columns per category without changing rows", () => {
    const data = [
      { category: "alpha", series_one: 1, series_two: 3 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ];
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "vertical",
          stacking: "percent",
          title: "Synthetic category shares",
          xKey: "category",
          xAxisTitle: "Category",
          yAxisTitle: "Share",
          series: [
            { key: "series_one", label: "First" },
            { key: "series_two", label: "Second" },
          ],
          data,
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const chart = container.querySelector<SVGSVGElement>(
      'svg[role="img"][aria-label="Synthetic category shares"]',
    );
    const marks = Array.from(
      chart?.querySelectorAll<SVGRectElement>('rect[role="img"]') ?? [],
    );

    expect(marks.map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "Category: alpha, First: 1 (25%), Share: 100%",
      "Category: alpha, Second: 3 (75%), Share: 100%",
      "Category: beta, First: 2 (66.7%), Share: 100%",
      "Category: beta, Second: 1 (33.3%), Share: 100%",
      "Category: gamma, First: 3 (60%), Share: 100%",
      "Category: gamma, Second: 2 (40%), Share: 100%",
    ]);
    expect(
      Array.from(
        chart?.querySelectorAll<SVGTextElement>(
          '[data-value-axis-tick="true"]',
        ) ?? [],
        (tick) => tick.textContent,
      ),
    ).toContain("100%");

    for (let row = 0; row < 3; row += 1) {
      const lower = marks[row * 2]!;
      const upper = marks[row * 2 + 1]!;
      const lowerHeight = Number(lower.getAttribute("height"));
      const upperHeight = Number(upper.getAttribute("height"));
      expect(lower.getAttribute("x")).toBe(upper.getAttribute("x"));
      expect(Number(upper.getAttribute("y")) + upperHeight).toBeCloseTo(
        Number(lower.getAttribute("y")),
        6,
      );
      expect(lowerHeight / (lowerHeight + upperHeight)).toBeCloseTo(
        [0.25, 2 / 3, 0.6][row]!,
        3,
      );
    }
    expect(data).toEqual([
      { category: "alpha", series_one: 1, series_two: 3 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ]);
  });

  it("stacks area bands against the preceding cumulative boundary", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "area",
          layout: "vertical",
          stacking: "stacked",
          title: "Synthetic stacked area",
          xKey: "category",
          series: [
            { key: "series_one", label: "First" },
            { key: "series_two", label: "Second" },
          ],
          data: [
            { category: "alpha", series_one: 1, series_two: 3 },
            { category: "beta", series_one: 2, series_two: 1 },
            { category: "gamma", series_one: 3, series_two: 2 },
          ],
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const paths = Array.from(
      container.querySelectorAll<SVGPathElement>('path[stroke="none"]'),
    );

    expect(paths).toHaveLength(2);
    const firstUpper = areaPathPoints(paths[0]!).slice(0, 3);
    const secondPoints = areaPathPoints(paths[1]!);
    const secondLower = secondPoints.slice(3, 6);
    expect(secondLower).toHaveLength(3);
    for (let index = 0; index < 3; index += 1) {
      expect(secondLower[index]?.x).toBeCloseTo(firstUpper[2 - index]!.x, 6);
      expect(secondLower[index]?.y).toBeCloseTo(firstUpper[2 - index]!.y, 6);
    }
    const cumulativeTop = secondPoints.slice(0, 3);
    expect(cumulativeTop[1]!.y).toBeGreaterThan(cumulativeTop[0]!.y);
    expect(cumulativeTop[2]!.y).toBeLessThan(cumulativeTop[0]!.y);
    expect(
      Array.from(container.querySelectorAll("ul > li"), (item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["First", "Second"]);
  });

  it("normalizes stacked area values to 100% at every category", () => {
    const data = [
      { category: "alpha", series_one: 1, series_two: 3 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ];
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "area",
          layout: "vertical",
          stacking: "percent",
          title: "Synthetic percent area",
          xKey: "category",
          showValueLabels: true,
          series: [
            { key: "series_one", label: "First" },
            { key: "series_two", label: "Second" },
          ],
          data,
        }}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    const chartElement = container.querySelector<SVGSVGElement>(
      'svg[role="img"][aria-label="Synthetic percent area"]',
    );
    const paths = Array.from(
      chartElement?.querySelectorAll<SVGPathElement>('path[stroke="none"]') ??
        [],
    );
    const tickLabels = Array.from(
      chartElement?.querySelectorAll<SVGTextElement>(
        '[data-value-axis-tick="true"]',
      ) ?? [],
      (tick) => tick.textContent,
    );
    const valueLabels = Array.from(
      chartElement?.querySelectorAll<SVGTextElement>(
        '[data-value-label="true"]',
      ) ?? [],
      (label) => label.textContent,
    );

    expect(paths).toHaveLength(2);
    expect(tickLabels).toContain("100%");
    expect(valueLabels).toEqual(["25%", "66.7%", "60%", "75%", "33.3%", "40%"]);
    const topBoundary = areaPathPoints(paths[1]!).slice(0, 3);
    expect(topBoundary.map((point) => point.y)).toEqual([
      topBoundary[0]!.y,
      topBoundary[0]!.y,
      topBoundary[0]!.y,
    ]);
    const firstUpper = areaPathPoints(paths[0]!).slice(0, 3);
    const secondLower = areaPathPoints(paths[1]!).slice(3, 6);
    for (let index = 0; index < 3; index += 1) {
      expect(secondLower[index]?.y).toBeCloseTo(firstUpper[2 - index]!.y, 6);
    }
    expect(data).toEqual([
      { category: "alpha", series_one: 1, series_two: 3 },
      { category: "beta", series_one: 2, series_two: 1 },
      { category: "gamma", series_one: 3, series_two: 2 },
    ]);
  });

  it("labels null categories visibly and accessibly without hiding the bar", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "category",
          xAxisTitle: "Value",
          yAxisTitle: "Category",
          series: [{ key: "value", label: "Value" }],
          data: [{ category: null, value: 5 }],
        }}
      />,
    );

    expect(markup).toContain(">NULL</text>");
    expect(markup).toContain('aria-label="Category: NULL, Value: 5"');
    expect(Array.from(markup.matchAll(/<rect /g))).toHaveLength(1);
  });

  it("supports square horizontal bars while preserving the default radius", () => {
    const chart: DataChartWidgetData = {
      type: "bar",
      layout: "horizontal",
      xKey: "category",
      series: [{ key: "value", label: "Value" }],
      data: [{ category: "alpha", value: 1 }],
    };
    const defaultMarkup = renderToStaticMarkup(
      <DataChartRenderer chart={chart} />,
    );
    const squareMarkup = renderToStaticMarkup(
      <DataChartRenderer chart={chart} layout={{ horizontalBarRadius: 0 }} />,
    );

    expect(defaultMarkup).toContain('rx="3"');
    expect(squareMarkup).toContain('rx="0"');
    expect(() =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={chart}
          layout={{ horizontalBarRadius: -1 }}
        />,
      ),
    ).toThrow(
      "dataChartLayout.horizontalBarRadius must be a non-negative CSS length",
    );
  });

  it("shows the hovered category and value and emphasizes only that bar", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <DataChartRenderer
            chart={{
              type: "bar",
              layout: "horizontal",
              xKey: "category",
              xAxisTitle: "Value",
              yAxisTitle: "Category",
              series: [{ key: "value", label: "Value" }],
              data: [
                { category: "gamma", value: 3 },
                { category: "beta", value: 2 },
                { category: "alpha", value: 1 },
              ],
            }}
          />,
        );
      });

      const marks = Array.from(
        container.querySelectorAll<SVGRectElement>("svg rect"),
      );
      const before = marks.map((mark) => mark.getAttribute("stroke"));
      await act(async () => {
        marks[1]!.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      });

      expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
        "Category: betaValue: 2",
      );
      expect(marks[1]?.getAttribute("stroke")).toBeNull();
      expect(marks[1]?.getAttribute("opacity")).toBeNull();
      expect(marks[0]?.getAttribute("opacity")).toBe("0.3");
      expect(marks[0]?.getAttribute("stroke")).toBe(before[0]);
      expect(marks[2]?.getAttribute("opacity")).toBe("0.3");
      expect(marks[2]?.getAttribute("stroke")).toBe(before[2]);

      await act(async () => {
        marks[1]!.dispatchEvent(
          new PointerEvent("pointerout", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      });
      await act(async () => {
        marks[1]!.focus();
      });

      expect(marks[1]?.getAttribute("stroke")).toBe("hsl(var(--foreground))");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("positions a hovered tooltip left of the pointer in chart coordinates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<DataChartRenderer chart={chartWithTooltip({})} />);
      });

      const chartRoot = container.querySelector("svg")?.parentElement;
      if (!chartRoot) throw new Error("Expected a chart wrapper");
      vi.spyOn(chartRoot, "getBoundingClientRect").mockReturnValue(
        new DOMRect(100, 50, 640, 360),
      );
      const mark = container.querySelector<SVGRectElement>("svg rect");
      if (!mark) throw new Error("Expected a rendered bar mark");

      await act(async () => {
        mark.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
            clientX: 500,
            clientY: 200,
          }),
        );
      });

      const tooltip = container.querySelector<HTMLElement>('[role="tooltip"]');
      expect(tooltip?.style.left).toBe("392px");
      expect(tooltip?.style.top).toBe("142px");
      expect(tooltip?.style.transform).toBe("translateX(-100%)");
      expect(tooltip?.className).toContain("py-1.5");
      expect(tooltip?.className).toContain("leading-5");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("shows automatic category and value tooltip lines by default", async () => {
    const result = await hoverFirstBar(chartWithTooltip({}));

    expect(result.tooltipText).toBe("Category: betaValue: 2");
    expect(result.ariaLabel).toBe("Category: beta, Value: 2");
  });

  it("adds a selected scalar row field to the automatic tooltip lines", async () => {
    const result = await hoverFirstBar(
      chartWithTooltip({ fields: ["region"] }),
    );

    expect(result.tooltipText).toBe("Category: betaValue: 2region: west");
    expect(result.ariaLabel).toBe("Category: beta, Value: 2, region: west");
  });

  it("can show selected tooltip fields without automatic category and value", async () => {
    const result = await hoverFirstBar(
      chartWithTooltip({ fields: ["region"], includeAutomatic: false }),
    );

    expect(result.tooltipText).toBe("region: west");
    expect(result.ariaLabel).toBe("region: west");
  });

  it("hides the tooltip when disabled while retaining the mark label", async () => {
    const result = await hoverFirstBar(chartWithTooltip({ enabled: false }));

    expect(result.tooltipText).toBeUndefined();
    expect(result.ariaLabel).toBe("Category: beta, Value: 2");
  });

  it("renders a number chart as one labeled value without axes", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "number",
          title: "Quarterly revenue",
          xKey: "period",
          series: [{ key: "revenue", label: "Revenue" }],
          data: [{ period: "Current quarter", revenue: 1234.5 }],
        }}
      />,
    );

    expect(markup).toContain('aria-label="Quarterly revenue: 1,234.5"');
    expect(markup).toContain(">1,234.5</text>");
    expect(markup).toContain(">Quarterly revenue</text>");
    expect(markup).not.toContain("<line ");
    expect(markup).not.toContain("<rect ");
  });

  it.each([
    ["pie", false],
    ["donut", true],
  ] as const)(
    "renders %s slices and an accessible category legend",
    (type, isDonut) => {
      const markup = renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type,
            title: "Revenue by category",
            xKey: "category",
            series: [{ key: "value", label: "Revenue" }],
            data: [
              { category: "alpha", value: 1 },
              { category: "beta", value: 2 },
              { category: "gamma", value: 3 },
            ],
          }}
        />,
      );

      expect(markup).toContain('aria-label="Revenue by category"');
      expect(markup.match(/data-pie-slice="true"/g)).toHaveLength(3);
      expect(markup).toContain('data-pie-value="1"');
      expect(markup).toContain('data-pie-value="2"');
      expect(markup).toContain('data-pie-value="3"');
      expect(markup.indexOf('data-pie-category="alpha"')).toBeLessThan(
        markup.indexOf('data-pie-category="beta"'),
      );
      expect(markup.indexOf('data-pie-category="beta"')).toBeLessThan(
        markup.indexOf('data-pie-category="gamma"'),
      );
      expect(markup).toContain(">alpha</span>");
      expect(markup).toContain(">beta</span>");
      expect(markup).toContain(">gamma</span>");
      expect(markup.includes('data-pie-hole="true"')).toBe(isDonut);
      expect(markup).not.toContain("<line ");
      expect(markup).not.toContain("<rect ");
    },
  );

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

  it("preserves one-decimal ticks without an app layout override", () => {
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
      />,
    );

    expect(markup).toContain(">0.0</text>");
    expect(markup).toContain(">1.0</text>");
  });

  it("keeps positive value labels outside horizontal bars with a right inset", () => {
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
      /<text[^>]*x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--chart-1, var\(--primary\)\)\)" font-size="11" font-weight="400" text-anchor="start">3<\/text>/,
    );
    expect(maximumBarValueLabel).not.toBeNull();
    expect(Number(maximumBarValueLabel?.[1])).toBeGreaterThan(plotRightEdge);
    expect(Number(maximumBarValueLabel?.[1]) + 8).toBeLessThanOrEqual(640);
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
      /<text[^>]*x="([\d.]+)" y="348"[^>]*text-anchor="end">Last category\.\.\.<\/text>/,
    );

    expect(finalCategory).not.toBeNull();
    expect(Number(finalCategory?.[1])).toBeLessThanOrEqual(632);
  });

  it("keeps a long first category label inside the SVG", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "First category label", value: 0 },
            { day: "Last", value: 1 },
          ],
        }}
      />,
    );

    expect(markup).toMatch(
      /<text[^>]*x="46" y="348"[^>]*text-anchor="start">First categor\.\.\.<\/text>/,
    );
  });

  it("keeps top vertical-bar value labels above the bar at a zero inset", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [{ day: "Monday", value: 1 }],
          showValueLabels: true,
        }}
        layout={{ plotInsets: { top: 0 } }}
      />,
    );
    const valueLabel = markup.match(
      /<text(?=[^>]*data-value-label="true")(?=[^>]*>1<\/text>)[^>]*y="([\d.]+)"[^>]*>/,
    );
    const bar = markup.match(/<rect[^>]*y="([\d.]+)"/);

    expect(valueLabel).not.toBeNull();
    expect(Number(valueLabel?.[1])).toBeGreaterThanOrEqual(11);
    expect(bar).not.toBeNull();
    expect(Number(bar?.[1]) - Number(valueLabel?.[1])).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("keeps final vertical-bar value labels inside the SVG at a small right inset", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: Array.from({ length: 60 }, (_, index) => ({
            day: `Day ${index}`,
            value: index === 59 ? 1_234_567 : 0,
          })),
          showValueLabels: true,
        }}
        layout={{ plotInsets: { right: 8 } }}
      />,
    );
    const valueLabels = Array.from(
      markup.matchAll(
        /<text(?=[^>]*data-value-label="true")([^>]*)>([^<]+)<\/text>/g,
      ),
    );
    const finalValueLabel = valueLabels.at(-1);
    const finalLabelX = Number(
      finalValueLabel?.[1].match(/\bx="([\d.]+)"/)?.[1],
    );
    const finalLabelWidth =
      Array.from(finalValueLabel?.[2] ?? "").length * 11 * 0.65;

    expect(finalValueLabel).toBeDefined();
    expect(finalLabelX + finalLabelWidth / 2).toBeLessThanOrEqual(640);
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
      /<text(?=[^>]*data-value-axis-tick="true")[^>]*y="([\d.]+)"[^>]*>1<\/text>/,
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
      markup.matchAll(
        /<text[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g,
      ),
    )
      .filter((match) => match[3] === "3")
      .slice(-1)[0];

    expect(finalTick).toBeDefined();
    expect(Number(finalTick?.[1])).toBeLessThan(640);
    expect(Number(finalTick?.[1]) + 4).toBeLessThanOrEqual(640);
    expect(Number(finalTick?.[2])).toBeLessThan(340);
  });

  it("keeps vertical axis ticks and category labels clear at a zero bottom inset", () => {
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
        layout={{ labelFontSize: 12, plotInsets: { bottom: 0 } }}
      />,
    );
    const minimumTick = markup.match(
      /<text(?=[^>]*data-value-axis-tick="true")(?=[^>]*>0<\/text>)[^>]*y="([\d.]+)"/,
    );
    const categoryLabel = markup.match(
      /<text[^>]*y="([\d.]+)"[^>]*>Tuesday<\/text>/,
    );
    const plotBaseline = Math.max(
      ...Array.from(
        markup.matchAll(/<line[^>]*y1="([\d.]+)" y2="([\d.]+)"/g),
        (match) =>
          match[1] === match[2] ? Number(match[1]) : Number.NEGATIVE_INFINITY,
      ),
    );

    expect(minimumTick).not.toBeNull();
    expect(Number(minimumTick?.[1]) + 3).toBeLessThanOrEqual(360);
    expect(categoryLabel).not.toBeNull();
    expect(Number(categoryLabel?.[1]) - plotBaseline).toBeGreaterThanOrEqual(
      12,
    );
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

  it("uses the chat layout gap only when the saved chart omits its ratio", () => {
    const renderBar = (chartRatio?: number, layoutRatio?: number) =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type: "bar",
            layout: "horizontal",
            xKey: "day",
            series: [{ key: "value", label: "Value" }],
            data: [{ day: "Monday", value: 3 }],
            horizontalCategoryGapRatio: chartRatio,
          }}
          layout={{ horizontalCategoryGapRatio: layoutRatio }}
        />,
      );
    const barHeight = (markup: string) =>
      Number(markup.match(/<rect[^>]*height="([\d.]+)"/)?.[1]);

    expect(barHeight(renderBar(undefined, 0.1))).toBeGreaterThan(
      barHeight(renderBar()),
    );
    expect(barHeight(renderBar(0.5, 0.1))).toBeLessThan(
      barHeight(renderBar(undefined, 0.1)),
    );
    expect(() => renderBar(undefined, 0.91)).toThrow(
      "Horizontal category gap ratio must be between 0 and 0.9",
    );
  });

  it("draws opt-in horizontal category guides through bar-row centers", () => {
    const renderChart = (horizontalCategoryGridlines?: boolean) =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type: "bar",
            layout: "horizontal",
            xKey: "category",
            series: [{ key: "total", label: "Total" }],
            data: [
              { category: "alpha", total: 1 },
              { category: "beta", total: 2 },
              { category: "gamma", total: 3 },
            ],
          }}
          layout={{ horizontalCategoryGridlines }}
        />,
      );
    const horizontalLines = (markup: string) =>
      Array.from(
        markup.matchAll(
          /<line x1="([\d.]+)" x2="([\d.]+)" y1="([\d.]+)" y2="([\d.]+)"/g,
        ),
        (match) => ({
          x1: Number(match[1]),
          x2: Number(match[2]),
          y1: Number(match[3]),
          y2: Number(match[4]),
        }),
      ).filter((line) => line.x1 !== line.x2 && line.y1 === line.y2);

    expect(horizontalLines(renderChart())).toHaveLength(0);
    expect(horizontalLines(renderChart(true))).toHaveLength(3);
    expect(horizontalLines(renderChart(true)).map((line) => line.y1)).toEqual([
      66, 170, 274,
    ]);
  });

  it("places horizontal category labels five viewBox units before the plot", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "bar",
          layout: "horizontal",
          xKey: "category",
          yAxisTitle: "Category",
          series: [{ key: "value", label: "Value" }],
          data: [{ category: "alpha", value: 1 }],
        }}
      />,
    );
    const categoryLabel = Array.from(
      markup.matchAll(/<text\b([^>]*)>(.*?)<\/text>/g),
    ).find(([, , text]) => text === "alpha");
    const labelX = Number(categoryLabel?.[1].match(/\bx="([\d.]+)"/)?.[1]);
    const plotX = Number(markup.match(/<rect\b[^>]*\bx="([\d.]+)"/)?.[1]);

    expect(categoryLabel).toBeDefined();
    expect(plotX - labelX).toBe(5);
  });

  it("raises horizontal value-axis titles by two viewBox units", () => {
    const axisTitleY = (layout?: "horizontal") => {
      const markup = renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type: "bar",
            layout,
            xKey: "category",
            xAxisTitle: "Total",
            series: [{ key: "value", label: "Value" }],
            data: [{ category: "alpha", value: 1 }],
          }}
        />,
      );
      const title = Array.from(
        markup.matchAll(/<text\b([^>]*)>(.*?)<\/text>/g),
      ).find(([, , text]) => text === "Total");

      return Number(title?.[1].match(/\by="([\d.]+)"/)?.[1]);
    };

    expect(axisTitleY("horizontal")).toBe(354);
    expect(axisTitleY()).toBe(356);
  });

  it("applies scoped horizontal-bar plot adjustments and fill overrides", () => {
    const renderChart = (
      type: "bar" | "line",
      horizontalPlotAdjustments?: {
        left?: number;
        right?: number;
        top?: number;
        bottom?: number;
      },
    ) =>
      renderToStaticMarkup(
        <DataChartRenderer
          chart={{
            type,
            layout: type === "bar" ? "horizontal" : undefined,
            xKey: "category",
            yAxisTitle: "Category",
            series: [{ key: "total", label: "Total" }],
            data: [
              { category: "alpha", total: 1 },
              { category: "beta", total: 2 },
              { category: "gamma", total: 3 },
            ],
            horizontalCategoryGapRatio: 0.1,
          }}
          layout={{
            horizontalPlotAdjustments,
            horizontalBarColor: "hsl(var(--chart-2))",
          }}
        />,
      );
    const firstBar = (markup: string) => {
      const attributes = markup.match(/<rect\b([^>]*)\/>/)?.[1] ?? "";
      return Object.fromEntries(
        ["x", "y", "width", "height"].map((attribute) => [
          attribute,
          Number(
            attributes.match(new RegExp(`\\b${attribute}="([\\d.]+)"`))?.[1],
          ),
        ]),
      ) as Record<"x" | "y" | "width" | "height", number>;
    };
    const base = renderChart("bar");
    const adjusted = renderChart("bar", {
      left: -5,
      right: -3,
      top: 6,
      bottom: -6,
    });
    const baseBar = firstBar(base);
    const adjustedBar = firstBar(adjusted);

    expect(adjustedBar.x).toBe(baseBar.x - 5);
    expect(adjustedBar.width).toBe(baseBar.width + 8);
    expect(adjustedBar.y).toBe(baseBar.y + 6);
    expect(adjustedBar.height).toBe(baseBar.height);
    expect(adjusted).toContain('fill="hsl(var(--chart-2))"');
    expect(renderChart("line", { left: -5, top: 6 })).toContain(
      'stroke="hsl(var(--chart-1, var(--primary)))"',
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
        /<text[^>]*x="([\d.]+)"[^>]*text-anchor="middle">\d+<\/text>/g,
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
        /<text[^>]*x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
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
        /<text[^>]*x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
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
        /<text[^>]*x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
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
        /<text[^>]*x="([\d.-]+)" y="([\d.]+)"[^>]*font-size="24"[^>]*text-anchor="(start|end)">([^<]+)<\/text>/g,
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
      markup.matchAll(
        /<text(?=[^>]*data-value-axis-tick="true")[^>]*>([^<]+)<\/text>/g,
      ),
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
      markup.matchAll(
        /<text(?=[^>]*data-value-axis-tick="true")[^>]*>([^<]+)<\/text>/g,
      ),
      (match) => match[1],
    );

    expect(tickLabels).toEqual([
      "0.0000000000000",
      "0.0000000000012",
      "0.0000000000024",
      "0.0000000000036",
    ]);
  });

  it("keeps integer data labels compact while axis ticks retain interval precision", () => {
    const markup = renderToStaticMarkup(
      <DataChartRenderer
        chart={{
          type: "line",
          xKey: "day",
          series: [{ key: "value", label: "Value" }],
          data: [
            { day: "Monday", value: 0 },
            { day: "Tuesday", value: 7 },
          ],
          showValueLabels: true,
          valueAxisTickInterval: 0.5,
        }}
      />,
    );
    const axisLabels = Array.from(
      markup.matchAll(
        /<text(?=[^>]*data-value-axis-tick="true")[^>]*>([^<]+)<\/text>/g,
      ),
      (match) => match[1],
    );
    const valueLabels = Array.from(
      markup.matchAll(
        /<text(?=[^>]*data-value-label="true")[^>]*>([^<]+)<\/text>/g,
      ),
      (match) => match[1],
    );

    expect(axisLabels).toContain("7.0");
    expect(valueLabels).toContain("7");
    expect(valueLabels).not.toContain("7.0");
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
        /<text[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*text-anchor="end">([^<]+)<\/text>/g,
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
      /<text[^>]*x="([\d.]+)" y="[\d.]+" transform="rotate\(-90 [\d.]+ [\d.]+\)"[^>]*font-size="([\d.]+)"[^>]*>Revenue<\/text>/,
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
        /<text[^>]*x="([\d.]+)" y="340"[^>]*text-anchor="middle">([^<]+)<\/text>/g,
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
        /<text[^>]*x="[\d.]+" y="([\d.]+)"[^>]*text-anchor="end">([^<]+)<\/text>/g,
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

  it("keeps line value labels inside the canvas with no bottom inset", () => {
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
          showValueLabels: true,
        }}
        layout={{ plotInsets: { bottom: 0 } }}
      />,
    );
    const minimumValueLabelY = Array.from(
      markup.matchAll(
        /<text(?=[^>]*data-value-label="true")(?=[^>]*>0<\/text>)[^>]*y="([\d.]+)"[^>]*>/g,
      ),
      (match) => Number(match[1]),
    ).filter((y) => y < 360);

    expect(minimumValueLabelY.some((y) => y <= 356)).toBe(true);
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
      markup.matchAll(/<text[^>]*x="([\d.]+)"[^>]*>(0\.000[123])<\/text>/g),
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
      /<text[^>]*x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="10" text-anchor="end">A very long c\.\.\.<\/text>/,
    );
    const largestValueLabel = markup.match(
      /<text[^>]*x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--chart-1, var\(--primary\)\)\)" font-size="11" font-weight="400" text-anchor="start">123,456<\/text>/,
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
      /<text[^>]*x="([\d.]+)"[^>]*text-anchor="end">-123,456<\/text>/,
    );
    const categoryLabel = markup.match(
      /<text[^>]*x="([\d.]+)" y="[^"]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="11" text-anchor="end">Monday<\/text>/,
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
        /<text[^>]*x="([\d.]+)" y="[\d.]+" fill="hsl\(var\(--muted-foreground\)\)" font-size="11" font-weight="400" text-anchor="end">123,456,789<\/text>/,
      );

      expect(finalValueLabel).not.toBeNull();
      expect(Number(finalValueLabel?.[1])).toBeLessThan(640);
    },
  );
});
