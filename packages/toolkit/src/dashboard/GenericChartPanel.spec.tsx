import {
  AreaChart,
  Bar,
  BarChart,
  DefaultTooltipContent,
  LabelList,
  LineChart,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipPayloadEntry,
} from "recharts";
import { describe, expect, it, vi } from "vitest";

import {
  GenericChartRenderer,
  formatGenericChartValue,
  resolveGenericChartKeys,
} from "./GenericChartPanel.js";

const rows = [
  { day: "Mon", revenue: 12, costs: 4 },
  { day: "Tue", revenue: 18, costs: 7 },
];

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

function renderComponent(element: TestElement): TestElement | null {
  const component = element.type as (props: Record<string, unknown>) => unknown;
  return asTestElement(component(element.props));
}

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

  it.each([
    ["omitted", undefined, undefined],
    ["fully opaque", 1, 1],
    ["partially transparent", 0.35, 0.35],
  ] as const)(
    "passes %s opacity through to every bar",
    (_, opacity, expected) => {
      const element = asTestElement(
        GenericChartRenderer({
          rows,
          config: { chartType: "bar", style: { opacity } },
        }),
      );
      const chart = asTestElement(element?.props.children);
      const bars = chart
        ? childrenOf(chart).filter((child) => child.type === Bar)
        : [];

      expect(bars).toHaveLength(2);
      expect(bars.map((bar) => bar.props.opacity)).toEqual([
        expected,
        expected,
      ]);
    },
  );

  it.each([
    ["grouped columns", "bar", "horizontal"],
    ["stacked columns", "stacked-bar", "horizontal"],
    ["grouped bars", "bar", "vertical"],
    ["stacked bars", "stacked-bar", "vertical"],
  ] as const)(
    "applies the Recharts layout for %s",
    (_name, chartType, layout) => {
      const element = asTestElement(
        GenericChartRenderer({
          rows,
          config: { chartType, layout },
        }),
      );
      const chart = asTestElement(element?.props.children);

      expect(chart?.type).toBe(BarChart);
      expect(chart?.props.layout).toBe(layout);
    },
  );

  it("applies axis, domain, spacing, and dual bar-label options", () => {
    const element = asTestElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "bar",
          yKeys: ["revenue"],
          xAxisTitle: "Day",
          yAxisTitle: "Revenue",
          yDomain: [0, 2.6],
          yAxisTicks: [0, 1, 2, 3],
          plotMargin: { top: 12, right: 18 },
          barCategoryGap: "14%",
          barValueLabelPosition: "inside",
          barTotalLabelPosition: "top",
          showTooltip: false,
        },
      }),
    );
    const chart = asTestElement(element?.props.children);

    expect(chart?.type).toBe(BarChart);
    expect(chart?.props.margin).toEqual({
      top: 12,
      right: 18,
      bottom: 5,
      left: 5,
    });
    expect(chart?.props.barCategoryGap).toBe("14%");

    const chartChildren = chart ? childrenOf(chart) : [];
    const axes = chartChildren.find((child) => "xKey" in child.props);
    const axisFragment = axes ? renderComponent(axes) : null;
    const axesChildren = axisFragment ? childrenOf(axisFragment) : [];
    const xAxis = axesChildren.find((child) => child.type === XAxis);
    const yAxis = axesChildren.find((child) => child.type === YAxis);
    expect(xAxis?.props.label).toEqual({
      value: "Day",
      position: "insideBottom",
      offset: -8,
    });
    expect(yAxis?.props.label).toEqual({
      value: "Revenue",
      angle: -90,
      position: "insideLeft",
    });
    expect(yAxis?.props.domain).toEqual([0, 2.6]);
    expect(yAxis?.props.ticks).toEqual([0, 1, 2, 3]);
    expect(yAxis?.props.allowDataOverflow).toBe(true);

    const bar = chartChildren.find((child) => child.type === Bar);
    expect(
      bar
        ? childrenOf(bar)
            .filter((child) => child.type === LabelList)
            .map((child) => child.props.position)
        : [],
    ).toEqual(["inside", "top"]);

    const tooltip = chartChildren.find((child) => "show" in child.props);
    expect(tooltip ? renderComponent(tooltip) : null).toBeNull();
  });

  it("limits grouped chart category ticks by measured pixel width", () => {
    const measurementContext = {
      font: "",
      measureText: (text: string) => ({ width: Array.from(text).length * 8 }),
    };
    vi.stubGlobal("document", {
      body: {},
      createElement: () => ({ getContext: () => measurementContext }),
    });
    vi.stubGlobal("getComputedStyle", () => ({ fontFamily: "Arial" }));
    try {
      const sourceRows = [
        { category: "Northwest Enterprise Retention Segment", value: 1 },
        { category: "Month-to-date Expansion Opportunities", value: 2 },
        { category: "Strategic Accounts with Renewal Risk", value: 3 },
      ];
      const originalRows = structuredClone(sourceRows);
      const element = asTestElement(
        GenericChartRenderer({
          rows: sourceRows,
          config: {
            chartType: "bar",
            xKey: "category",
            yKey: "value",
            style: { maxLabelLength: 72 },
          },
        }),
      );
      const chart = asTestElement(element?.props.children);
      const axes = chart
        ? childrenOf(chart).find((child) => "xKey" in child.props)
        : undefined;
      const axisFragment = axes ? renderComponent(axes) : null;
      const xAxis = axisFragment
        ? childrenOf(axisFragment).find((child) => child.type === XAxis)
        : undefined;
      const tickFormatter = xAxis?.props.tickFormatter as (
        value: string,
      ) => string;
      const visibleLabels = sourceRows.map((row) =>
        tickFormatter(row.category),
      );

      expect(visibleLabels.every((label) => label.endsWith("…"))).toBe(true);
      expect(
        visibleLabels.every(
          (label) => measurementContext.measureText(label).width <= 72,
        ),
      ).toBe(true);
      expect(sourceRows).toEqual(originalRows);
      expect(sourceRows.map((row) => row.value)).toEqual([1, 2, 3]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("limits the custom tooltip to configured fields", () => {
    const element = asTestElement(
      GenericChartRenderer({
        rows,
        config: {
          chartType: "line",
          yKeys: ["revenue", "costs"],
          tooltipFields: ["revenue"],
        },
      }),
    );
    const chart = asTestElement(element?.props.children);
    const tooltip = chart
      ? childrenOf(chart).find((child) => "show" in child.props)
      : undefined;
    const rechartsTooltip = tooltip ? renderComponent(tooltip) : null;
    const content = rechartsTooltip?.props.content as (
      props: TooltipContentProps,
    ) => unknown;
    const payload: TooltipPayloadEntry[] = [
      {
        dataKey: "revenue",
        name: "revenue",
        value: 12,
        graphicalItemId: "revenue-series",
      },
      {
        dataKey: "costs",
        name: "costs",
        value: 4,
        graphicalItemId: "costs-series",
      },
    ];
    const customContent = asTestElement(
      content({
        payload,
        label: "Mon",
        active: true,
        activeIndex: "0",
        coordinate: undefined,
        accessibilityLayer: false,
      }),
    );

    expect(rechartsTooltip?.type).toBe(Tooltip);
    expect(customContent?.type).toBe(DefaultTooltipContent);
    expect(customContent?.props.payload).toEqual([payload[0]]);
    expect(customContent?.props.label).toBeUndefined();
  });

  it("shows labeled source fields beside plotted tooltip values", () => {
    const sourceRows = [
      { category: "alpha", value: 1, detail: "Alpha note" },
      { category: "beta", value: 2, detail: "Beta note" },
      { category: "gamma", value: 3, detail: "Gamma note" },
    ];
    const sourceMapping = { category: "category", value: "Sum(value)" };
    const sourceRowsBefore = structuredClone(sourceRows);
    const sourceMappingBefore = structuredClone(sourceMapping);
    const element = asTestElement(
      GenericChartRenderer({
        rows: sourceRows,
        config: {
          chartType: "bar",
          xKey: "category",
          yKey: "value",
          tooltipFields: ["category", "value", "detail"],
          tooltipFieldLabels: { detail: "Detail" },
        },
      }),
    );
    const chart = asTestElement(element?.props.children);
    const tooltip = chart
      ? childrenOf(chart).find((child) => "show" in child.props)
      : undefined;
    const rechartsTooltip = tooltip ? renderComponent(tooltip) : null;
    const content = rechartsTooltip?.props.content as (
      props: TooltipContentProps,
    ) => unknown;
    const customContent = asTestElement(
      content({
        payload: [
          {
            dataKey: "value",
            name: "Sum of value",
            value: 1,
            graphicalItemId: "value-series",
            payload: sourceRows[0],
          },
        ],
        label: "alpha",
        active: true,
        activeIndex: "0",
        coordinate: undefined,
        accessibilityLayer: false,
      }),
    );
    const tooltipPayload = customContent?.props
      .payload as TooltipPayloadEntry[];

    expect(customContent?.props.label).toBe("alpha");
    expect(tooltipPayload).toEqual([
      expect.objectContaining({ name: "Sum of value", value: 1 }),
      expect.objectContaining({
        dataKey: "detail",
        name: "Detail",
        value: "Alpha note",
      }),
    ]);
    expect(sourceRows).toEqual(sourceRowsBefore);
    expect(sourceMapping).toEqual(sourceMappingBefore);
  });

  it("omits missing labeled source fields from the tooltip", () => {
    const element = asTestElement(
      GenericChartRenderer({
        rows: [{ category: "alpha", value: 1, detail: null }],
        config: {
          chartType: "bar",
          xKey: "category",
          yKey: "value",
          tooltipFields: ["category", "value", "detail"],
          tooltipFieldLabels: { detail: "Detail" },
        },
      }),
    );
    const chart = asTestElement(element?.props.children);
    const tooltip = chart
      ? childrenOf(chart).find((child) => "show" in child.props)
      : undefined;
    const rechartsTooltip = tooltip ? renderComponent(tooltip) : null;
    const content = rechartsTooltip?.props.content as (
      props: TooltipContentProps,
    ) => unknown;
    const customContent = asTestElement(
      content({
        payload: [
          {
            dataKey: "value",
            name: "Sum of value",
            value: 1,
            graphicalItemId: "value-series",
            payload: { category: "alpha", value: 1, detail: null },
          },
        ],
        label: "alpha",
        active: true,
        activeIndex: "0",
        coordinate: undefined,
        accessibilityLayer: false,
      }),
    );

    expect(customContent?.props.payload).toEqual([
      expect.objectContaining({ name: "Sum of value", value: 1 }),
    ]);
  });

  it("splits categorical fields into horizontal and vertical panels", () => {
    const facetRows = [
      { day: "Mon", amount: 12, region: "East", channel: "Web" },
      { day: "Tue", amount: 18, region: "East", channel: "Store" },
      { day: "Mon", amount: 9, region: "West", channel: "Web" },
      { day: "Tue", amount: 14, region: "West", channel: "Store" },
    ];
    const element = asTestElement(
      GenericChartRenderer({
        rows: facetRows,
        config: {
          chartType: "bar",
          xKey: "day",
          yKey: "amount",
          horizontalFacet: "channel",
          verticalFacet: "region",
        },
      }),
    );
    const facetGrid = element ? renderComponent(element) : null;
    const panels = facetGrid ? childrenOf(facetGrid) : [];

    expect(facetGrid?.props.style).toEqual({
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    });
    expect(panels).toHaveLength(4);
    expect(
      panels.map(
        (panel) =>
          childrenOf(panel).find((child) => child.type === "h3")?.props
            .children,
      ),
    ).toEqual([
      "region: East · channel: Web",
      "region: East · channel: Store",
      "region: West · channel: Web",
      "region: West · channel: Store",
    ]);

    const firstChart = childrenOf(panels[0]!).find(
      (child) => child.type === GenericChartRenderer,
    );
    expect(firstChart?.props.rows).toEqual([facetRows[0]]);
    expect(firstChart?.props.config).toMatchObject({
      horizontalFacet: undefined,
      verticalFacet: undefined,
    });
  });

  it("rejects noncategorical facet values", () => {
    const element = asTestElement(
      GenericChartRenderer({
        rows: [{ day: "Mon", amount: 12, cohort: 2 }],
        config: {
          chartType: "bar",
          xKey: "day",
          yKey: "amount",
          horizontalFacet: "cohort",
        },
      }),
    );

    expect(element?.props.children).toBe(
      "Chart facets need distinct fields with text or boolean values.",
    );
  });

  it("uses the shared table renderer for tabular data", () => {
    const element = render("table");
    expect(element.type.name).toBe("DataTable");
    expect(element.props.data).toBe(rows);
  });
});
