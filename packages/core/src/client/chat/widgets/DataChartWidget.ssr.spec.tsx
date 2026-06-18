import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { DataChartWidget } from "./DataChartWidget.js";

vi.mock("recharts", () => {
  throw new Error("DataChartWidget should not import recharts during SSR");
});

describe("DataChartWidget SSR", () => {
  it("renders the stable placeholder without loading recharts", () => {
    const html = renderToString(
      <DataChartWidget
        chart={{
          type: "bar",
          title: "Submissions",
          xKey: "day",
          series: [{ key: "count", label: "Count" }],
          data: [{ day: "2026-06-17", count: 3 }],
        }}
      />,
    );

    expect(html).toContain("Submissions");
    expect(html).toContain("Chart");
    expect(html).not.toContain("Loading chart");
  });
});
