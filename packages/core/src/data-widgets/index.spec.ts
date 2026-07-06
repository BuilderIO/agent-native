import { describe, expect, it } from "vitest";

import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  createDataChartWidgetResult,
  createDataInsightsWidgetResult,
  createDataTableWidgetResult,
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
      chartSeries: {
        type: "bar",
        xKey: "day",
        series: [{ key: "responses", label: "Responses" }],
        data: [{ day: "2026-06-17", responses: 3 }],
      },
    });

    expect(result.widget).toBe(DATA_CHART_WIDGET);
    expect(normalizeDataWidgetResult(result)).toMatchObject({
      widget: DATA_CHART_WIDGET,
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
      }),
    );

    expect(result.scope).toEqual({ formId: "form_1" });
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
