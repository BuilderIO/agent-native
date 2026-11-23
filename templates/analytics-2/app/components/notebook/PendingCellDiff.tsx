import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { parameterInputName } from "@/lib/model/cell-types";
import type { CellContents, ChartSpec } from "@/lib/model/contracts";

import type getResult from "../../../actions/get-notebook-result-page";
import type getRun from "../../../actions/get-notebook-run";
import type getDiagnostics from "../../../actions/get-notebook-run-diagnostics";
import { bindDefaultChartAxes } from "../../../shared/chart-visualization-config";
import { parseMultiValue } from "../../../shared/notebook-input-values";
import { CellOutputView } from "./CellOutputView";
import { MarkdownCellView } from "./MarkdownCellView";
import { displayTable } from "./useNotebookResults";
import {
  proposalCell,
  type NotebookReview,
  type PendingChange,
} from "./useNotebookReview";
import { inputDisplayLabel } from "./utils";

type RunRead = Awaited<ReturnType<typeof getRun.run>>;
type ResultRead = Awaited<ReturnType<typeof getResult.run>>;
type DiagnosticRead = Awaited<ReturnType<typeof getDiagnostics.run>>;

function editableContent(contents: CellContents | undefined) {
  switch (contents?.kind) {
    case "sql":
    case "code":
      return contents.source;
    case "text":
      return contents.text;
    case "markdown":
      return contents.markdown;
  }
}

function ReviewContent({
  contents,
  prefix,
}: {
  contents: CellContents | undefined;
  prefix?: "added" | "removed";
}) {
  const value = editableContent(contents);
  if (value === undefined) return null;
  if (contents?.kind === "text" || contents?.kind === "markdown")
    return (
      <div className="px-3 py-2">
        <MarkdownCellView markdown={value} />
      </div>
    );
  return (
    <pre className="nb-pending-code">
      {prefix === "added" && <IconPlus size={14} aria-hidden="true" />}
      {prefix === "removed" && <IconMinus size={14} aria-hidden="true" />}
      <code>{value}</code>
    </pre>
  );
}

function settings(
  contents: CellContents | undefined,
  t: ReturnType<typeof useT>,
  formatList: ReturnType<typeof useFormatters>["formatList"],
): Record<string, string | null> {
  switch (contents?.kind) {
    case "collapsible":
      return { "notebook.section.name": contents.title ?? contents.label };
    case "chart": {
      const spec = contents.chartSpec;
      const field = (id: string | null) =>
        id === null ? null : (spec.fieldLabels?.[id] ?? id);
      const withOperation = (name: string | null, operation: string | null) =>
        name && operation
          ? t("chartAxis.fieldOperation", { field: name, operation })
          : name;
      const mark =
        spec.mark === "bar"
          ? spec.stacked
            ? "stackedColumn"
            : "groupedColumn"
          : spec.mark === "area" && spec.stacked
            ? "stackedArea"
            : spec.mark;
      const measure = spec.countRecords
        ? t("chartData.countRecords")
        : spec.yFields?.length
          ? formatList(spec.yFields.map((id) => spec.fieldLabels?.[id] ?? id))
          : field(spec.yField);
      return {
        "notebook.chartTypeLabel":
          mark === "sankey"
            ? t("notebook.sankey.label")
            : t(`visualization.charts.types.${mark}`),
        "notebook.chartDataframe": contents.dataframe
          ?.trimStart()
          .startsWith("[")
          ? t("notebook.chartSavedResult")
          : contents.dataframe,
        "notebook.chartXAxis": withOperation(
          field(spec.xField),
          spec.xTimeUnit && spec.xTimeUnit !== "none"
            ? t(`chartAxis.timeUnits.${spec.xTimeUnit}`)
            : null,
        ),
        "notebook.chartYAxis": withOperation(
          measure,
          !spec.countRecords &&
            spec.yAggregation &&
            spec.yAggregation !== "none"
            ? t(`chartAxis.aggregations.${spec.yAggregation}`)
            : null,
        ),
        "notebook.chartSeries": field(spec.seriesField),
        "visualization.charts.chartStyle.title": spec.title,
      };
    }
    case "input":
      return {
        "notebook.inputSettings.label": inputDisplayLabel(contents),
        "notebook.outlineTypeFilterLabel": parameterInputName(
          contents.inputType,
        ),
        "notebook.formatDefault":
          contents.inputType === "MULTISELECT"
            ? formatList(parseMultiValue(contents.defaultValueString))
            : contents.defaultValueString,
      };
    case "pivot":
    case "display-table":
      return { "notebook.chartDataframe": contents.dataframe };
    case "metric": {
      const config = contents.metricConfig;
      if (!config) return { "singleValue.value": contents.valueVariableName };
      return {
        "singleValue.value": config.source?.cellId ?? null,
        "singleValue.column": config.fieldId,
        "singleValue.type": t(`singleValue.${config.mode}`),
        ...(config.mode === "row"
          ? { "singleValue.row": String(config.row) }
          : {
              "singleValue.aggregate": config.aggregation
                ? t(`singleValue.aggregation.${config.aggregation}`)
                : null,
            }),
        "singleValue.title": config.title,
        "singleValue.format": config.format
          ? t(`singleValue.formats.${config.format}`)
          : null,
      };
    }
    default:
      return contents?.label
        ? { "notebook.inputSettings.label": contents.label }
        : {};
  }
}

