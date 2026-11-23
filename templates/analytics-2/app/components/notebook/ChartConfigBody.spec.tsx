// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async () => {
  const { i18nMock } = await import("../../skins/reference/testing/i18n");
  return { ...i18nMock, useOptionalLocale: () => null };
});

// A chart cell used to render nothing at all: no type picker, no field chooser,
// no drawing. Every control below writes the cell's own settings, and the
// drawing follows them, which is the half of the report that was still failing.
import { pickSelect, selectTrigger } from "@/testing/select";

import { ChartConfigBody } from "./ChartConfigBody";
import { ChartDrawing } from "./ChartDrawing";

// React tracks an input's own value, so a test types through the native setter.
function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
}

const dataframes = [
  {
    name: "orders",
    cellId: "c1",
    columns: [
      { name: "region", type: "string" },
      { name: "order_total", type: "number" },
    ],
    rows: [
      ["north", 10],
      ["south", 30],
    ],
  },
];

const spec = {
  mark: "bar" as const,
  xField: null,
  yField: null,
  seriesField: null,
  title: null,
};

function render(
  overrides: Partial<Parameters<typeof ChartConfigBody>[0]> = {},
) {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ChartConfigBody
        dataframe="orders"
        spec={spec}
        dataframes={dataframes}
        onChange={onChange}
        {...overrides}
      />,
    ),
  );
  return { container, onChange };
}

it("offers the source's chart types and draws the chosen one", () => {
  const { container } = render();
  const toggle = container.querySelector<HTMLButtonElement>(
    ".nb-chart-type-toggle",
  );
  act(() => toggle!.click());
  const labels = [...container.querySelectorAll(".nb-chart-type")].map((node) =>
    node.textContent?.trim(),
  );
  // Labels and grouping come from chartTypeToSeriesTypeName and chartTypeGroups.
  expect(labels).toEqual([
    "Grouped column",
    "Line",
    "Stacked area",
    "Scatter",
    "Pie",
    "Sankey",
    "Funnel",
  ]);
  // The drawing is there for the default bar, from the dataframe's own columns.
  expect(container.querySelector(".nb-chart svg")).not.toBeNull();
  expect(container.querySelectorAll(".nb-chart-bar").length).toBe(2);
});

it("writes the chart type, the axes and the title back to the cell", () => {
  const { container, onChange } = render({ spec: { ...spec, version: 2 } });

  const toggle = container.querySelector<HTMLButtonElement>(
    ".nb-chart-type-toggle",
  );
  act(() => toggle!.click());
  const line = [...container.querySelectorAll(".nb-chart-type")].find(
    (node) => node.textContent?.trim() === "Line",
  ) as HTMLButtonElement;
  act(() => line.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { mark: "line" } });

  pickSelect(container, "X-axis", "region");
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { xField: "region" } });

  pickSelect(container, "Y-axis", "order_total");
  expect(onChange).toHaveBeenCalledWith({
    chartSpec: {
      yField: "order_total",
      countRecords: false,
      yAggregation: undefined,
    },
  });

  const title = container.querySelector(
    'input[aria-label="Chart title"]',
  ) as HTMLInputElement;
  act(() => {
    setNativeValue(title, "Orders");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    title.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { title: "Orders" } });
});

it("draws a line as a line and a pie as slices", () => {
  const line = render({ spec: { ...spec, mark: "line" } });
  expect(line.container.querySelector(".nb-chart-line")).not.toBeNull();

  const pie = render({ spec: { ...spec, mark: "pie" } });
  expect(pie.container.querySelectorAll(".nb-chart-slice").length).toBe(2);
});

it("says what is missing instead of drawing an empty frame", () => {
  const { container } = render({ dataframes: [] });
  expect(container.querySelector(".nb-chart svg")).toBeNull();
  expect(container.textContent).toContain(
    "No dataframes yet. Run a SQL or Python cell to create one.",
  );
});

it("is read-only without a save path", () => {
  const { container } = render({ onChange: undefined });
  const selects = [
    ...container.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'),
  ];
  expect(selects.length).toBeGreaterThan(0);
  expect(selects.every((select) => select.disabled)).toBe(true);
});

it("shows the saved result when the cell did not record a dataframe", () => {
  const { container } = render({
    dataframe: null,
    dataframes: [],
    output: {
      type: "chart",
      columns: ["order_date_month", "sum_order_total"],
      rows: [
        ["2025-11", 214938],
        ["2025-10", 188489],
      ],
    },
  });

  expect(selectTrigger(container, "DataFrame").textContent).toBe(
    "Saved result",
  );
  expect(selectTrigger(container, "X-axis").textContent).toBe(
    "order_date_month",
  );
  expect(selectTrigger(container, "Y-axis").textContent).toBe(
    "sum_order_total",
  );
  expect(container.textContent).toContain("Showing the saved result.");
  expect(container.textContent).not.toContain(
    "Choose a dataframe to draw the chart from.",
  );
  expect(container.querySelector(".nb-chart svg")).not.toBeNull();
});

