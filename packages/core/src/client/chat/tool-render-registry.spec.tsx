import { afterEach, describe, expect, it } from "vitest";
import {
  clearReservedToolRenderersForTests,
  clearToolRenderersForTests,
  registerReservedToolRenderer,
  registerToolRenderer,
  resolveToolRenderer,
  type ToolRendererProps,
} from "./tool-render-registry.js";
import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  isDataWidgetResult,
  normalizeDataWidgetKind,
  normalizeDataWidgetResult,
} from "./widgets/data-widget-types.js";

function FirstRenderer(_: ToolRendererProps) {
  return <div>first</div>;
}

function SecondRenderer(_: ToolRendererProps) {
  return <div>second</div>;
}

afterEach(() => {
  clearToolRenderersForTests();
  clearReservedToolRenderersForTests();
});

describe("tool render registry", () => {
  it("resolves the first explicit match", () => {
    registerToolRenderer({
      id: "first",
      match: "response-insights",
      Component: FirstRenderer,
    });
    registerToolRenderer({
      id: "second",
      match: "response-insights",
      Component: SecondRenderer,
    });

    expect(
      resolveToolRenderer({
        toolName: "response-insights",
        args: {},
        resultJson: {},
        isRunning: false,
      }),
    ).toBe(FirstRenderer);
  });

  it("unregisters renderers", () => {
    const unregister = registerToolRenderer({
      id: "first",
      match: "response-insights",
      Component: FirstRenderer,
    });
    unregister();

    expect(
      resolveToolRenderer({
        toolName: "response-insights",
        args: {},
        resultJson: {},
        isRunning: false,
      }),
    ).toBeNull();
  });

  it("keeps reserved renderers ahead of app registrations", () => {
    registerToolRenderer({
      id: "app",
      match: "response-insights",
      Component: FirstRenderer,
    });
    registerReservedToolRenderer({
      id: "reserved",
      match: "response-insights",
      Component: SecondRenderer,
    });

    expect(
      resolveToolRenderer({
        toolName: "response-insights",
        args: {},
        resultJson: {},
        isRunning: false,
      }),
    ).toBe(SecondRenderer);

    clearToolRenderersForTests();

    expect(
      resolveToolRenderer({
        toolName: "response-insights",
        args: {},
        resultJson: {},
        isRunning: false,
      }),
    ).toBe(SecondRenderer);
  });

  it("requires an explicit data-widget discriminant", () => {
    expect(isDataWidgetResult({ table: { rows: [] } })).toBe(false);
    expect(
      isDataWidgetResult({
        widget: DATA_INSIGHTS_WIDGET,
        table: {
          columns: [{ key: "name", label: "Name" }],
          rows: [{ name: "Ada" }],
        },
      }),
    ).toBe(true);
  });

  it("uses the public unversioned data-widget contract", () => {
    expect(DATA_TABLE_WIDGET).toBe("data-table");
    expect(DATA_CHART_WIDGET).toBe("data-chart");
    expect(DATA_INSIGHTS_WIDGET).toBe("data-insights");
    expect(normalizeDataWidgetKind("data-table.v1")).toBe(DATA_TABLE_WIDGET);
  });

  it("normalizes valid widget payloads and rejects invalid payloads", () => {
    expect(
      normalizeDataWidgetResult({
        widget: DATA_TABLE_WIDGET,
        table: {
          columns: [{ key: "name", label: "Name" }],
          rows: [{ name: "Ada" }],
        },
      }),
    ).toMatchObject({ widget: DATA_TABLE_WIDGET });

    expect(
      normalizeDataWidgetResult({
        widget: DATA_TABLE_WIDGET,
        table: { rows: [{ name: "Ada" }] },
      }),
    ).toBeNull();

    expect(
      normalizeDataWidgetResult({
        widget: DATA_CHART_WIDGET,
        chartSeries: {
          type: "bar",
          xKey: "day",
          series: [{ key: "submissions", label: "Submissions" }],
          data: [{ day: "2026-06-17", submissions: 3 }],
        },
      }),
    ).toMatchObject({ widget: DATA_CHART_WIDGET });

    expect(
      normalizeDataWidgetResult({
        widget: DATA_CHART_WIDGET,
        chartSeries: {
          type: "pie",
          xKey: "day",
          series: [],
          data: [],
        },
      }),
    ).toBeNull();

    expect(
      normalizeDataWidgetResult({
        widget: DATA_INSIGHTS_WIDGET,
        summary: { responses: 3 },
      }),
    ).toBeNull();
  });
});