function PendingSettingsDiff({
  before,
  after,
}: {
  before: CellContents | undefined;
  after: CellContents | undefined;
}) {
  const t = useT();
  const { formatList } = useFormatters();
  const current = settings(before, t, formatList);
  const proposed = settings(after, t, formatList);
  const none = t("chartAxis.none");
  return (
    <dl className="m-0 grid gap-x-3 gap-y-1 px-3 py-2 text-sm [grid-template-columns:auto_minmax(0,1fr)]">
      {[...new Set([...Object.keys(current), ...Object.keys(proposed)])].map(
        (label) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{t(label)}</dt>
            <dd className="m-0 flex flex-wrap gap-x-2 break-words">
              {before && after && current[label] !== proposed[label] ? (
                <>
                  <del className="text-muted-foreground">
                    {current[label] || none}
                  </del>
                  <ins className="font-medium text-primary">
                    {proposed[label] || none}
                  </ins>
                </>
              ) : (
                (after ? proposed[label] : current[label]) || none
              )}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function PendingOutput({
  change,
  review,
  onFix,
  before,
}: {
  change: PendingChange;
  review: NotebookReview;
  onFix?: ((cellId: string, attemptId: string) => void) | undefined;
  before: CellContents | undefined;
}) {
  const t = useT();
  const formatters = useFormatters();
  const cell = proposalCell(change);
  const chart = cell?.contents.kind === "chart" ? cell.contents : null;
  const source = chart
    ? review.changes.find((candidate) => {
        const producer = proposalCell(candidate);
        return chart.chartSpec.sourceCellId
          ? producer?.id === chart.chartSpec.sourceCellId
          : (producer?.contents.kind === "sql" ||
              producer?.contents.kind === "code") &&
              producer.contents.resultVariable != null &&
              producer.contents.resultVariable === chart.dataframe;
      })
    : undefined;
  const producer = source ?? change;
  const { threadId } = review;
  const run = useActionQuery<RunRead>(
    "get-notebook-run",
    { threadId, runId: producer.runId },
    {
      enabled: threadId !== null && producer.runId !== null,
      retry: false,
      refetchInterval: (query) => {
        const data = query.state.data;
        return data?.status === "pending" ||
          (data?.status === "found" &&
            data.run.attempts.some(
              ({ state }) =>
                state.status === "queued" || state.status === "running",
            ))
          ? 750
          : false;
      },
    },
  );
  const receipt =
    run.data?.status === "found" && !run.isError ? run.data.run : undefined;
  const attempt = receipt?.attempts.find(
    ({ attempt }) => attempt.cellId === producer.cellId,
  );
  const state = attempt?.state;
  const resultId =
    state?.status === "complete" ? state.resultIds[0] : producer.resultIds[0];
  const result = useActionQuery<ResultRead>(
    "get-notebook-result-page",
    { threadId, resultId, page: 1 },
    {
      enabled: threadId !== null && resultId !== undefined,
      retry: false,
      refetchInterval: (query) =>
        query.state.data?.status === "pending" ? 750 : false,
    },
  );
  const diagnostic = useActionQuery<DiagnosticRead>(
    "get-notebook-run-diagnostics",
    { threadId, runId: producer.runId, attemptId: attempt?.attempt.attemptId },
    { enabled: threadId !== null && state?.status === "failed", retry: false },
  );
  const page = result.isError ? undefined : result.data;
  if (chart !== null) {
    const spec: ChartSpec =
      chart.chartSpec.autoBind &&
      source &&
      page?.status === "ready" &&
      page.manifest.result.producer.exportId ===
        (chart.chartSpec.sourceExportId ?? "result")
        ? bindDefaultChartAxes(chart.chartSpec, page.manifest.fields)
        : chart.chartSpec;
    return (
      <PendingSettingsDiff
        before={before}
        after={{ ...chart, chartSpec: spec }}
      />
    );
  }
  const table = page?.status === "ready" ? displayTable(page) : undefined;
  if (
    receipt &&
    state &&
    (state.status === "queued" || state.status === "running")
  ) {
    const complete = receipt.attempts.filter(
      ({ state }) => state.status === "complete",
    ).length;
    return (
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
        role="status"
      >
        {t("notebook.reviewRunProgress", {
          seconds: formatters.formatNumber(
            Math.max(
              0,
              Math.floor(
                (run.dataUpdatedAt - Date.parse(receipt.startedAt)) / 1000,
              ),
            ),
          ),
          complete: formatters.formatNumber(complete),
          total: formatters.formatNumber(receipt.attempts.length),
        })}
        {threadId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void callAction(
                "cancel-notebook-run",
                { threadId, runId: receipt.runId },
                { keepalive: false },
              )
                .then(() => run.refetch())
                .catch(() => toast.error(t("notebook.reviewFailed")))
            }
          >
            {t("notebook.reviewCancelRun")}
          </Button>
        )}
      </div>
    );
  }
  if (state?.status === "failed" && attempt) {
    const reason =
      diagnostic.data?.status === "found" && !diagnostic.isError
        ? diagnostic.data.diagnostic?.provider
        : undefined;
    const traceId =
      diagnostic.data?.status === "found" ? diagnostic.data.traceId : undefined;
    return (
      <CellOutputView
        output={{
          type: "error",
          message: reason?.message ?? t("queryError.title"),
          detail: traceId ? t("notebook.reviewTrace", { traceId }) : null,
        }}
        queryError={cell?.contents.kind === "sql"}
        onFixWithAgent={
          onFix
            ? () => onFix(change.cellId, attempt.attempt.attemptId)
            : undefined
        }
      />
    );
  }
  if (table) return <CellOutputView output={table} />;
  if (
    run.isError ||
    result.isError ||
    result.data?.status === "denied" ||
    result.data?.status === "unreadable"
  )
    return (
      <p className="px-3 py-2 text-sm" role="alert">
        {t("notebook.resultPageFailed")}
      </p>
    );
  return null;
}

export function PendingCellDiff({
  change,
  index,
  title,
  review,
  onFix,
}: {
  change: PendingChange;
  index: number;
  title: string;
  review: NotebookReview;
  onFix?: ((cellId: string, attemptId: string) => void) | undefined;
}) {
  const t = useT();
  const formatters = useFormatters();
  const before = change.before?.cells.find(
    (cell) => cell.id === change.cellId,
  )?.contents;
  const after = change.after?.cells.find(
    (cell) => cell.id === change.cellId,
  )?.contents;
  const current = editableContent(before);
  const proposed = editableContent(after);
  return (
    <article
      className="nb-pending-cell"
      data-notebook-proposal={change.id}
      data-notebook-cell={change.cellId}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h3
          className="m-0 grow truncate text-sm font-medium"
          data-notebook-proposal-heading
          tabIndex={-1}
        >
          {title}
        </h3>
        <span className="text-xs text-muted-foreground">
          {t("notebook.reviewPosition", {
            index: formatters.formatNumber(index + 1),
            total: formatters.formatNumber(review.changes.length),
          })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="nb-pending-undo"
          disabled={review.busy}
          onClick={() => review.choose("undo", change.id)}
        >
          {t("notebook.pendingReviewUndo")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="nb-pending-confirm"
          disabled={review.busy || change.status === "conflicted"}
          onClick={() => review.choose("confirm", change.id)}
        >
          {t("notebook.pendingReviewConfirm")}
        </Button>
      </div>
      {change.kind === "move" && current === proposed ? (
        <p className="px-3 py-2 text-sm">{t("notebook.reviewMovedCell")}</p>
      ) : after?.kind === "chart" ? null : current === undefined &&
        proposed === undefined ? (
        <PendingSettingsDiff before={before} after={after} />
      ) : change.kind === "insert" || change.kind === "delete" ? (
        <div
          role="group"
          aria-label={t(
            change.kind === "insert"
              ? "notebook.reviewProposed"
              : "notebook.reviewCurrent",
          )}
        >
          <ReviewContent
            contents={after ?? before}
            prefix={change.kind === "insert" ? "added" : "removed"}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="min-w-0">
            <p className="px-3 pt-2 text-xs text-muted-foreground">
              {t("notebook.reviewCurrent")}
            </p>
            <ReviewContent contents={before} />
          </div>
          <div className="min-w-0">
            <p className="px-3 pt-2 text-xs text-muted-foreground">
              {t("notebook.reviewProposed")}
            </p>
            <ReviewContent contents={after} />
          </div>
        </div>
      )}
      {change.kind !== "delete" && (
        <PendingOutput
          key={review.page?.overlayRevision}
          change={change}
          review={review}
          onFix={onFix}
          before={before}
        />
      )}
    </article>
  );
}