it("configures and draws Sankey source, target, and value columns", () => {
  const flowData = [
    {
      name: "flows",
      cellId: "flow-cell",
      columns: [
        { name: "from", type: "string" },
        { name: "to", type: "string" },
        { name: "amount", type: "number" },
      ],
      rows: [
        ["A", "B", 4],
        ["B", "C", 8],
      ],
    },
  ];
  const { container, onChange } = render({
    dataframe: "flows",
    dataframes: flowData,
    spec: {
      ...spec,
      mark: "sankey",
      xField: "from",
      yField: "amount",
      seriesField: "to",
    },
  });
  expect(container.querySelectorAll(".nb-chart-sankey-link")).toHaveLength(2);
  expect(container.querySelector('[aria-label="Target"]')).not.toBeNull();
  pickSelect(container, "Target", "from");
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { seriesField: "from" } });
});

it("shows the saved result when the recorded dataframe name is not in the cell list", () => {
  const { container } = render({
    dataframe: "revenue_by_month",
    dataframes: [],
    output: {
      type: "chart",
      columns: ["order_date_month", "sum_order_total"],
      rows: [
        ["2025-11", 214938],
        ["2025-10", 188489],
      ],
    },
  });
  expect(selectTrigger(container, "DataFrame").textContent).toBe(
    "Saved result",
  );
  expect(container.textContent).toContain("Showing the saved result.");
  expect(container.textContent).not.toContain(
    "Choose a dataframe to draw the chart from.",
  );
  expect(container.querySelector(".nb-chart svg")).not.toBeNull();
});

it("plots each selected measure and exposes its value", () => {
  const { container } = render({
    spec: {
      ...spec,
      xField: "region",
      yField: "order_total",
      yFields: ["order_total", "count"],
    },
    dataframes: [
      {
        name: "orders",
        cellId: "c1",
        columns: [
          { name: "region", type: "string" },
          { name: "order_total", type: "number" },
          { name: "count", type: "number" },
        ],
        rows: [
          ["north", 10, 3],
          ["south", 30, 7],
        ],
      },
    ],
  });
  const values = [...container.querySelectorAll(".nb-chart-bar title")].map(
    (node) => node.textContent,
  );
  expect(values).toEqual([
    "north — order_total: 10",
    "south — order_total: 30",
    "north — count: 3",
    "south — count: 7",
  ]);
});

it("draws each funnel stage with its value", () => {
  const { container } = render({ spec: { ...spec, mark: "funnel" } });
  const stages = [
    ...container.querySelectorAll(".nb-chart-mark-funnel [data-funnel-stage]"),
  ].map((node) => node.getAttribute("aria-label"));
  expect(stages).toEqual([
    expect.stringMatching(/^north: 10 · 100\.0%/),
    expect.stringMatching(/^south: 30 · 300\.0% · ↑ 200\.0%/),
  ]);
});

it("lets an editor add and remove a second measure", () => {
  const extra = { name: "count", type: "number" };
  const { container, onChange } = render({
    spec: { ...spec, xField: "region", yField: "order_total" },
    dataframes: [
      { ...dataframes[0]!, columns: [...dataframes[0]!.columns, extra] },
    ],
  });
  const checkbox = container.querySelector<HTMLInputElement>(
    'details input[type="checkbox"]',
  );
  expect(checkbox).not.toBeNull();
  act(() => checkbox!.click());
  expect(onChange).toHaveBeenCalledWith({
    chartSpec: { yField: "order_total", yFields: ["order_total", "count"] },
  });
});

it("pivots series values and stacks bars at each category", () => {
  const { container } = render({
    spec: {
      ...spec,
      xField: "date",
      yField: "visitors",
      seriesField: "template",
      stacked: true,
    },
    dataframes: [
      {
        name: "orders",
        cellId: "c1",
        columns: [
          { name: "date", type: "string" },
          { name: "template", type: "string" },
          { name: "visitors", type: "number" },
        ],
        rows: [
          ["one", "analytics", 5],
          ["one", "chat", 3],
          ["two", "analytics", 2],
          ["two", "chat", 4],
        ],
      },
    ],
  });
  const bars = [...container.querySelectorAll(".nb-chart-bar")];
  expect(bars.map((bar) => bar.querySelector("title")?.textContent)).toEqual([
    "one — analytics: 5",
    "two — analytics: 2",
    "one — chat: 3",
    "two — chat: 4",
  ]);
  expect(bars[0]?.getAttribute("x")).toBe(bars[2]?.getAttribute("x"));
  expect(
    Number(bars[2]?.getAttribute("y")) +
      Number(bars[2]?.getAttribute("height")),
  ).toBeCloseTo(Number(bars[0]?.getAttribute("y")));
});

