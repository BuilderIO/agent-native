// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { ChartSpec } from "@/lib/model/contracts";
import { pickSelect, selectLabels } from "@/testing/select";

import { ChartConfigBody } from "./ChartConfigBody";
import { ReadOnlyChart } from "./ReadOnlyChart";

vi.mock("@agent-native/core/client/i18n", async () => {
  const { i18nMock } = await import("../../skins/reference/testing/i18n");
  return { ...i18nMock, useOptionalLocale: () => null };
});

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
});
const rows = [
  { month: "January", value: 10 },
  { month: "February", value: 20 },
  { month: "March", value: 15 },
];
const spec = {
  mark: "bar" as const,
  xField: "month",
  yField: "value",
  seriesField: null,
  title: "Monthly values",
};
function render(node: ReactNode) {
  const el = document.createElement("div");
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(node));
  return el;
}
function draw(dataframe: string) {
  return render(
    <ChartConfigBody dataframe={dataframe} spec={spec} dataframes={[]} />,
  );
}

it.each([ChartConfigBody, ReadOnlyChart])(
  "%s reports malformed inline JSON instead of missing data or a saved chart",
  (Chart) => {
    const el = render(
      <Chart
        dataframe={'[{"month":"January","value":10},]'}
        spec={spec}
        dataframes={[]}
        output={{
          type: "chart",
          columns: ["month", "value"],
          rows: [["Saved", 99]],
        }}
      />,
    );
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "Invalid dataframeThe input dataframe cannot be used in this context. Check that the dataframe has at least one column.",
    );
    expect(el.querySelector(".nb-chart-svg")).toBeNull();
    expect(el.textContent).not.toContain("No dataframes yet");
  },
);
it("draws persisted inline rows as three real bars with exact values", () => {
  const el = draw(JSON.stringify(rows));
  expect(
    [...el.querySelectorAll(".nb-chart-bar title")].map((x) => x.textContent),
  ).toEqual(["January: 10", "February: 20", "March: 15"]);
  expect(el.querySelectorAll(".nb-chart-axis")).toHaveLength(1);
});

it.each([
  { Chart: ChartConfigBody, stacked: false },
  { Chart: ReadOnlyChart, stacked: true },
])(
  "colors each column and legend entry by series (stacked: $stacked)",
  ({ Chart, stacked }) => {
    const el = document.createElement("div");
    const root = createRoot(el);
    roots.push(root);
    const chartSpec = {
      ...spec,
      xField: "segment",
      yField: "revenue",
      seriesField: "channel",
      title: null,
      stacked,
    };
    const draw = (rows: Array<[string, number, string]>) =>
      act(() =>
        root.render(
          <Chart
            dataframe="orders"
            spec={chartSpec}
            dataframes={[
              {
                name: "orders",
                cellId: "source",
                columns: [
                  { name: "segment", type: "string" },
                  { name: "revenue", type: "number" },
                  { name: "channel", type: "string" },
                ],
                rows,
              },
            ]}
          />,
        ),
      );
    const bars = () => [
      ...el.querySelectorAll<SVGRectElement>(".nb-chart-bar"),
    ];
    const legend = () => [
      ...el.querySelectorAll<HTMLElement>(".nb-chart-caption > span"),
    ];
    const paletteColor = (mark: SVGRectElement | HTMLElement) =>
      mark.style.getPropertyValue("--nb-series-color");

    draw([
      ["consumer", 20, "Retail"],
      ["consumer", 10, "Direct"],
    ]);
    expect
      .soft(el.querySelector(".nb-chart svg")?.getAttribute("aria-label"))
      .toBe("revenue by segment");
    expect
      .soft(el.querySelector(".nb-chart-caption")?.textContent)
      .toBe("revenue by segment");
    expect
      .soft(legend().map((item) => [item.textContent, item.style.color]))
      .toEqual([
        ["● Retail", "var(--nb-tableau-2)"],
        ["● Direct", "var(--nb-tableau-1)"],
      ]);
    expect
      .soft(bars().map(paletteColor))
      .toEqual(["var(--nb-tableau-2)", "var(--nb-tableau-1)"]);

    draw([["consumer", 20, "Retail"]]);
    expect(bars().map(paletteColor)).toEqual(["var(--nb-tableau-2)"]);
    expect(legend().map((item) => item.style.color)).toEqual([
      "var(--nb-tableau-2)",
    ]);
  },
);

