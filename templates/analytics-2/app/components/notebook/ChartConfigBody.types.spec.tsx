// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChartSpec } from "@/lib/model/contracts";
import { pickSelect, selectTrigger } from "@/testing/select";

import type { ChartDrawingProps } from "./ChartDrawing";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const vegaChartSpy = vi.fn();

vi.mock("@agent-native/core/client/i18n", async () => {
  const { i18nMock } = await import("../../skins/reference/testing/i18n");
  return { ...i18nMock, useOptionalLocale: () => null };
});

vi.mock("./VegaChart", () => ({
  VegaChart: (props: ChartDrawingProps) => {
    vegaChartSpy(props);
    return (
      <div
        data-testid="vega-chart"
        data-mark={props.mark}
        data-orientation={props.orientation ?? ""}
        data-stack-mode={props.stackMode ?? ""}
        data-bin-count={props.binCount ?? ""}
      />
    );
  },
}));

import {
  chartMarkLabel,
  chartSeriesFrom,
  chartTypeGroups,
  type ChartDataframe,
} from "./chart-config";
import { ChartConfigBody } from "./ChartConfigBody";
import { ReadOnlyChart } from "./ReadOnlyChart";

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
}

const sampleDataframe: ChartDataframe = {
  name: "metrics",
  cellId: "c1",
  columns: [
    { name: "month", type: "string" },
    { name: "region", type: "string" },
    { name: "revenue", type: "number" },
    { name: "rate", type: "number" },
  ],
  rows: [
    ["Jan", "North", 100, 0.25],
    ["Jan", "South", 80, 0.2],
    ["Feb", "North", 140, 0.3],
    ["Feb", "South", 90, 0.22],
  ],
};

const ganttDataframe: ChartDataframe = {
  name: "schedule",
  cellId: "c2",
  columns: [
    { name: "task", type: "string" },
    { name: "start_date", type: "date" },
    { name: "end_date", type: "date" },
    { name: "owner", type: "string" },
  ],
  rows: [
    ["Design", "2026-01-01", "2026-01-10", "Alice"],
    ["Build", "2026-01-11", "2026-01-25", "Bob"],
  ],
};

const baseSpec: ChartSpec = {
  mark: "bar",
  xField: "month",
  yField: "revenue",
  seriesField: null,
  title: null,
};

const cleanups: Array<() => void> = [];

function renderConfig(
  overrides: Partial<Parameters<typeof ChartConfigBody>[0]> = {},
) {
  const onChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ChartConfigBody
        dataframe="metrics"
        spec={baseSpec}
        dataframes={[sampleDataframe]}
        onChange={onChange}
        {...overrides}
      />,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, onChange, root };
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vegaChartSpy.mockClear();
});

function openChartTypePicker(container: HTMLElement) {
  const toggle = container.querySelector<HTMLButtonElement>(
    ".nb-chart-type-toggle",
  );
  if (toggle?.getAttribute("aria-expanded") !== "true") {
    act(() => toggle!.click());
  }
}

