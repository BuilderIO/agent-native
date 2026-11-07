import { Pie, PieChart } from "recharts";
import { describe, expect, it, vi } from "vitest";

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

describe("GenericChartRenderer pie slice clicks", () => {
  it("reports the selected chart datum and rendered index only when enabled", () => {
    const rows = [
      { category: "alpha", value: 3 },
      { category: "beta", value: 7 },
    ];
    const onPieSliceClick = vi.fn();
    const canvas = asElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "pie",
          xKey: "category",
          yKeys: ["value"],
          onPieSliceClick,
        },
      }),
    );
    const chart = canvas ? asElement(canvas.props.children) : null;
    const pie = chart
      ? childrenOf(chart).find((child) => child.type === Pie)
      : undefined;

    expect(chart?.type).toBe(PieChart);
    expect(pie?.props.onClick).toEqual(expect.any(Function));
    const onClick = pie?.props.onClick as
      | ((sector: unknown, rowIndex: number) => void)
      | undefined;
    onClick?.({}, 1);

    expect(onPieSliceClick).toHaveBeenCalledExactlyOnceWith({
      row: rows[1],
      rowIndex: 1,
    });
  });

  it("keeps pie slices non-interactive when no callback is supplied", () => {
    const canvas = asElement(
      GenericChartRenderer({
        rows: [{ category: "alpha", value: 3 }],
        config: {
          chartType: "pie",
          xKey: "category",
          yKeys: ["value"],
        },
      }),
    );
    const chart = canvas ? asElement(canvas.props.children) : null;
    const pie = chart
      ? childrenOf(chart).find((child) => child.type === Pie)
      : undefined;

    expect(pie?.props.onClick).toBeUndefined();
  });
});
