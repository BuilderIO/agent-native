import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
        display={{
          primaryAction: {
            label: "Open report",
            href: "https://reports.example.com/one",
          },
        }}
      />,
    );

    expect(html).toContain("Submissions");
    expect(html).toContain("Chart");
    expect(html).not.toContain("Loading chart");
    expect(html).toContain('href="https://reports.example.com/one"');

    const mailtoHtml = renderToString(
      <DataChartWidget
        chart={{
          type: "bar",
          xKey: "day",
          series: [{ key: "count", label: "Count" }],
          data: [],
        }}
        display={{
          primaryAction: {
            label: "Email report",
            href: "mailto:reports@example.com",
          },
        }}
      />,
    );
    expect(mailtoHtml).toContain('href="mailto:reports@example.com"');
  });
});