describe("Chart type picker groups and patches", () => {
  it("report A2-FIND-1120F-S3-1: collapses the chart type picker by default and opens on click", () => {
    const { container } = renderConfig();
    const toggle = container.querySelector<HTMLButtonElement>(
      ".nb-chart-type-toggle",
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.textContent?.trim()).toBe("Grouped column");
    expect(container.querySelector(".nb-chart-types")).toBeNull();
    openChartTypePicker(container);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".nb-chart-types")).not.toBeNull();
  });

  it("renders all 4 Hex picker groups and all chart type buttons", () => {
    const { container } = renderConfig();
    openChartTypePicker(container);
    const groups = [...container.querySelectorAll(".nb-chart-type-group")].map(
      (group) => ({
        name: group
          .querySelector(".nb-chart-config-label")
          ?.textContent?.trim(),
        buttons: [...group.querySelectorAll(".nb-chart-type")].map((button) =>
          button.textContent?.trim(),
        ),
      }),
    );

    expect(groups).toEqual([
      {
        name: "Column",
        buttons: ["Grouped column", "Stacked column", "100% Stacked column"],
      },
      {
        name: "Bar",
        buttons: ["Grouped bar", "Stacked bar", "100% Stacked bar"],
      },
      {
        name: "Line & Area",
        buttons: ["Line", "Stacked area", "100% Stacked area"],
      },
      {
        name: "Other",
        buttons: [
          "Histogram",
          "Combo",
          "Heat map",
          "Gantt",
          "Scatter",
          "Pie",
          "Sankey",
          "Funnel",
        ],
      },
    ]);
    expect(chartTypeGroups).toHaveLength(4);
    expect(chartMarkLabel("bar")).toBe("Grouped column");
    expect(chartMarkLabel("gantt")).toBe("Gantt");
    expect(chartMarkLabel("heatmap")).toBe("Heat map");
    expect(chartMarkLabel("histogram")).toBe("Histogram");
    expect(chartMarkLabel("combo")).toBe("Combo");
  });

  it("hides Sankey and Funnel when fullResult renderResult is provided", () => {
    const { container } = renderConfig({
      renderResult: () => <div data-testid="full-result" />,
    });
    openChartTypePicker(container);
    const labels = [
      ...container.querySelectorAll(".nb-chart-types .nb-chart-type"),
    ].map((button) => button.textContent?.trim());
    expect(labels).toContain("Stacked column");
    expect(labels).toContain("100% Stacked bar");
    expect(labels).toContain("Histogram");
    expect(labels).toContain("Combo");
    expect(labels).toContain("Heat map");
    expect(labels).toContain("Gantt");
    expect(labels).not.toContain("Sankey");
    expect(labels).not.toContain("Funnel");
  });

  it.each<[string, Partial<ChartSpec>]>([
    [
      "Grouped column",
      {
        mark: "bar",
        orientation: "vertical",
        stacked: false,
        stackMode: "grouped",
      },
    ],
    [
      "Stacked column",
      {
        mark: "bar",
        orientation: "vertical",
        stacked: true,
        stackMode: "stacked",
      },
    ],
    [
      "100% Stacked column",
      {
        mark: "bar",
        orientation: "vertical",
        stacked: true,
        stackMode: "normalize",
      },
    ],
    [
      "Grouped bar",
      {
        mark: "bar",
        orientation: "horizontal",
        stacked: false,
        stackMode: "grouped",
      },
    ],
    [
      "Stacked bar",
      {
        mark: "bar",
        orientation: "horizontal",
        stacked: true,
        stackMode: "stacked",
      },
    ],
    [
      "100% Stacked bar",
      {
        mark: "bar",
        orientation: "horizontal",
        stacked: true,
        stackMode: "normalize",
      },
    ],
    [
      "Line",
      {
        mark: "line",
        orientation: undefined,
        stacked: false,
        stackMode: undefined,
      },
    ],
    [
      "Stacked area",
      {
        mark: "area",
        orientation: undefined,
        stacked: true,
        stackMode: "stacked",
      },
    ],
    [
      "100% Stacked area",
      {
        mark: "area",
        orientation: undefined,
        stacked: true,
        stackMode: "normalize",
      },
    ],
    [
      "Histogram",
      {
        mark: "histogram",
        orientation: undefined,
        stacked: false,
        stackMode: undefined,
      },
    ],
    [
      "Combo",
      {
        mark: "combo",
        orientation: undefined,
        stacked: false,
        stackMode: undefined,
      },
    ],
    [
      "Heat map",
      {
        mark: "heatmap",
        orientation: undefined,
        stacked: false,
        stackMode: undefined,
      },
    ],
    [
      "Gantt",
      {
        mark: "gantt",
        orientation: undefined,
        stacked: false,
        stackMode: undefined,
      },
    ],
    [
      "Scatter",
      {
        mark: "scatter",
        orientation: undefined,
        stacked: false,
        stackMode: undefined,
      },
    ],
    [
      "Pie",
      {
        mark: "pie",
        orientation: undefined,
        stacked: false,
        stackMode: undefined,
      },
    ],
  ])("emits exact patch and marks %s as active", (label, expectedPatch) => {
    const { container, onChange, root } = renderConfig();
    openChartTypePicker(container);
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".nb-chart-types .nb-chart-type",
      ),
    ].find((node) => node.textContent?.trim() === label);
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(onChange).toHaveBeenCalledWith({ chartSpec: expectedPatch });

    const nextSpec: ChartSpec = { ...baseSpec, ...expectedPatch };
    act(() =>
      root.render(
        <ChartConfigBody
          dataframe="metrics"
          spec={nextSpec}
          dataframes={[sampleDataframe]}
          onChange={onChange}
        />,
      ),
    );
    openChartTypePicker(container);
    const pressed = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '.nb-chart-types .nb-chart-type[aria-pressed="true"]',
      ),
    ].map((node) => node.textContent?.trim());
    expect(pressed).toEqual([label]);
  });

  it("matches legacy bar, stacked bar, and area specs accurately", () => {
    const legacyCases: Array<[Partial<ChartSpec>, string]> = [
      [{ mark: "bar" }, "Grouped column"],
      [{ mark: "bar", stacked: true }, "Stacked column"],
      [{ mark: "area" }, "Stacked area"],
    ];
    for (const [patch, expectedLabel] of legacyCases) {
      const { container } = renderConfig({ spec: { ...baseSpec, ...patch } });
      openChartTypePicker(container);
      const pressed = [
        ...container.querySelectorAll<HTMLButtonElement>(
          '.nb-chart-types .nb-chart-type[aria-pressed="true"]',
        ),
      ].map((node) => node.textContent?.trim());
      expect(pressed).toEqual([expectedLabel]);
    }
  });
});

