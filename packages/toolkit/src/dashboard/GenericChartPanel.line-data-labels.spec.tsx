import { LabelList, Line } from "recharts";
import { describe, expect, it } from "vitest";

import {
  GenericChartRenderer,
  type GenericChartConfig,
} from "./GenericChartPanel.js";

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

describe("GenericChartRenderer line labels", () => {
  it("renders formatted values with the configured position and style", () => {
    const element = asTestElement(
      GenericChartRenderer({
        rows: [
          { day: "Mon", revenue: 12 },
          { day: "Tue", revenue: 18 },
        ],
        config: {
          chartType: "line",
          yKeys: ["revenue"],
          colors: ["#bc5678"],
          lineDataLabelFormatter: (value: number) => value.toFixed(1),
          lineDataLabelPosition: "top",
          lineDataLabelAngle: 12,
          lineDataLabelFontSize: 10,
          lineDataLabelColor: "#123456",
        } satisfies GenericChartConfig,
      }),
    );
    const chart = asTestElement(element?.props.children);
    const line = chart
      ? childrenOf(chart).find((child) => child.type === Line)
      : undefined;
    const label = line
      ? childrenOf(line).find((child) => child.type === LabelList)
      : undefined;

    expect(label?.props).toMatchObject({
      angle: 12,
      dataKey: "revenue",
      fill: "#123456",
      fontSize: 10,
      position: "top",
    });
    expect((label?.props.formatter as (value: unknown) => string)(12)).toBe(
      "12.0",
    );
    expect((label?.props.formatter as (value: unknown) => string)("12")).toBe(
      "",
    );
  });

  it("uses the persisted point-marker and width settings", () => {
    const element = asTestElement(
      GenericChartRenderer({
        rows: [
          { day: "Mon", revenue: 12 },
          { day: "Tue", revenue: 18 },
        ],
        config: {
          chartType: "line",
          yKeys: ["revenue"],
          linePointsEnabled: true,
          lineSeriesWidth: 4.5,
        },
      }),
    );
    const chart = asTestElement(element?.props.children);
    const line = chart
      ? childrenOf(chart).find((child) => child.type === Line)
      : undefined;

    expect(line?.props.dot).toBe(true);
    expect(line?.props.strokeWidth).toBe(4.5);
  });
});
