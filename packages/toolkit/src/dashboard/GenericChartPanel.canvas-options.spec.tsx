import { BarChart, LabelList } from "recharts";
import { describe, expect, it } from "vitest";

import { GenericChartRenderer } from "./GenericChartPanel.js";

type TestElement = {
  type: unknown;
  props: Record<string, unknown>;
};

function asElement(value: unknown): TestElement | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("props" in value)
  ) {
    return null;
  }
  return value as TestElement;
}

function descendants(value: unknown): TestElement[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  const element = asElement(value);
  return element ? [element, ...descendants(element.props.children)] : [];
}

function axes(elements: TestElement[]) {
  return elements.find((element) => "yFormatter" in element.props);
}

const rows = [
  { category: "alpha", value: 1 },
  { category: "beta", value: 2 },
];

function renderBar(config: Record<string, unknown>) {
  const canvas = asElement(
    GenericChartRenderer({
      rows,
      config: {
        chartType: "stacked-bar",
        xKey: "category",
        yKeys: ["value"],
        ...config,
      },
    }),
  );
  return { canvas, elements: descendants(canvas?.props.children) };
}

describe("GenericChartRenderer canvas options", () => {
  it("sizes the canvas and plot from height and topPadding", () => {
    const { canvas, elements } = renderBar({ height: 512, topPadding: 8 });
    const chart = elements.find((element) => element.type === BarChart);

    expect(canvas?.props.height).toBe(512);
    expect(chart?.props.margin).toMatchObject({ top: 8 });
  });

  it("keeps the default canvas without the options", () => {
    const { canvas, elements } = renderBar({});
    const chart = elements.find((element) => element.type === BarChart);

    expect(canvas?.props.height).toBeUndefined();
    expect(chart?.props.margin).toBeUndefined();
    expect(axes(elements)?.props.verticalGrid).toBeUndefined();
    expect(elements.some((element) => element.type === LabelList)).toBe(false);
  });

  it("applies the tick count, vertical grid, and bar value labels", () => {
    const { elements } = renderBar({
      yAxisTickCount: 16,
      verticalGrid: true,
      showBarValues: true,
    });

    expect(axes(elements)?.props.yAxisTickCount).toBe(16);
    expect(axes(elements)?.props.verticalGrid).toBe(true);
    expect(
      elements.find((element) => element.type === LabelList)?.props.position,
    ).toBe("center");
  });
});