describe("Axis and field controls for new chart types", () => {
  it("shows X-axis and optional Bins input for Histogram and hides Y-axis", () => {
    const { container, onChange } = renderConfig({
      spec: { ...baseSpec, mark: "histogram", xField: "revenue", yField: null },
    });
    expect(selectTrigger(container, "X-axis").textContent).toBe("revenue");
    expect(container.querySelector('[aria-label="Y-axis"]')).toBeNull();
    const bins = container.querySelector<HTMLInputElement>(
      'input[aria-label="Bins"]',
    );
    expect(bins).not.toBeNull();
    expect(bins?.placeholder).toBe("Auto");
    expect(bins?.min).toBe("2");
    expect(bins?.max).toBe("100");
    act(() => {
      setNativeValue(bins!, "12");
      bins!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ chartSpec: { binCount: 12 } });
  });

  it("shows Secondary Y-axis for Combo and updates secondaryYField and yFields", () => {
    const { container, onChange } = renderConfig({
      spec: {
        ...baseSpec,
        mark: "combo",
        xField: "month",
        yField: "revenue",
      },
    });
    expect(selectTrigger(container, "X-axis").textContent).toBe("month");
    expect(selectTrigger(container, "Y-axis").textContent).toBe("revenue");
    pickSelect(container, "Secondary Y-axis", "rate");
    expect(onChange).toHaveBeenCalledWith({
      chartSpec: {
        secondaryYField: "rate",
        yFields: ["revenue", "rate"],
      },
    });
  });

  it("shows X-axis, Y-axis (seriesField), and Value (yField) for Heat map", () => {
    const { container, onChange } = renderConfig({
      spec: {
        ...baseSpec,
        mark: "heatmap",
        xField: "month",
        seriesField: "region",
        yField: "revenue",
      },
    });
    expect(selectTrigger(container, "X-axis").textContent).toBe("month");
    expect(selectTrigger(container, "Y-axis").textContent).toBe("region");
    expect(selectTrigger(container, "Value").textContent).toBe("revenue");
    pickSelect(container, "Y-axis", "month");
    expect(onChange).toHaveBeenCalledWith({
      chartSpec: { seriesField: "month" },
    });
    pickSelect(container, "Value", "rate");
    expect(onChange).toHaveBeenCalledWith({
      chartSpec: { yField: "rate" },
    });
  });

  it("shows Task, Start, End, and Color by/Series for Gantt", () => {
    const { container, onChange } = renderConfig({
      dataframe: "schedule",
      dataframes: [ganttDataframe],
      spec: {
        ...baseSpec,
        version: 2,
        mark: "gantt",
        xField: "task",
        yField: "start_date",
        endField: "end_date",
        seriesField: "owner",
      },
    });
    expect(selectTrigger(container, "Task").textContent).toBe("task");
    expect(selectTrigger(container, "Start").textContent).toBe("start_date");
    expect(selectTrigger(container, "End").textContent).toBe("end_date");
    expect(selectTrigger(container, "Color by").textContent).toBe("owner");
    pickSelect(container, "End", "start_date");
    expect(onChange).toHaveBeenCalledWith({
      chartSpec: { endField: "start_date" },
    });
  });
});

