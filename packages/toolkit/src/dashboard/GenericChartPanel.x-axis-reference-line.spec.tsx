import { LineChart, ReferenceLine } from "recharts";
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

describe("GenericChartPanel X-axis reference lines", () => {
  it("attaches each X value as a vertical line to a Line chart", () => {
    const rows = [
      { x: 1, value: 10 },
      { x: 2, value: 20 },
      { x: 3, value: 30 },
    ];
    const root = asTestElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "line",
          xKey: "x",
          yKeys: ["value"],
          referenceLineXValues: [2],
        },
      }),
    );
    const chart = root ? childrenOf(root)[0] : null;
    const referenceLines = chart
      ? childrenOf(chart).filter((child) => child.type === ReferenceLine)
      : [];

    expect(chart?.type).toBe(LineChart);
    expect(chart?.props.data).toEqual(rows);
    expect(referenceLines).toHaveLength(1);
    expect(referenceLines[0]?.props.x).toBe(2);
  });
});
