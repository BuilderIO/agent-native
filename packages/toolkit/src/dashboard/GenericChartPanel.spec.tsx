import { AreaChart, BarChart, LineChart, PieChart } from "recharts";
import { describe, expect, it } from "vitest";

import {
  GenericChartRenderer,
  formatGenericChartValue,
  resolveGenericChartKeys,
} from "./GenericChartPanel.js";

const rows = [
  { day: "Mon", revenue: 12, costs: 4 },
  { day: "Tue", revenue: 18, costs: 7 },
];

function render(
  chartType: Parameters<typeof GenericChartRenderer>[0]["config"]["chartType"],
) {
  return GenericChartRenderer({ rows, config: { chartType } });
}

describe("GenericChartPanel renderers", () => {
  it("derives portable x/y keys and formats provider values", () => {
    expect(resolveGenericChartKeys(rows, {})).toEqual({
      xKey: "day",
      yKeys: ["revenue", "costs"],
    });
    expect(formatGenericChartValue("1200")).toBe("1,200");
  });

  it("renders KPI metrics from an inferred numeric value", () => {
    const element = render("metric");
    expect(element.props.children[0].props.children).toBe("30");
  });

  it.each([
    ["line", LineChart],
    ["area", AreaChart],
    ["stacked-area", AreaChart],
    ["bar", BarChart],
    ["stacked-bar", BarChart],
    ["pie", PieChart],
    ["donut", PieChart],
  ] as const)("uses Recharts for %s", (chartType, Component) => {
    const element = render(chartType);
    expect(element.props.children.type).toBe(Component);
  });

  it("uses the shared table renderer for tabular data", () => {
    const element = render("table");
    expect(element.type.name).toBe("DataTable");
    expect(element.props.data).toBe(rows);
  });
});
