import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  normalizeDataWidgetKind,
  normalizeDataWidgetResult,
} from "./data-widget-types.js";
import { DataChartWidget } from "./DataChartWidget.js";
import { DataInsightsWidget } from "./DataInsightsWidget.js";
import { DataTableWidget } from "./DataTableWidget.js";
import { registerReservedToolRenderer } from "../tool-render-registry.js";

registerReservedToolRenderer({
  id: "core.data-widgets",
  match: (context) => normalizeDataWidgetResult(context.resultJson) !== null,
  Component: ({ context }) => {
    const result = normalizeDataWidgetResult(context.resultJson);
    if (!result) return null;
    const widget = normalizeDataWidgetKind(result.widget);
    if (widget === DATA_TABLE_WIDGET && result.table) {
      return <DataTableWidget table={result.table} />;
    }
    if (widget === DATA_CHART_WIDGET && result.chartSeries) {
      return <DataChartWidget chart={result.chartSeries} />;
    }
    if (widget === DATA_INSIGHTS_WIDGET) {
      return <DataInsightsWidget result={result} />;
    }
    return null;
  },
});