describe("chartSeriesFrom data projection for new chart types", () => {
  it("projects histogram series without requiring yField even in v2", () => {
    const series = chartSeriesFrom(
      {
        mark: "histogram",
        version: 2,
        xField: "revenue",
        yField: null,
        seriesField: null,
        title: null,
      },
      sampleDataframe,
    );
    expect(series.columns).toEqual(["revenue"]);
    expect(series.rows).toEqual([[100], [80], [140], [90]]);
  });

  it("projects gantt series with task, start, end, and optional color", () => {
    const withColor = chartSeriesFrom(
      {
        mark: "gantt",
        version: 2,
        xField: "task",
        yField: "start_date",
        endField: "end_date",
        seriesField: "owner",
        title: null,
      },
      ganttDataframe,
    );
    expect(withColor.columns).toEqual([
      "task",
      "start_date",
      "end_date",
      "owner",
    ]);
    expect(withColor.rows).toEqual([
      ["Design", "2026-01-01", "2026-01-10", "Alice"],
      ["Build", "2026-01-11", "2026-01-25", "Bob"],
    ]);

    const legacyFallback = chartSeriesFrom(
      {
        mark: "gantt",
        xField: "task",
        yField: "start_date",
        seriesField: null,
        title: null,
      },
      ganttDataframe,
    );
    expect(legacyFallback.columns).toEqual(["task", "start_date", "end_date"]);
    expect(legacyFallback.rows).toHaveLength(2);
  });

  it("pivots heatmap series by x and seriesField", () => {
    const series = chartSeriesFrom(
      {
        mark: "heatmap",
        xField: "month",
        yField: "revenue",
        seriesField: "region",
        title: null,
      },
      sampleDataframe,
    );
    expect(series.columns).toEqual(["month", "North", "South"]);
    expect(series.rows).toEqual([
      ["Jan", 100, 80],
      ["Feb", 140, 90],
    ]);
  });

  it("projects combo series with primary bar measure first and deduplicated secondary measures", () => {
    const series = chartSeriesFrom(
      {
        mark: "combo",
        xField: "month",
        yField: "revenue",
        secondaryYField: "rate",
        yFields: ["revenue", "rate"],
        seriesField: null,
        title: null,
      },
      sampleDataframe,
    );
    expect(series.columns).toEqual(["month", "revenue", "rate"]);
    expect(series.rows[0]).toEqual(["Jan", 100, 0.25]);
  });

  it("projects horizontal and 100% stacked bar and area series", () => {
    const hBar = chartSeriesFrom(
      {
        mark: "bar",
        orientation: "horizontal",
        stacked: true,
        stackMode: "normalize",
        xField: "month",
        yField: "revenue",
        seriesField: "region",
        title: null,
      },
      sampleDataframe,
    );
    expect(hBar.columns).toEqual(["month", "North", "South"]);
    expect(hBar.rows).toEqual([
      ["Jan", 100, 80],
      ["Feb", 140, 90],
    ]);

    const pctArea = chartSeriesFrom(
      {
        mark: "area",
        stacked: true,
        stackMode: "normalize",
        xField: "month",
        yField: "revenue",
        seriesField: "region",
        title: null,
      },
      sampleDataframe,
    );
    expect(pctArea.columns).toEqual(["month", "North", "South"]);
    expect(pctArea.rows).toEqual([
      ["Jan", 100, 80],
      ["Feb", 140, 90],
    ]);
  });
});

describe("VegaChart prop forwarding", () => {
  it("passes orientation, stackMode, and binCount from ChartConfigBody and ReadOnlyChart", () => {
    const barSpec: ChartSpec = {
      ...baseSpec,
      mark: "bar",
      orientation: "horizontal",
      stacked: true,
      stackMode: "normalize",
      binCount: 20,
    };

    renderConfig({ spec: barSpec });
    expect(vegaChartSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mark: "bar",
        orientation: "horizontal",
        stackMode: "normalize",
        binCount: 20,
      }),
    );

    vegaChartSpy.mockClear();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <ReadOnlyChart
          dataframe="metrics"
          spec={barSpec}
          dataframes={[sampleDataframe]}
        />,
      ),
    );
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    expect(vegaChartSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mark: "bar",
        orientation: "horizontal",
        stackMode: "normalize",
        binCount: 20,
      }),
    );
  });
});