it("plots chronological monthly sums by color and keeps colors on dataframe refresh", () => {
  const el = document.createElement("div");
  const root = createRoot(el);
  roots.push(root);
  let line: Parameters<typeof ChartConfigBody>[0]["spec"] = {
    mark: "line",
    xField: "date",
    yField: "total",
    seriesField: "channel",
    title: "Orders by channel",
  };
  let dataframeRows: Array<[string, number, string]> = [
    ["2025-05-29", 4, "Retail"],
    ["2025-01-26", 2, "Direct"],
    ["2025-01-02", 3, "Retail"],
    ["2025-01-13", 8, "Retail"],
    ["2025-02-01", 7, "Retail"],
  ];
  const draw = () =>
    root.render(
      <ChartConfigBody
        dataframe="orders"
        spec={line}
        dataframes={[
          {
            name: "orders",
            cellId: "source",
            columns: [
              { name: "date", type: "date" },
              { name: "total", type: "number" },
              { name: "channel", type: "string" },
            ],
            rows: dataframeRows,
          },
        ]}
        onChange={({ chartSpec }) => {
          line = { ...line, ...chartSpec };
          draw();
        }}
      />,
    );
  act(draw);

  const chart = el.querySelector(".nb-chart");
  expect(chart?.firstElementChild?.textContent).toBe("Orders by channel");
  const legend = () => [
    ...el.querySelectorAll<HTMLElement>(".nb-chart-legend li"),
  ];
  expect(legend().map((item) => item.textContent)).toEqual([
    "Direct",
    "Retail",
  ]);
  expect(
    legend().map((item) => item.style.getPropertyValue("--nb-series-color")),
  ).toEqual(["var(--nb-tableau-1)", "var(--nb-tableau-2)"]);
  const retailPoints = () =>
    [...el.querySelectorAll(".nb-chart-point")].filter((point) =>
      point.querySelector("title")?.textContent?.endsWith("channel: Retail"),
    );
  expect(
    retailPoints().map((point) => point.querySelector("title")?.textContent),
  ).toEqual([
    "Month of date: Jan 2025\nSum of total: 11\nchannel: Retail",
    "Month of date: Feb 2025\nSum of total: 7\nchannel: Retail",
    "Month of date: May 2025\nSum of total: 4\nchannel: Retail",
  ]);
  const x = retailPoints().map((point) => Number(point.getAttribute("cx")));
  expect(x[1]! - x[0]!).toBeLessThan(x[2]! - x[1]!);

  document.body.append(el);
  expect(selectLabels(el, "Aggregation")).toEqual([
    "None",
    "Sum",
    "Count",
    "Avg",
    "Min",
    "Max",
    "Count distinct",
    "Median",
    "Stddev",
    "Stddevpop",
    "Variance",
    "Variancepop",
  ]);
  pickSelect(el, "Aggregation", "Avg");
  expect(retailPoints()[0]?.querySelector("title")?.textContent).toBe(
    "Month of date: Jan 2025\nAvg of total: 5.5\nchannel: Retail",
  );
  dataframeRows = dataframeRows.filter((row) => row[2] !== "Direct");
  act(draw);
  expect(legend().map((item) => item.textContent)).toEqual(["Retail"]);
  expect(legend()[0]?.style.getPropertyValue("--nb-series-color")).toBe(
    "var(--nb-tableau-2)",
  );
});

it("renders stacked monthly sums with an outside legend, independently ordered colors, and readable narrow tiles", () => {
  const el = document.createElement("div");
  const root = createRoot(el);
  roots.push(root);
  const stacked: ChartSpec = {
    ...spec,
    version: 2,
    mark: "bar",
    stacked: true,
    xField: "date",
    yField: "value",
    seriesField: "channel",
    sourceCellId: "source",
  };
  const data = {
    name: "orders",
    cellId: "source",
    columns: [
      { name: "date", type: "date" },
      { name: "value", type: "number" },
      { name: "channel", type: "string" },
    ],
    rows: [
      ["2025-05-21", 4, "Retail"],
      ["2025-01-20", 30, "Direct"],
      ["2025-01-02", 3, "Retail"],
      ["2025-01-13", 8, "Retail"],
      ["2025-02-01", 7, "Retail"],
    ],
  };
  const geometry = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(() => new DOMRect(0, 0, 342, 260));
  const draw = (rows = data.rows) =>
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="orders"
          spec={stacked}
          dataframes={[{ ...data, rows }]}
        />,
      ),
    );
  try {
    draw();
    const svg = el.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 342 260");
    expect(svg?.getAttribute("preserveAspectRatio")).not.toBe("none");
    const legend = () => [
      ...el.querySelectorAll<HTMLElement>(
        ".nb-chart-has-legend > svg + .nb-chart-legend li",
      ),
    ];
    expect(
      legend().map((item) => [
        item.textContent,
        item.style.getPropertyValue("--nb-series-color"),
      ]),
    ).toEqual([
      ["Retail", "var(--nb-tableau-2)"],
      ["Direct", "var(--nb-tableau-1)"],
    ]);
    const bars = [...el.querySelectorAll(".nb-chart-bar")];
    expect(bars.map((bar) => bar.querySelector("title")?.textContent)).toEqual([
      "Month of date: Jan 2025\nSum of value: 11\nchannel: Retail",
      "Month of date: Feb 2025\nSum of value: 7\nchannel: Retail",
      "Month of date: May 2025\nSum of value: 4\nchannel: Retail",
      "Month of date: Jan 2025\nSum of value: 30\nchannel: Direct",
    ]);
    const x = bars.map((bar) => Number(bar.getAttribute("x")));
    expect(x[0]).toBe(x[3]);
    expect((x[1] ?? 0) - (x[0] ?? 0)).toBeLessThan((x[2] ?? 0) - (x[1] ?? 0));
    draw(data.rows.filter((row) => row[2] === "Retail"));
    expect(
      legend().map((item) => [
        item.textContent,
        item.style.getPropertyValue("--nb-series-color"),
      ]),
    ).toEqual([["Retail", "var(--nb-tableau-2)"]]);
    draw([]);
    expect(el.textContent).toBe("No data");
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="orders"
          spec={stacked}
          dataframes={[{ ...data, name: "orders", cellId: "other" }]}
        />,
      ),
    );
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "Choose a chart source.",
    );
    expect(el.querySelector("svg")).toBeNull();
  } finally {
    geometry.mockRestore();
  }
});

it.each([
  "foreign_project.rows",
  "[]",
  '[{"month":"January","value":{}}]',
  '[{"month":"January","value":10},{"other":20}]',
  '[{"__proto__":1,"value":10}]',
  "not json",
])("does not interpret invalid or foreign bindings %s", (value) => {
  expect(draw(value).querySelector(".nb-chart-svg")).toBeNull();
});
