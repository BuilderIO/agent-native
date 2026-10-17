import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  registerActionChatRenderer,
  resolveToolRenderer,
  type ToolRendererProps,
} from "@agent-native/toolkit/app/chat";
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
  const comparison = metric.comparison;

  return (
    <figure data-analysis-result-card className="my-0 min-w-0 text-foreground">
      <figcaption className="text-xs font-medium text-muted-foreground">
        {t("analysisResult.title")}
      </figcaption>
      <output className="mt-2 flex min-w-0 items-baseline gap-2 truncate text-3xl font-semibold tracking-tight tabular-nums">
        {comparison ? (
          <>
            <span>
              {formatters.formatNumber(comparison.changeRatio, {
                style: "percent",
                signDisplay: "always",
                maximumFractionDigits: 0,
              })}
            </span>
            <span className="truncate text-base font-medium">{label}</span>
          </>
        ) : (
          formatters.formatNumber(metric.value, { maximumFractionDigits: 2 })
        )}
      </output>
      <p
        className="mt-1 truncate text-xs text-muted-foreground"
        title={comparison ? comparison.period : label}
      >
        {comparison
          ? t("analysisResult.comparisonContext", {
              period: comparison.period,
              current: formatters.formatNumber(metric.value),
              previous: formatters.formatNumber(comparison.previousValue),
            })
          : label}
      </p>
    </figure>
  );
}

registerActionChatRenderer({
  id: "analytics.analysis-result",
  renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER,
  Component: AnalysisResultRenderer,
});
