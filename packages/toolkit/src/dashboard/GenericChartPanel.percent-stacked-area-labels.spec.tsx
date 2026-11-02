import { Area, AreaChart, LabelList } from "recharts";
import { describe, expect, it } from "vitest";

import { GenericChartRenderer } from "./GenericChartPanel.js";

type TestElement = {
  type: unknown;
  props: Record<string, unknown>;
};

function asTestElement(value: unknown): TestElement | null {
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
    const child = asTestElement(value);
    return child ? [child] : [];
  }

  return collect(element.props.children);
}

describe("GenericChartPanel percent-stacked area labels", () => {
  it("attaches formatted labels to each stacked area series", () => {
    const rows = [
      { category: "alpha", alpha: 100, beta: 0, gamma: 0 },
      { category: "beta", alpha: 0, beta: 100, gamma: 0 },
      { category: "gamma", alpha: 0, beta: 0, gamma: 100 },
    ];
    const root = asTestElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "stacked-area",
          xKey: "category",
          yKeys: ["alpha", "beta", "gamma"],
          areaDataLabelFormatter: (value) =>
            `${Number.isInteger(value) ? value : value.toFixed(1)}%`,
          areaDataLabelAngle: 0,
        },
      }),
    );
    const chart = root ? childrenOf(root)[0] : null;
    const areas = chart
      ? childrenOf(chart).filter((child) => child.type === Area)
      : [];

    expect(chart?.type).toBe(AreaChart);
    expect(areas).toHaveLength(3);
    for (const area of areas) {
      const label = childrenOf(area).find((child) => child.type === LabelList);
      const formatter = label?.props.formatter as
        | ((value: unknown) => unknown)
        | undefined;
      expect(label?.props.dataKey).toBe(area.props.dataKey);
      expect(formatter?.(100)).toBe("100%");
      expect(label?.props.angle).toBe(0);
      expect(label?.props.position).toBeUndefined();
    }
  });
});
