import { Pie, PieChart } from "recharts";
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
  const collect = (value: unknown): TestElement[] => {
    if (Array.isArray(value)) return value.flatMap(collect);
    const child = asElement(value);
    return child ? [child] : [];
  };

  return collect(element.props.children);
}

describe("GenericChartRenderer pie labels", () => {
  it("shows numeric values when percentage labels are disabled", () => {
    const rows = [
      { category: "alpha", value: 1 },
      { category: "beta", value: 2 },
      { category: "gamma", value: 3 },
    ];
    const canvas = asElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "pie",
          xKey: "category",
          yKeys: ["value"],
          pieLabelsAsPercentage: false,
          formatValue: (value) => String(value),
        },
      }),
    );
    const chart = canvas ? asElement(canvas.props.children) : null;
    const pie = chart
      ? childrenOf(chart).find((child) => child.type === Pie)
      : undefined;
    const label = pie?.props.label as
      | ((props: { name: string; value: number; percent: number }) => string)
      | undefined;

    expect(chart?.type).toBe(PieChart);
    expect(pie?.props.data).toBe(rows);
    expect(label?.({ name: "alpha", value: 1, percent: 1 / 6 })).toBe("1");
    expect(label?.({ name: "beta", value: 2, percent: 2 / 6 })).toBe("2");
  });
});
