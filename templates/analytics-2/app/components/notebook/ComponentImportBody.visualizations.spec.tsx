// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

vi.mock("./VegaChart", () => ({
  VegaChart: ({
    mark,
    rows,
  }: {
    mark?: string;
    rows: ReadonlyArray<unknown>;
  }) => (
    <div data-testid="captured-chart">
      chart:{mark ?? ""}:{rows.length}
    </div>
  ),
  VegaSpecChart: ({ spec }: { spec: Record<string, unknown> }) => (
    <div data-testid="captured-vega-chart">vega:{String(spec.mark ?? "")}</div>
  ),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: {
      component: { id: "comp-viz", name: "KPI Pack", cellCount: 5 },
      cells: [
        {
          id: "c-sql",
          kind: "sql",
          label: "Orders SQL",
          contents: {
            kind: "sql",
            resultVariable: "orders_df",
          },
          output: {
            type: "table",
            columns: [
              { name: "region", type: "string" },
              { name: "revenue", type: "number" },
            ],
            rows: [
              ["EMEA", 1200],
              ["APAC", 800],
            ],
            rowCount: 2,
            truncated: false,
          },
        },
        {
          id: "c-chart",
          kind: "chart",
          label: "Revenue Chart",
          contents: {
            kind: "chart",
            dataframe: "orders_df",
            chartSpec: {
              version: 2,
              mark: "bar",
              xField: "region",
              yField: "revenue",
              seriesField: null,
              title: null,
              sourceCellId: "c-sql",
            },
          },
        },
        {
          id: "c-table",
          kind: "display-table",
          label: "Orders Table",
          contents: {
            kind: "display-table",
            dataframe: "orders_df",
            columns: [
              {
                name: "region",
                header: "Region Name",
                hidden: false,
                format: null,
              },
              { name: "revenue", header: "Rev", hidden: false, format: null },
            ],
          },
        },
        {
          id: "c-metric",
          kind: "metric",
          label: "Total Revenue",
          contents: {
            kind: "metric",
            metricConfig: {
              version: 1,
              source: { cellId: "c-sql", dataframe: "orders_df" },
              value: { field: "revenue", aggregation: "sum" },
              format: { kind: "number", decimals: 0 },
            },
          },
        },
        {
          id: "c-vega",
          kind: "vega-chart",
          label: "Custom Vega",
          contents: {
            kind: "vega-chart",
            spec: { mark: "line", data: { values: [] } },
          },
        },
      ],
    },
    isPending: false,
    error: null,
  }),
}));

const { ComponentImportBody } = await import("./ComponentImportBody");

it("report QA-1795079397 renders captured chart, display-table, metric, and vega-chart cells from captured SQL dataframes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ComponentImportBody componentId="comp-viz" title="KPI Pack" />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(
      mount.querySelector('[data-testid="captured-chart"]')?.textContent,
    ).toBe("chart:bar:2");
    expect(
      mount.querySelector('[data-testid="captured-vega-chart"]')?.textContent,
    ).toBe("vega:line");
    expect(mount.textContent).toContain("Region Name");
    expect(mount.textContent).toContain("2,000");
    expect(mount.textContent).not.toContain("This cell captured no result.");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
