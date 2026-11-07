import { Bar, BarChart, YAxis } from "recharts";
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

function childrenOf(element: TestElement): TestElement[] {
  function collect(value: unknown): TestElement[] {
    if (Array.isArray(value)) return value.flatMap(collect);
    const child = asElement(value);
    return child ? [child] : [];
  }

  return collect(element.props.children);
}

function renderComponent(element: TestElement): TestElement | null {
  const component = element.type as (props: Record<string, unknown>) => unknown;
  return asElement(component(element.props));
}

const rows = [
  { category: "alpha", value: 1 },
  { category: "beta", value: 2 },
  { category: "gamma", value: 3 },
];

describe("stacked column Y-axis scale", () => {
  it.each(["linear", "log", "pow", "sqrt"] as const)(
    "passes the %s scale to the numeric axis without changing chart rows",
    (yAxisScale) => {
      const canvas = asElement(
        GenericChartRenderer({
          rows,
          config: {
            chartType: "bar",
            stacked: true,
            xKey: "category",
            yKeys: ["value"],
            yAxisScale,
          },
        }),
      );
      const chart = canvas ? asElement(canvas.props.children) : null;
      const axes = chart
        ? childrenOf(chart).find((child) => "xKey" in child.props)
        : undefined;
      const renderedAxes = axes ? renderComponent(axes) : null;
      const yAxis = renderedAxes
        ? childrenOf(renderedAxes).find((child) => child.type === YAxis)
        : undefined;
      const bars = chart
        ? childrenOf(chart).filter((child) => child.type === Bar)
        : [];
      const scale = yAxis?.props.scale;

      expect(chart?.type).toBe(BarChart);
      expect(chart?.props.data).toBe(rows);
      expect(bars).toHaveLength(1);
      expect(bars[0]?.props.dataKey).toBe("value");
      expect(bars[0]?.props.stackId).toBe("stack");
      if (yAxisScale === "pow") {
        expect(typeof scale).toBe("function");
        const powerScale = scale as ((value: number) => number) & {
          domain: (domain: readonly number[]) => unknown;
          range: (range: readonly number[]) => unknown;
          ticks: (count: number | undefined) => readonly number[];
        };
        powerScale.domain([0, 3]);
        powerScale.range([0, 1]);
        expect(powerScale(1)).toBeCloseTo(1 / 9);
        expect(powerScale(2)).toBeCloseTo(4 / 9);
        expect(powerScale(3)).toBe(1);
        expect(powerScale.ticks(4)).toEqual([0, 1, 2, 3]);
      } else {
        expect(scale).toBe(yAxisScale);
      }
      if (yAxisScale === "log") {
        expect(yAxis?.props.domain).toEqual(["dataMin", "dataMax"]);
      }
    },
  );

  it("does not apply the vertical-value scale to horizontal bars", () => {
    const canvas = asElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "bar",
          layout: "vertical",
          stacked: true,
          xKey: "category",
          yKeys: ["value"],
          yAxisScale: "log",
        },
      }),
    );
    const chart = canvas ? asElement(canvas.props.children) : null;
    const axes = chart
      ? childrenOf(chart).find((child) => "xKey" in child.props)
      : undefined;
    const renderedAxes = axes ? renderComponent(axes) : null;
    const yAxis = renderedAxes
      ? childrenOf(renderedAxes).find((child) => child.type === YAxis)
      : undefined;

    expect(yAxis?.props.scale).toBeUndefined();
  });

  it("keeps explicit log bounds and derives only the unset side from data", () => {
    const canvas = asElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "stacked-bar",
          xKey: "category",
          yKeys: ["value"],
          yAxisScale: "log",
          yDomain: [2, "auto"],
        },
      }),
    );
    const chart = canvas ? asElement(canvas.props.children) : null;
    const axes = chart
      ? childrenOf(chart).find((child) => "xKey" in child.props)
      : undefined;
    const renderedAxes = axes ? renderComponent(axes) : null;
    const yAxis = renderedAxes
      ? childrenOf(renderedAxes).find((child) => child.type === YAxis)
      : undefined;

    expect(yAxis?.props.domain).toEqual([2, "dataMax"]);
  });
});
