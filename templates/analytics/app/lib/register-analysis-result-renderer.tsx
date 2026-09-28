import {
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  registerActionChatRenderer,
  resolveToolRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client/chat";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  ANALYTICS_ANALYSIS_RESULT_RENDERER,
  getSingleNumericAnalysisResult,
} from "@shared/analysis-result";

function AnalysisResultRenderer({ context }: ToolRendererProps) {
  const t = useT();
  const formatters = useFormatters();

  if (context.args.showTable === true) {
    const tableContext = {
      ...context,
      chatUI: { renderer: ACTION_CHAT_UI_DATA_TABLE_RENDERER },
    };
    const TableRenderer = resolveToolRenderer(tableContext);
    return TableRenderer ? <TableRenderer context={tableContext} /> : null;
  }

  const metric = getSingleNumericAnalysisResult(context.resultJson);
  if (!metric) return null;

  const label = metric.label.replace(/[_-]+/g, " ").trim();

  return (
    <figure
      data-analysis-result-card
      className="my-1.5 min-w-0 rounded-lg border border-border bg-background px-4 py-3 text-foreground shadow-sm"
    >
      <figcaption className="text-xs font-medium text-muted-foreground">
        {t("analysisResult.title")}
      </figcaption>
      <output className="mt-2 block truncate text-3xl font-semibold tracking-tight tabular-nums">
        {formatters.formatNumber(metric.value, { maximumFractionDigits: 2 })}
      </output>
      <p className="mt-1 truncate text-xs text-muted-foreground" title={label}>
        {label}
      </p>
    </figure>
  );
}

registerActionChatRenderer({
  id: "analytics.analysis-result",
  renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER,
  Component: AnalysisResultRenderer,
});
