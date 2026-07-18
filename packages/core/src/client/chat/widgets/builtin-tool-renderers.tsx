import { lazy, Suspense } from "react";

import {
  ACTION_CHAT_UI_DATA_CHART_RENDERER,
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
  ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER,
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
import { normalizeInlineExtensionToolResult } from "./inline-extension-result.js";

const LazyDataChartWidget = lazy(() =>
  import("./DataChartWidget.js").then((module) => ({
    default: module.DataChartWidget,
  })),
);
const LazyDataInsightsWidget = lazy(() =>
  import("./DataInsightsWidget.js").then((module) => ({
    default: module.DataInsightsWidget,
  })),
);
const LazyDataTableWidget = lazy(() =>
  import("./DataTableWidget.js").then((module) => ({
    default: module.DataTableWidget,
  })),
);
const LazyInlineExtensionWidget = lazy(() =>
  import("./InlineExtensionWidget.js").then((module) => ({
    default: module.InlineExtensionWidget,
  })),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeActionDataWidgetResult(
  context: ToolRendererContext,
): DataWidgetResult | null {
  const renderer = context.chatUI?.renderer;
  if (isRecord(context.resultJson)) {
    if (renderer === ACTION_CHAT_UI_DATA_TABLE_RENDERER) {
      return normalizeDataWidgetResult({
        ...context.resultJson,
        widget: DATA_TABLE_WIDGET,
        table: isRecord(context.resultJson.table)
          ? context.resultJson.table
          : context.resultJson,
      });
    }
    if (renderer === ACTION_CHAT_UI_DATA_CHART_RENDERER) {
      return normalizeDataWidgetResult({
        ...context.resultJson,
        widget: DATA_CHART_WIDGET,
        chartSeries: isRecord(context.resultJson.chartSeries)
          ? context.resultJson.chartSeries
          : context.resultJson,
      });
    }
    if (renderer === ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER) {
      return normalizeDataWidgetResult({
        ...context.resultJson,
        widget: DATA_INSIGHTS_WIDGET,
      });
    }
  }

  const result = normalizeDataWidgetResult(context.resultJson);
  if (result) return result;

  if (
    renderer === ACTION_CHAT_UI_DATA_WIDGET_RENDERER ||
    context.toolName === "render-data-widget"
  ) {
    const argsResult = normalizeDataWidgetResult(context.args);
    if (argsResult) return argsResult;
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
      <Suspense fallback={<BuiltinToolRendererSkeleton />}>
        <LazyDataTableWidget
          table={result.table}
          action={result.display?.primaryAction}
        />
      </Suspense>
    );
  }
  if (widget === DATA_CHART_WIDGET && result.chartSeries) {
    return (
      <Suspense fallback={<BuiltinToolRendererSkeleton />}>
        <LazyDataChartWidget chart={result.chartSeries} />
      </Suspense>
    );
  }
  if (widget === DATA_INSIGHTS_WIDGET) {
    return (
      <Suspense fallback={<BuiltinToolRendererSkeleton />}>
        <LazyDataInsightsWidget result={result} />
      </Suspense>
    );
  }
  return null;
}

function BuiltinToolRendererSkeleton() {
  return (
    <div
      aria-label="Loading tool result"
      className="my-1.5 h-24 animate-pulse rounded-lg border border-border bg-muted/30"
    />
  );
}

const BuiltinDataWidgetRenderer: ToolRendererComponent = ({ context }) =>
  renderDataWidget(context);

const BuiltinInlineExtensionRenderer: ToolRendererComponent = ({ context }) =>
  normalizeInlineExtensionToolResult(context) ? (
    <Suspense fallback={<BuiltinToolRendererSkeleton />}>
      <LazyInlineExtensionWidget context={context} />
    </Suspense>
  ) : null;

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
    context.chatUI?.renderer === ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER &&
    normalizeInlineExtensionToolResult(context)
  ) {
    return BuiltinInlineExtensionRenderer;
  }
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
  if (
    context.chatUI?.renderer === ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER &&
    normalizeInlineExtensionToolResult(context)
  ) {
    return BuiltinInlineExtensionRenderer;
  }
  return normalizeActionDataWidgetResult(context) !== null
    ? BuiltinDataWidgetRenderer
    : null;
}

for (const [id, renderer] of [
  ["core.data-table", ACTION_CHAT_UI_DATA_TABLE_RENDERER],
  ["core.data-chart", ACTION_CHAT_UI_DATA_CHART_RENDERER],
  ["core.data-insights", ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER],
  ["core.data-widget", ACTION_CHAT_UI_DATA_WIDGET_RENDERER],
  ["core.inline-extension", ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER],
] as const) {
  registerReservedActionChatRenderer({
    id,
    renderer,
    Component:
      renderer === ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER
        ? BuiltinInlineExtensionRenderer
        : BuiltinDataWidgetRenderer,
  });
}

registerReservedFallbackToolRenderer({
  id: "core.data-widgets",
  match: (context) => normalizeActionDataWidgetResult(context) !== null,
  Component: BuiltinDataWidgetRenderer,
});
