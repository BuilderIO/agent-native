import { useT } from "@agent-native/core/client/i18n";
import { useMemo, type ReactNode } from "react";

import type { CellOutput, ChartSpec } from "@/lib/model/contracts";

import {
  resolveChartDataframe,
  useChartSeries,
  type ChartDataframe,
} from "./chart-config";
import {
  CompleteChartTile,
  usesCompleteChart,
  type ChartResultContext,
} from "./CompleteResultChart";
import { VegaChart } from "./VegaChart";

type ReadOnlyChartProps = {
  context?: ChartResultContext;
  dataframe: string | null;
  spec: ChartSpec;
  dataframes: readonly ChartDataframe[];
  output?: Extract<CellOutput, { type: "chart" }> | null;
  fallback?: ReactNode;
  missingSourceFallback?: ReactNode;
  onMarkClick?: ((mark: { x: string; series: string }) => void) | undefined;
};

export function ReadOnlyChart(props: ReadOnlyChartProps) {
  const { context, spec, dataframe, dataframes } = props;
  return context && usesCompleteChart(spec, dataframe, dataframes) ? (
    <CompleteChartTile
      context={context}
      spec={spec}
      dataframe={dataframe}
      dataframes={dataframes}
      missingSourceFallback={props.missingSourceFallback}
      onMarkClick={props.onMarkClick}
    />
  ) : (
    <LegacyChart {...props} />
  );
}

function LegacyChart({
  context,
  dataframe,
  spec,
  dataframes,
  output,
  fallback,
  missingSourceFallback,
  onMarkClick,
}: ReadOnlyChartProps) {
  const t = useT();
  const resolution = useMemo(
    () =>
      resolveChartDataframe(dataframe, dataframes, output, spec.sourceCellId),
    [dataframe, dataframes, output, spec.sourceCellId],
  );
  const selected = resolution.status === "ready" ? resolution.dataframe : null;
  const series = useChartSeries(spec, selected);
  if (resolution.status === "error") {
    if (resolution.reason === "sourceUnavailable") {
      if (context?.scope !== undefined && context.sourceResultId && fallback)
        return fallback;
      if (missingSourceFallback) return missingSourceFallback;
    }
    return (
      <div className="nb-side-panel-error" role="alert">
        {resolution.reason === "sourceUnavailable" ? (
          t("chartData.sourceUnavailable")
        ) : (
          <>
            <p>{t("chartData.invalidTitle")}</p>
            <p>{t("chartData.invalidMessage")}</p>
          </>
        )}
      </div>
    );
  }
  if (!selected) return fallback;
  if (spec.version === 2 && series.rows.length === 0) {
    return (
      <p className="nb-side-panel-note">
        {t(
          series.xField !== null &&
            (spec.mark === "histogram" ||
              (spec.mark === "gantt"
                ? series.yField !== null && spec.endField != null
                : series.yField !== null || spec.countRecords === true))
            ? "chartData.noData"
            : "chartData.chooseAxes",
        )}
      </p>
    );
  }
  return (
    <VegaChart
      columns={series.columns}
      rows={series.rows}
      encoding={series.encoding}
      mark={spec.mark}
      orientation={spec.orientation}
      stackMode={spec.stackMode}
      binCount={spec.binCount}
      funnelOutcomes={spec.funnelOutcomes}
      stacked={spec.stacked}
      colors={series.colors ?? spec.colors}
      yFormatter={spec.yFormatter}
      seriesLabels={spec.seriesLabels}
      legend={spec.legend}
      tooltipChannels={spec.tooltipChannels}
      onMarkClick={onMarkClick}
      title={spec.title}
    />
  );
}
