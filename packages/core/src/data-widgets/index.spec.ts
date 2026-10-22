import { describe, expect, it } from "vitest";

import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  DATA_WIDGET_MAX_CHART_POINTS,
  DATA_WIDGET_MAX_ROWS,
  clampDataWidgetRows,
  createDataChartWidgetResult,
  createDataInsightsWidgetResult,
  createDataTableWidgetResult,
  dataChartWidgetResultSchema,
  dataInsightsWidgetResultSchema,
  normalizeDataWidgetResult,
} from "./index.js";

describe("data widget helpers", () => {
  it("creates explicit table widget results", () => {
    const result = createDataTableWidgetResult({
      widgetId: "test.table.v1",
      table: {
        title: "People",
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Ada" }],
      },
    });

    expect(result).toMatchObject({
      widget: DATA_TABLE_WIDGET,
      widgetId: "test.table.v1",
      table: { rows: [{ name: "Ada" }] },
    });
    expect(normalizeDataWidgetResult(result)).toMatchObject({
      widget: DATA_TABLE_WIDGET,
    });
  });

  it("creates explicit chart widget results", () => {
    const result = createDataChartWidgetResult({
      display: {
        primaryAction: { label: "Open report", href: "/reports/1" },
        sources: [{ id: "warehouse", label: "Warehouse", href: "/sources/1" }],
        actions: [
          { type: "link", label: "Open source", href: "/sources/1" },
          { type: "copy", label: "Copy query", text: "select 1" },
        ],
      },
      chartSeries: {
        type: "bar",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [{ day: "2026-06-17", responses: 3 }],
        actions: [
          {
            label: "Explore results",
            href: "/reports/1/explore",
            icon: "explore",
          },
        ],
      },
    });

    expect(dataChartWidgetResultSchema.parse(result)).toEqual(result);

    expect(result.widget).toBe(DATA_CHART_WIDGET);
    expect(normalizeDataWidgetResult(result)).toMatchObject({
      widget: DATA_CHART_WIDGET,
      display: {
        primaryAction: { label: "Open report", href: "/reports/1" },
        sources: [{ id: "warehouse", label: "Warehouse", href: "/sources/1" }],
        actions: [
          { type: "link", label: "Open source", href: "/sources/1" },
          { type: "copy", label: "Copy query", text: "select 1" },
        ],
      },
    });
    expect(normalizeDataWidgetResult(result)?.chartSeries).toMatchObject({
      actions: [
        {
          label: "Explore results",
          href: "/reports/1/explore",
          icon: "explore",
        },
      ],
    });
  });

  it("validates an explicit chart content height", () => {
    const result = createDataChartWidgetResult({
      chartSeries: {
        type: "bar",
        contentHeight: 400,
        xKey: "category",
        series: [{ key: "total", label: "Total" }],
        data: [{ category: "alpha", total: 1 }],
      },
    });

    expect(result.chartSeries.contentHeight).toBe(400);
    expect(dataChartWidgetResultSchema.parse(result)).toEqual(result);
  });

  it("validates chart padding and label typography", () => {
    const result = createDataChartWidgetResult({
      chartSeries: {
        type: "bar",
        layout: "horizontal",
        xAxisTitle: "Value",
        yAxisTitle: "Category",
        showValueLabels: true,
        contentHeight: 400,
        contentPadding: 16,
        labelFontFamily: "sans",
        labelFontSize: 14,
        axisTitleFontSize: 11,
        axisTitleFontWeight: 500,
        valueLabelFontSize: 11,
        valueLabelFontWeight: 400,
        xKey: "category",
        series: [{ key: "total", label: "Total" }],
        data: [{ category: "alpha", total: 1 }],
      },
    });

    expect(dataChartWidgetResultSchema.parse(result)).toEqual(result);
    expect(normalizeDataWidgetResult(result)?.chartSeries).toMatchObject({
      contentHeight: 400,
      contentPadding: 16,
      layout: "horizontal",
      xAxisTitle: "Value",
      yAxisTitle: "Category",
      showValueLabels: true,
      labelFontFamily: "sans",
      labelFontSize: 14,
      axisTitleFontSize: 11,
      axisTitleFontWeight: 500,
      valueLabelFontSize: 11,
      valueLabelFontWeight: 400,
    });
  });

  it("rejects chart presentation values outside the supported range", () => {
    const baseChart = {
      type: "bar" as const,
      xKey: "category",
      series: [{ key: "total", label: "Total" }],
      data: [],
    };

    expect(() =>
      createDataChartWidgetResult({
        chartSeries: { ...baseChart, contentPadding: 65 },
      }),
    ).toThrow("Invalid data-chart widget payload");
    expect(() =>
      createDataChartWidgetResult({
        chartSeries: { ...baseChart, labelFontFamily: "display" as never },
      }),
    ).toThrow("Invalid data-chart widget payload");
    expect(
      dataChartWidgetResultSchema.safeParse({
        widget: DATA_CHART_WIDGET,
        chartSeries: { ...baseChart, labelFontSize: 25 },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid chart content heights", () => {
    expect(() =>
      createDataChartWidgetResult({
        chartSeries: {
          type: "bar",
          contentHeight: 0,
          xKey: "category",
          series: [{ key: "total", label: "Total" }],
          data: [],
        },
      }),
    ).toThrow("Invalid data-chart widget payload");
    expect(
      dataChartWidgetResultSchema.safeParse({
        widget: DATA_CHART_WIDGET,
        chartSeries: {
          type: "bar",
          contentHeight: 1201,
          xKey: "category",
          series: [{ key: "total", label: "Total" }],
          data: [],
        },
      }).success,
    ).toBe(false);
  });

  it("preserves valid display actions and rejects malformed entries", () => {
    const normalized = normalizeDataWidgetResult({
      widget: DATA_CHART_WIDGET,
      chartSeries: {
        type: "line",
        xKey: "day",
        series: [{ key: "count", label: "Count" }],
        data: [{ day: "Mon", count: 2 }],
      },
      display: {
        title: "Counts",
        primaryAction: { label: "Open", href: "/reports/1" },
        sources: [{ label: "Valid source", href: "/sources/1" }],
        actions: [
          { type: "link", label: "Open", href: "/reports/1" },
          { type: "copy", label: "Copy", text: "select 1" },
        ],
      },
    });

    expect(normalized?.display).toEqual({
      title: "Counts",
      description: undefined,
      primaryAction: { label: "Open", href: "/reports/1" },
      sources: [{ label: "Valid source", href: "/sources/1" }],
      actions: [
        { type: "link", label: "Open", href: "/reports/1" },
        { type: "copy", label: "Copy", text: "select 1" },
      ],
    });
    expect(
      normalizeDataWidgetResult({
        widget: DATA_CHART_WIDGET,
        chartSeries: {
          type: "line",
          xKey: "day",
          series: [{ key: "count", label: "Count" }],
          data: [],
        },
        display: {
          sources: [{ label: "Valid source" }, { href: "/sources/2" }],
          actions: [
            { type: "link", label: "Open", href: "/reports/1" },
            { type: "copy", label: "Missing text" },
          ],
        },
      }),
    ).toBeNull();
    const invalidOptionalAction = normalizeDataWidgetResult({
      widget: DATA_CHART_WIDGET,
      chartSeries: {
        type: "line",
        xKey: "day",
        series: [{ key: "count", label: "Count" }],
        data: [],
      },
      display: {
        primaryAction: {
          label: "Open",
          href: "/reports/1",
          icon: "unknown",
        },
      },
    });
    expect(invalidOptionalAction?.widget).toBe(DATA_CHART_WIDGET);
    expect(invalidOptionalAction?.chartSeries?.data).toEqual([]);
    expect(invalidOptionalAction?.display?.primaryAction).toEqual({
      label: "Open",
      href: "/reports/1",
    });
  });

  it("creates insights widget results with app metadata", () => {
    const result = createDataInsightsWidgetResult({
      widgetId: "forms.responseInsights.v1",
      scope: { formId: "form_1" },
      summary: { responses: 3 },
      table: {
        columns: [{ key: "submittedAt", label: "Submitted" }],
        rows: [{ submittedAt: "2026-06-17T12:00:00.000Z" }],
      },
      display: {
        title: "Response insights",
        primaryAction: { label: "Open", href: "/forms/form_1/responses" },
      },
    });

    expect(result.widget).toBe(DATA_INSIGHTS_WIDGET);
    expect(result.scope).toEqual({ formId: "form_1" });
    expect(normalizeDataWidgetResult(result)).toMatchObject({
      widget: DATA_INSIGHTS_WIDGET,
      summary: { responses: 3 },
    });
  });

  it("creates chart-only insights widget results", () => {
    const result = createDataInsightsWidgetResult({
      widgetId: "forms.responseInsights.chart.v1",
      summary: { responses: 3 },
      chartSeries: {
        type: "bar",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [{ day: "Mon", responses: 3 }],
      },
    });

    expect(result.widget).toBe(DATA_INSIGHTS_WIDGET);
    expect(result.table).toBeUndefined();
    expect(normalizeDataWidgetResult(result)).toMatchObject({
      widget: DATA_INSIGHTS_WIDGET,
      chartSeries: { xKey: "day" },
    });
  });

  it("validates insights widget results without stripping app metadata", () => {
    const result = dataInsightsWidgetResultSchema.parse(
      createDataInsightsWidgetResult({
        scope: { formId: "form_1" },
        summary: { responses: 3 },
        table: {
          columns: [{ key: "submittedAt", label: "Submitted" }],
          rows: [{ submittedAt: "2026-06-17T12:00:00.000Z" }],
        },
        display: {
          sources: [{ label: "Responses", href: "/responses" }],
          actions: [{ type: "copy", label: "Copy ID", text: "form_1" }],
        },
      }),
    );

    expect(result.scope).toEqual({ formId: "form_1" });
    expect(result.display).toEqual({
      sources: [{ label: "Responses", href: "/responses" }],
      actions: [{ type: "copy", label: "Copy ID", text: "form_1" }],
    });
  });

  it("clamps oversized table rows and reports the real total", () => {
    const rows = Array.from({ length: 211 }, (_, index) => ({
      email: `user${index}@example.com`,
    }));

    const clamped = clampDataWidgetRows(
      createDataTableWidgetResult({
        table: { columns: [{ key: "email", label: "Email" }], rows },
      }),
    );

    expect(clamped.table.rows).toHaveLength(DATA_WIDGET_MAX_ROWS);
    expect(clamped.table.totalRows).toBe(211);
    expect(clamped.table.sampledRows).toBe(DATA_WIDGET_MAX_ROWS);
    expect(clamped.table.truncated).toBe(true);
  });

  it("preserves a caller-supplied totalRows when clamping", () => {
    const clamped = clampDataWidgetRows(
      createDataTableWidgetResult({
        table: {
          columns: [{ key: "email", label: "Email" }],
          rows: Array.from({ length: 60 }, () => ({ email: "a@example.com" })),
          totalRows: 5000,
        },
      }),
    );

    expect(clamped.table.totalRows).toBe(5000);
  });

  it("clamps oversized chart data and marks it sampled", () => {
    const clamped = clampDataWidgetRows(
      createDataChartWidgetResult({
        chartSeries: {
          type: "line",
          xKey: "day",
          series: [{ key: "count", label: "Count" }],
          data: Array.from({ length: 500 }, (_, index) => ({
            day: index,
            count: index,
          })),
        },
      }),
    );

    expect(clamped.chartSeries.data).toHaveLength(DATA_WIDGET_MAX_CHART_POINTS);
    expect(clamped.chartSeries.sampled).toBe(true);
  });

  it("returns within-limit widgets unchanged", () => {
    const result = createDataTableWidgetResult({
      table: {
        columns: [{ key: "email", label: "Email" }],
        rows: [{ email: "a@example.com" }],
      },
    });

    expect(clampDataWidgetRows(result)).toBe(result);
  });

  it("rejects invalid widget payloads when constructing results", () => {
    expect(() =>
      createDataTableWidgetResult({
        table: { columns: [{ key: "name", label: "Name" }], rows: "Ada" },
      } as never),
    ).toThrow("Invalid data-table widget payload");

    expect(() =>
      createDataInsightsWidgetResult({
        summary: { responses: 3 },
      } as never),
    ).toThrow("data-insights widgets require table or chartSeries");
  });
});
