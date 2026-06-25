import {
  ACTION_CHAT_UI_DATA_CHART_RENDERER,
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
} from "../../../action-ui.js";
import {
  registerReservedActionChatRenderer,
  registerReservedFallbackToolRenderer,
  type ToolRendererContext,
  type ToolRendererComponent,
} from "../tool-render-registry.js";
import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  normalizeDataWidgetKind,
  normalizeDataWidgetResult,
  type DataWidgetResult,
} from "./data-widget-types.js";
import { DataChartWidget } from "./DataChartWidget.js";
import { DataInsightsWidget } from "./DataInsightsWidget.js";
import { DataTableWidget } from "./DataTableWidget.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeActionDataWidgetResult(
  context: ToolRendererContext,
): DataWidgetResult | null {
  const result = normalizeDataWidgetResult(context.resultJson);
  if (result) return result;

  const renderer = context.chatUI?.renderer;
  if (
    renderer === ACTION_CHAT_UI_DATA_WIDGET_RENDERER ||
    context.toolName === "render-data-widget"
  ) {
    const argsResult = normalizeDataWidgetResult(context.args);
    if (argsResult) return argsResult;
  }

  if (!isRecord(context.resultJson)) return null;

  if (renderer === ACTION_CHAT_UI_DATA_TABLE_RENDERER) {
    return normalizeDataWidgetResult({
      widget: DATA_TABLE_WIDGET,
      table: isRecord(context.resultJson.table)
        ? context.resultJson.table
        : context.resultJson,
      display: isRecord(context.resultJson.display)
        ? context.resultJson.display
        : undefined,
    });
  }
  if (renderer === ACTION_CHAT_UI_DATA_CHART_RENDERER) {
    return normalizeDataWidgetResult({
      widget: DATA_CHART_WIDGET,
      chartSeries: isRecord(context.resultJson.chartSeries)
        ? context.resultJson.chartSeries
        : context.resultJson,
      display: isRecord(context.resultJson.display)
        ? context.resultJson.display
        : undefined,
    });
  }
  if (renderer === ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER) {
    return normalizeDataWidgetResult({
      ...context.resultJson,
      widget: DATA_INSIGHTS_WIDGET,
    });
  }

  return null;
}

function renderDataWidget(context: ToolRendererContext) {
  const result =
    normalizeActionDataWidgetResult(context) ??
    normalizeDataWidgetResult(context.resultJson);
  if (!result) return null;
  const widget = normalizeDataWidgetKind(result.widget);
  if (widget === DATA_TABLE_WIDGET && result.table) {
    return (
      <DataTableWidget
        table={result.table}
        action={result.display?.primaryAction}
      />
    );
  }
  if (widget === DATA_CHART_WIDGET && result.chartSeries) {
    return <DataChartWidget chart={result.chartSeries} />;
  }
  if (widget === DATA_INSIGHTS_WIDGET) {
    return <DataInsightsWidget result={result} />;
  }
  return null;
}

const BuiltinDataWidgetRenderer: ToolRendererComponent = ({ context }) =>
  renderDataWidget(context);

export function isBuiltinDataWidgetActionRenderer(
  context: ToolRendererContext,
): boolean {
  const renderer = context.chatUI?.renderer;
  return (
    renderer === ACTION_CHAT_UI_DATA_TABLE_RENDERER ||
    renderer === ACTION_CHAT_UI_DATA_CHART_RENDERER ||
    renderer === ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER ||
    renderer === ACTION_CHAT_UI_DATA_WIDGET_RENDERER
  );
}

export function resolveBuiltinActionChatRenderer(
  context: ToolRendererContext,
): ToolRendererComponent | null {
  if (
    isBuiltinDataWidgetActionRenderer(context) &&
    normalizeActionDataWidgetResult(context)
  ) {
    return BuiltinDataWidgetRenderer;
  }
  return null;
}

export function resolveBuiltinFallbackToolRenderer(
  context: ToolRendererContext,
): ToolRendererComponent | null {
  return normalizeActionDataWidgetResult(context) !== null
    ? BuiltinDataWidgetRenderer
    : null;
}

for (const [id, renderer] of [
  ["core.data-table", ACTION_CHAT_UI_DATA_TABLE_RENDERER],
  ["core.data-chart", ACTION_CHAT_UI_DATA_CHART_RENDERER],
  ["core.data-insights", ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER],
  ["core.data-widget", ACTION_CHAT_UI_DATA_WIDGET_RENDERER],
] as const) {
  registerReservedActionChatRenderer({
    id,
    renderer,
    Component: BuiltinDataWidgetRenderer,
  });
}

registerReservedFallbackToolRenderer({
  id: "core.data-widgets",
  match: (context) => normalizeActionDataWidgetResult(context) !== null,
  Component: BuiltinDataWidgetRenderer,
});