it("stacks pivoted area series on the preceding series", () => {
  const { container } = render({
    spec: {
      ...spec,
      mark: "area",
      xField: "date",
      yField: "visitors",
      seriesField: "template",
    },
    dataframes: [
      {
        name: "orders",
        cellId: "c1",
        columns: [
          { name: "date", type: "string" },
          { name: "template", type: "string" },
          { name: "visitors", type: "number" },
        ],
        rows: [
          ["one", "analytics", 5],
          ["one", "chat", 3],
          ["two", "analytics", 2],
          ["two", "chat", 4],
        ],
      },
    ],
  });
  const areas = [...container.querySelectorAll(".nb-chart-area")].map((area) =>
    area.getAttribute("points")?.split(" "),
  );
  expect(areas).toHaveLength(2);
  expect(areas[1]?.slice(-2).reverse()).toEqual(areas[0]?.slice(0, 2));
});

it("orders, labels, colors and formats pivot series", () => {
  const { container } = render({
    spec: {
      ...spec,
      xField: "date",
      yField: "rate",
      seriesField: "cohort",
      seriesOrder: ["new", "returning"],
      seriesLabels: { new: "New people", returning: "Returning people" },
      colors: ["#112233", "#334455"],
      yFormatter: "percent",
      legend: true,
    },
    dataframes: [
      {
        name: "orders",
        cellId: "c1",
        columns: [
          { name: "date", type: "string" },
          { name: "cohort", type: "string" },
          { name: "rate", type: "number" },
        ],
        rows: [
          ["one", "returning", 0.5],
          ["one", "new", 0.25],
        ],
      },
    ],
  });
  const bars = [...container.querySelectorAll(".nb-chart-bar")];
  expect(bars.map((bar) => bar.querySelector("title")?.textContent)).toEqual([
    "one — New people: 25.00%",
    "one — Returning people: 50.00%",
  ]);
  expect(bars[0]?.getAttribute("style")).toContain("#112233");
  expect(container.querySelector(".nb-chart-ticks")?.textContent).toContain(
    "%",
  );
  expect(
    container.querySelector(".nb-chart-caption:last-child")?.textContent,
  ).toContain("New people");
});

it("sends raw series values when a chart mark is activated", () => {
  const onMarkClick = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <ChartDrawing
        columns={["date", "raw"]}
        rows={[["2026-11-01", 2]]}
        mark="bar"
        seriesLabels={{ raw: "Display name" }}
        onMarkClick={onMarkClick}
      />,
    ),
  );
  const mark = container.querySelector<SVGElement>(".nb-chart-bar");
  expect(mark?.getAttribute("role")).toBe("button");
  act(() =>
    mark?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(onMarkClick).toHaveBeenCalledWith({ x: "2026-11-01", series: "raw" });
  act(() => root.unmount());
});

it("rounds the value-axis ticks and fits long signed labels inside the chart", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <ChartDrawing
          columns={["Region", "Revenue"]}
          rows={[
            ["West", 277_509_000],
            ["East", -143_123_000],
          ]}
          mark="bar"
        />,
      ),
    );
    const labels = [
      ...container.querySelectorAll(
        '.nb-chart-yticks > text[text-anchor="end"]',
      ),
    ];
    expect
      .soft(labels.map((label) => label.textContent))
      .toEqual([
        "-150,000,000",
        "0",
        "150,000,000",
        "300,000,000",
        "450,000,000",
      ]);
    expect(Number(labels[0]?.getAttribute("x"))).toBeGreaterThan(76);
  } finally {
    act(() => root.unmount());
  }
});

it("redraws the plot at the SVG's measured width when the tile resizes", () => {
  let notify: (width: number) => void = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(onResize: ResizeObserverCallback) {
        notify = (width) => {
          onResize(
            [
              {
                contentRect: new DOMRect(0, 0, width, 260),
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        };
      }

      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <ChartDrawing
          columns={["Region", "Orders"]}
          rows={[["West", 24]]}
          mark="bar"
        />,
      ),
    );
    const svg = container.querySelector("svg");
    const axis = svg?.querySelector(".nb-chart-axis");

    act(() => notify(480));
    expect(svg?.getAttribute("viewBox")).toBe("0 0 480 260");
    expect(axis?.getAttribute("x2")).toBe("464");

    act(() => notify(192));
    expect(svg?.getAttribute("viewBox")).toBe("0 0 192 260");
    expect(axis?.getAttribute("x2")).toBe("176");
    expect(svg?.getAttribute("preserveAspectRatio")).not.toBe("none");
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("saves palette, value format and legend choices", () => {
  const { container, onChange } = render();
  const palette = container.querySelector<HTMLInputElement>(
    'input[aria-label="Palette"]',
  );
  expect(palette).not.toBeNull();
  act(() => {
    setNativeValue(palette!, "#112233, #445566");
    palette!.dispatchEvent(new Event("input", { bubbles: true }));
    palette!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith({
    chartSpec: { colors: ["#112233", "#445566"] },
  });
  pickSelect(container, "Value format", "Percent");
  expect(onChange).toHaveBeenCalledWith({
    chartSpec: { yFormatter: "percent" },
  });
  const appearance = [...container.querySelectorAll("details")].find((node) =>
    node.textContent?.includes("Appearance"),
  );
  const legend = appearance?.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  expect(legend).not.toBeNull();
  act(() => legend!.click());
  expect(onChange).toHaveBeenCalledWith({ chartSpec: { legend: true } });
});
