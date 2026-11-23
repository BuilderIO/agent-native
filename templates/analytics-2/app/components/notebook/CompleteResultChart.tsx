import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChartSpec } from "@/lib/model/contracts";

import { migrateChartSpec } from "../../../shared/chart-visualization-config";
import type {
  ChartTransformResult,
  NotebookTransform,
  VisualizationDrillOutput,
} from "../../../shared/visualization-contracts";
import { CellOutputView } from "./CellOutputView";
import {
  chartAggregationFor,
  chartBucketFormatter,
  chartTimeUnitFor,
  type ChartDataframe,
} from "./chart-config";
import { ChartConfigBody } from "./ChartConfigBody";
import { type ChartPoint } from "./ChartDrawing";
import type { VisualizationViewScope } from "./types";
import { VegaChart } from "./VegaChart";
import {
  useVisualizationSelection,
  VisualizationDrillPanel,
  type VisualizationDrillRequest,
} from "./VisualizationDrillPanel";

export type ChartResultContext = {
  projectId: string;
  cellId: string;
  versionId: string;
  scope?: VisualizationViewScope | undefined;
  sourceResultId?: string | null;
};

type ChartUpdate = {
  dataframe?: string | null;
  chartSpec?: Partial<ChartSpec>;
};

export function usesCompleteChart(
  spec: ChartSpec,
  dataframe: string | null,
  dataframes: readonly ChartDataframe[],
) {
  if (spec.mark === "funnel" && spec.funnelOutcomes) {
    return false;
  }
  if (spec.mark === "gantt" || spec.mark === "histogram") {
    const matched = dataframes.find((frame) =>
      spec.sourceCellId == null
        ? frame.name === dataframe
        : frame.cellId === spec.sourceCellId,
    );
    if (
      matched &&
      matched.rows.length > 0 &&
      (spec.version !== 3 ||
        spec.xField == null ||
        matched.columns.some((column) => column.name === spec.xField))
    ) {
      return false;
    }
  }
  if (spec.version === 3) return true;
  if (dataframe?.trimStart().startsWith("[")) return false;
  const matches = dataframes.filter((frame) =>
    spec.sourceCellId == null
      ? frame.name === dataframe
      : frame.cellId === spec.sourceCellId,
  );
  return matches.length === 1 && matches[0]?.resultId !== undefined;
}

function useCompleteChart(
  context: ChartResultContext,
  spec: ChartSpec,
  dataframe: string | null,
  dataframes: readonly ChartDataframe[],
) {
  const resultVersions = dataframes.flatMap((frame) =>
    frame.resultId === undefined
      ? []
      : [[frame.cellId, frame.resultId, frame.name]],
  );
  const sourceResultId =
    context.sourceResultId ??
    dataframes.find((frame) =>
      spec.sourceCellId == null
        ? frame.name === dataframe
        : frame.cellId === spec.sourceCellId,
    )?.resultId;
  const query = useActionQuery<NotebookTransform>(
    "get-notebook-transform",
    {
      projectId: context.projectId,
      cellId: context.cellId,
      mode: "chart",
      ...(context.scope ?? { expectedVersionId: context.versionId }),
      ...(spec.revision === undefined
        ? {}
        : { expectedConfigRevision: spec.revision }),
    },
    {
      queryKeyScope: context.scope ? [sourceResultId] : resultVersions,
      retry: false,
    },
  );
  const projection = query.isError ? undefined : query.data;
  const sources = projection?.sources ?? [];
  const matches = sources.filter(({ binding, name }) =>
    spec.sourceCellId
      ? binding.cellId === spec.sourceCellId &&
        (!spec.sourceExportId || binding.exportId === spec.sourceExportId)
      : name === dataframe,
  );
  const source = matches.length === 1 ? matches[0] : undefined;
  const resolved = source
    ? migrateChartSpec(spec, source.binding, source.fields)
    : null;
  const migrated = resolved === spec ? null : resolved;
  return { query, projection, sources, source, migrated };
}

export function CompleteChartEditor({
  context,
  spec,
  dataframe,
  dataframes,
  disabled,
  onChange,
}: {
  context: ChartResultContext;
  spec: ChartSpec;
  dataframe: string | null;
  dataframes: readonly ChartDataframe[];
  disabled: boolean;
  onChange?: ((next: ChartUpdate) => void) | undefined;
}) {
  const { query, projection, sources, source, migrated } = useCompleteChart(
    context,
    spec,
    dataframe,
    dataframes,
  );
  const adoption = useRef<string | null>(null);
  useEffect(() => {
    if (!migrated || !onChange || disabled) return;
    const key = JSON.stringify([context.cellId, context.versionId, migrated]);
    if (adoption.current === key) return;
    adoption.current = key;
    const { title: _title, ...chartSpec } = migrated;
    onChange({ chartSpec });
  }, [context.cellId, context.versionId, disabled, migrated, onChange]);

  const displaySpec = migrated ?? spec;
  const repair = [
    displaySpec.xField,
    displaySpec.yField,
    displaySpec.seriesField,
    displaySpec.secondaryYField ?? null,
    displaySpec.endField ?? null,
  ].find(
    (id) =>
      id !== null && !source?.fields.some(({ fieldId }) => fieldId === id),
  );
  const missingLabel =
    repair == null ? undefined : (spec.fieldLabels?.[repair] ?? repair);
  function save(next: ChartUpdate) {
    const patch = { ...next.chartSpec };
    const replacingSource = patch.sourceExportId !== undefined;
    if (displaySpec.version !== 3 && !replacingSource) {
      onChange?.(next);
      return;
    }
    const nextSource = replacingSource
      ? sources.find(
          ({ binding }) =>
            binding.cellId === patch.sourceCellId &&
            binding.exportId === patch.sourceExportId,
        )
      : source;
    if (replacingSource && source && nextSource) {
      const replacementFields = nextSource.fields;
      const priorFields = source.fields;
      function compatible(fieldId: string | null) {
        const previous = priorFields.find((field) => field.fieldId === fieldId);
        if (!previous) return null;
        const matches = replacementFields.filter(
          (field) =>
            field.name === previous.name && field.type === previous.type,
        );
        return matches.length === 1 ? (matches[0]?.fieldId ?? null) : null;
      }
      patch.xField = compatible(displaySpec.xField);
      patch.yField = compatible(displaySpec.yField);
      patch.yFields = (displaySpec.yFields ?? [])
        .map(compatible)
        .filter((id) => id !== null);
      patch.seriesField = compatible(displaySpec.seriesField);
      if (displaySpec.secondaryYField !== undefined) {
        patch.secondaryYField = compatible(displaySpec.secondaryYField);
      }
      if (displaySpec.endField !== undefined) {
        patch.endField = compatible(displaySpec.endField);
      }
      patch.countRecords = displaySpec.countRecords ?? false;
      if (patch.yField || patch.yFields.length)
        patch.yAggregation = displaySpec.yAggregation;
    }
    const chartSpec = { ...displaySpec, ...patch };
    const fields = [
      chartSpec.xField,
      chartSpec.yField,
      chartSpec.seriesField,
      chartSpec.secondaryYField ?? null,
      chartSpec.endField ?? null,
      ...(chartSpec.yFields ?? []),
    ];
    chartSpec.fieldLabels = Object.fromEntries(
      fields.flatMap((fieldId) => {
        if (fieldId == null) return [];
        const label =
          nextSource?.fields.find((field) => field.fieldId === fieldId)?.name ??
          chartSpec.fieldLabels?.[fieldId];
        return label === undefined ? [] : [[fieldId, label]];
      }),
    );
    onChange?.({
      ...next,
      chartSpec: {
        ...patch,
        version: 3,
        fieldLabels: chartSpec.fieldLabels,
      },
    });
  }
  return (
    <ChartConfigBody
      spec={displaySpec}
      dataframe={source?.name ?? dataframe}
      dataframes={sources.map(({ binding, name, fields }) => ({
        name,
        cellId: binding.cellId,
        exportId: binding.exportId,
        columns: fields.map(({ fieldId, name, type }) => ({
          name: fieldId,
          label: name,
          type,
        })),
        rows: [],
      }))}
      disabled={disabled || query.isPending}
      onChange={onChange && save}
      renderResult={(table) => (
        <CompleteChartOutput
          context={context}
          spec={displaySpec}
          result={projection?.result}
          error={query.error}
          pending={query.isPending}
          retry={() => void query.refetch()}
          table={table}
          missingLabel={missingLabel}
          onChange={disabled || !onChange ? undefined : save}
        />
      )}
    />
  );
}

export function CompleteChartTile({
  context,
  spec,
  dataframe,
  dataframes,
  missingSourceFallback,
  onMarkClick,
}: {
  context: ChartResultContext;
  spec: ChartSpec;
  dataframe: string | null;
  dataframes: readonly ChartDataframe[];
  missingSourceFallback?: ReactNode;
  onMarkClick?: ((mark: { x: string; series: string }) => void) | undefined;
}) {
  const { query, projection, migrated } = useCompleteChart(
    context,
    spec,
    dataframe,
    dataframes,
  );
  const result = projection?.result;
  if (
    missingSourceFallback &&
    ((result?.status === "stale" && result.reason === "result_superseded") ||
      (result?.status === "unconfigured" && !spec.sourceCellId && !dataframe))
  )
    return missingSourceFallback;
  return (
    <CompleteChartOutput
      context={context}
      spec={migrated ?? spec}
      result={result}
      error={query.error}
      pending={query.isPending}
      retry={() => void query.refetch()}
      onMarkClick={onMarkClick}
    />
  );
}

function CompleteChartOutput({
  context,
  result,
  error,
  spec,
  pending,
  retry,
  table = false,
  missingLabel,
  onChange,
  onMarkClick,
}: {
  context: ChartResultContext;
  result: NotebookTransform["result"] | undefined;
  error?: unknown;
  spec: ChartSpec;
  pending: boolean;
  retry: () => void;
  table?: boolean;
  missingLabel?: string | undefined;
  onChange?: ((next: ChartUpdate) => void) | undefined;
  onMarkClick?: ((mark: { x: string; series: string }) => void) | undefined;
}) {
  const t = useT();
  const isFailureFallback =
    !pending &&
    result?.status !== "unconfigured" &&
    result?.status !== "empty" &&
    !(
      result?.status === "ready" &&
      "kind" in result &&
      result.kind === "chart"
    ) &&
    result?.status !== "denied" &&
    !(result?.status === "blocked" && result.reason === "result_incomplete") &&
    !(
      result?.status === "blocked" &&
      result.reason === "visualization_binding_invalid" &&
      Boolean(missingLabel)
    );
  const failureStatus = result?.status ?? null;
  const failureReason = result && "reason" in result ? result.reason : null;
  useEffect(() => {
    if (!isFailureFallback || failureStatus === "stale") return;
    console.error("[CompleteResultChart] failed to update chart", {
      projectId: context.projectId,
      cellId: context.cellId,
      versionId: context.versionId,
      status: failureStatus,
      reason: failureReason,
      error: error ?? null,
    });
  }, [
    isFailureFallback,
    context.projectId,
    context.cellId,
    context.versionId,
    failureStatus,
    failureReason,
    error,
  ]);
  if (pending) {
    return (
      <div
        className="flex h-[260px] w-full flex-col items-center justify-center gap-2"
        role="status"
        aria-label={t("chartData.loading")}
      >
        <p className="nb-side-panel-note">{t("publishedApp.loadingChart")}</p>
        <Skeleton className="h-[180px] w-full" />
      </div>
    );
  }
  if (result?.status === "unconfigured") {
    return (
      <p className="nb-side-panel-note" role="status">
        {t(
          spec.sourceCellId
            ? "chartData.chooseAxes"
            : "chartData.sourceUnavailable",
        )}
      </p>
    );
  }
  if (result?.status === "empty") {
    return (
      <p className="nb-side-panel-note" role="status">
        <span>{t("chartData.noData")}</span>
        {" · "}
        <span>{t("queryPaging.rows", { count: 0, formattedCount: 0 })}</span>
      </p>
    );
  }
  if (
    result?.status === "ready" &&
    "kind" in result &&
    result.kind === "chart"
  ) {
    return (
      <ChartResult
        key={result.visualizationResultId}
        context={context}
        result={result}
        spec={spec}
        table={table}
        onChange={onChange}
        onMarkClick={onMarkClick}
      />
    );
  }
  const message =
    result?.status === "denied"
      ? "chartData.denied"
      : result?.status === "blocked" && result.reason === "result_incomplete"
        ? "chartData.incomplete"
        : result?.status === "blocked" &&
            result.reason === "visualization_binding_invalid" &&
            missingLabel
          ? "chartData.invalidBinding"
          : "chartData.failed";
  return (
    <div className="nb-side-panel-error" role="alert">
      {message === "chartData.invalidBinding"
        ? t(message, { field: missingLabel ?? "" })
        : t(message)}
      {message === "chartData.failed" ? (
        <Button size="sm" variant="ghost" onClick={retry}>
          {t("editorPreferences.retry")}
        </Button>
      ) : null}
    </div>
  );
}

const CALENDAR_DAY_MS = 86_400_000;
const MAX_CALENDAR_GAP_FILL_DAYS = 3660;

export function shapeCompleteChartRows({
  resultRows,
  timeUnit,
  aggregation,
  grouped,
  seriesCount,
  seriesIndices,
}: {
  resultRows: ChartTransformResult["rows"];
  timeUnit: ReturnType<typeof chartTimeUnitFor>;
  aggregation: ReturnType<typeof chartAggregationFor>;
  grouped: boolean;
  seriesCount: number;
  seriesIndices: Map<ChartTransformResult["categories"][number], number>;
}) {
  const rowIndices = new Map<
    ChartTransformResult["rows"][number]["x"],
    number
  >();
  const rows: Array<Array<string | number | boolean | null>> = [];
  const points: Array<ChartPoint & { selectionId?: string }> = [];
  for (const entry of resultRows) {
    const { x, series: color, value, selectionId } = entry;
    const date =
      timeUnit === null || x === null
        ? null
        : typeof x === "number"
          ? x
          : Date.parse(String(x));
    if (timeUnit !== null && (date === null || !Number.isFinite(date)))
      continue;
    let rowIndex = aggregation === "none" ? undefined : rowIndices.get(x);
    if (rowIndex === undefined) {
      rowIndex = rows.length;
      rowIndices.set(x, rowIndex);
      rows.push([date ?? x]);
    }
    const seriesIndex = seriesIndices.get(grouped ? color : null);
    if (value !== null && seriesIndex !== undefined)
      points.push({ rowIndex, seriesIndex, value, selectionId });
  }

  let finalRows = rows;
  let finalPoints = points;

  if (
    timeUnit === "day" &&
    aggregation !== "none" &&
    rows.length > 1 &&
    rows.every((row) => typeof row[0] === "number" && Number.isFinite(row[0]))
  ) {
    const existingByDay = new Map<number, number>();
    let minDay = Infinity;
    let maxDay = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const dayMs =
        Math.floor((rows[i]![0] as number) / CALENDAR_DAY_MS) * CALENDAR_DAY_MS;
      if (!existingByDay.has(dayMs)) existingByDay.set(dayMs, i);
      if (dayMs < minDay) minDay = dayMs;
      if (dayMs > maxDay) maxDay = dayMs;
    }
    const spanDays = Math.round((maxDay - minDay) / CALENDAR_DAY_MS);
    if (spanDays > 0 && spanDays <= MAX_CALENDAR_GAP_FILL_DAYS) {
      const filledRows: Array<Array<string | number | boolean | null>> = [];
      const rowRemap = new Map<number, number>();
      const missingDays = new Set<number>();
      for (let dayMs = minDay; dayMs <= maxDay; dayMs += CALENDAR_DAY_MS) {
        const oldIndex = existingByDay.get(dayMs);
        const newIndex = filledRows.length;
        if (oldIndex !== undefined) {
          rowRemap.set(oldIndex, newIndex);
          filledRows.push(rows[oldIndex]!);
        } else {
          missingDays.add(newIndex);
          filledRows.push([dayMs]);
        }
      }
      const remappedPoints: Array<ChartPoint & { selectionId?: string }> = [];
      for (const point of points) {
        const mappedRow = rowRemap.get(point.rowIndex);
        if (mappedRow !== undefined) {
          remappedPoints.push({ ...point, rowIndex: mappedRow });
        }
      }
      for (const rowIndex of missingDays) {
        for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
          remappedPoints.push({ rowIndex, seriesIndex, value: 0 });
        }
      }
      finalRows = filledRows;
      finalPoints = remappedPoints;
    }
  }

  if (
    grouped &&
    aggregation !== "none" &&
    finalRows.length > 1 &&
    seriesCount > 1
  ) {
    const present = new Set(
      finalPoints.map((point) => `${point.rowIndex}\0${point.seriesIndex}`),
    );
    for (let rowIndex = 0; rowIndex < finalRows.length; rowIndex++) {
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
        if (!present.has(`${rowIndex}\0${seriesIndex}`)) {
          finalPoints.push({ rowIndex, seriesIndex, value: 0 });
        }
      }
    }
  }

  return { rows: finalRows, points: finalPoints };
}

function ChartResult({
  context,
  result,
  spec,
  table,
  onChange,
  onMarkClick,
}: {
  context: ChartResultContext;
  result: ChartTransformResult;
  spec: ChartSpec;
  table: boolean;
  onChange?: ((next: ChartUpdate) => void) | undefined;
  onMarkClick?: ((mark: { x: string; series: string }) => void) | undefined;
}) {
  const t = useT();
  const locale = useReaderLocale();
  const [selection, setSelection] = useState<string>();
  const [drill, setDrill] = useState<VisualizationDrillRequest>();
  const [changing, setChanging] = useState(false);
  const [failed, setFailed] = useState(false);
  const mark = useRef<SVGElement | null>(null);
  const toolbar = useRef<HTMLDivElement | null>(null);
  const pendingEdit = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pendingEdit.current?.abort();
      pendingEdit.current = null;
    },
    [],
  );
  useEffect(() => {
    if (selection && !drill) toolbar.current?.focus();
  }, [selection, drill]);
  useVisualizationSelection(
    selection && result.visualizationResultId
      ? {
          projectId: context.projectId,
          cellId: context.cellId,
          visualizationResultId: result.visualizationResultId,
          view: table ? "table" : "chart",
          selectionId: selection,
          ...(drill ? { drillId: drill.requestId } : {}),
        }
      : undefined,
  );

  const xField = result.source.fields.find(
    ({ fieldId }) => fieldId === spec.xField,
  );
  const measureField = result.source.fields.find(
    ({ fieldId }) => fieldId === spec.yField,
  );
  const colorField = result.source.fields.find(
    ({ fieldId }) => fieldId === spec.seriesField,
  );
  const multiMeasure = (spec.yFields?.length ?? 0) > 1;
  const grouped = Boolean(colorField) || multiMeasure;
  const timeUnit = chartTimeUnitFor(spec, xField?.type);
  const aggregation = spec.countRecords
    ? "count"
    : chartAggregationFor(
        spec,
        ["number", "decimal", "integer"].includes(measureField?.type ?? ""),
      );
  const measureLabel = spec.countRecords
    ? t("chartData.countRecords")
    : (measureField?.name ?? "");
  const totals = new Map<ChartTransformResult["categories"][number], number>();
  for (const { series, value } of result.rows)
    totals.set(series, (totals.get(series) ?? 0) + (value ?? 0));
  const configuredOrder = new Map(
    (
      spec.seriesOrder ??
      (multiMeasure
        ? (spec.yFields ?? []).map(
            (id) =>
              result.source.fields.find((field) => field.fieldId === id)
                ?.name ?? id,
          )
        : undefined)
    )?.map((value, index) => [value, index]),
  );
  const series = grouped
    ? [...totals.keys()].sort(
        (a, b) =>
          (configuredOrder.get(String(a)) ?? configuredOrder.size) -
            (configuredOrder.get(String(b)) ?? configuredOrder.size) ||
          (totals.get(a) ?? 0) - (totals.get(b) ?? 0),
      )
    : [null];
  const seriesIndices = new Map(series.map((value, index) => [value, index]));
  const domain = new Map(
    result.categories.map((value, index) => [value, index]),
  );
  const { rows, points } = shapeCompleteChartRows({
    resultRows: result.rows,
    timeUnit,
    aggregation,
    grouped,
    seriesCount: series.length,
    seriesIndices,
  });
  const openMark = (point: ChartPoint, target: SVGElement) => {
    const id = "selectionId" in point ? point.selectionId : null;
    if (typeof id !== "string") return;
    cancelFilterEdit();
    mark.current = target;
    setSelection(id);
    setFailed(false);
  };
  const request = (
    mode: VisualizationDrillRequest["mode"],
    nextFieldId?: string,
  ) => {
    if (!selection || !result.visualizationResultId) return;
    setDrill({
      projectId: context.projectId,
      cellId: context.cellId,
      ...context.scope,
      visualizationResultId: result.visualizationResultId,
      selectionId: selection,
      requestId: crypto.randomUUID(),
      mode,
      ...(nextFieldId ? { nextFieldId } : {}),
    });
  };
  const filterMark = async (mode: "keep" | "remove") => {
    if (
      !onChange ||
      !selection ||
      !result.visualizationResultId ||
      pendingEdit.current
    )
      return;
    const controller = new AbortController();
    pendingEdit.current = controller;
    setChanging(true);
    setFailed(false);
    try {
      const edit = await callAction<VisualizationDrillOutput>(
        "open-notebook-visualization-drill",
        {
          projectId: context.projectId,
          cellId: context.cellId,
          visualizationResultId: result.visualizationResultId,
          selectionId: selection,
          requestId: crypto.randomUUID(),
          mode,
        },
        { method: "POST", signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (
        (edit.status !== "ready" && edit.status !== "empty") ||
        !edit.predicate?.length
      ) {
        console.error("[CompleteResultChart] chart mark filter rejected", {
          projectId: context.projectId,
          cellId: context.cellId,
          mode,
          status: edit.status,
          reason: "reason" in edit ? edit.reason : null,
        });
        setFailed(true);
        return;
      }
      onChange({
        chartSpec:
          mode === "keep"
            ? { filters: [...(spec.filters ?? []), ...edit.predicate] }
            : {
                excludedMarks: [...(spec.excludedMarks ?? []), edit.predicate],
              },
      });
      closeSelection();
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[CompleteResultChart] failed to filter chart mark", {
          projectId: context.projectId,
          cellId: context.cellId,
          mode,
          error,
        });
        setFailed(true);
      }
    } finally {
      if (pendingEdit.current === controller) {
        pendingEdit.current = null;
        setChanging(false);
      }
    }
  };
  function cancelFilterEdit() {
    if (pendingEdit.current) {
      pendingEdit.current.abort();
      pendingEdit.current = null;
      setChanging(false);
    }
  }
  function closeSelection() {
    cancelFilterEdit();
    setSelection(undefined);
    setDrill(undefined);
    setFailed(false);
    mark.current?.focus();
  }

  const colorLabel = (value: ChartTransformResult["categories"][number]) =>
    value === null ? t("pivot.nullCategory") : String(value);
  const drillFields = result.source.fields.filter(
    ({ fieldId, type }) =>
      fieldId !== spec.yField &&
      !spec.yFields?.includes(fieldId) &&
      fieldId !== spec.seriesField &&
      (fieldId !== spec.xField || (timeUnit !== null && timeUnit !== "none")) &&
      !["list", "struct", "json", "binary"].includes(type),
  );
  const columns = [
    xField?.name ?? "",
    ...(grouped ? series.map(colorLabel) : [measureLabel]),
  ];
  return (
    <>
      {result.capped ? (
        <p className="nb-side-panel-note" role="status">
          {t("pivot.groupLimit")}
        </p>
      ) : null}
      {table ? (
        <CellOutputView
          key={result.visualizationResultId}
          columnFormats={[
            timeUnit !== null && timeUnit !== "none"
              ? chartBucketFormatter(timeUnit, locale, t)
              : null,
            ...(grouped ? [null] : []),
            spec.yFormatter ?? "number",
          ]}
          output={{
            type: "table",
            columns: [
              {
                name: xField?.name ?? "",
                type: timeUnit === null ? "string" : "datetime",
              },
              ...(grouped
                ? [
                    {
                      name:
                        colorField?.name ?? t("notebook.additionalMeasures"),
                      type: "string" as const,
                    },
                  ]
                : []),
              {
                name: multiMeasure ? t("notebook.sankey.value") : measureLabel,
                type: "number",
              },
            ],
            rows: result.rows.map(({ x, series, value }) => [
              x,
              ...(grouped ? [series] : []),
              value,
            ]),
            rowCount: result.rows.length,
            truncated: false,
          }}
        />
      ) : (
        <VegaChart
          columns={columns}
          rows={rows}
          points={points}
          encoding={{
            timeUnit,
            aggregation,
            colorField: colorField?.name ?? null,
            measures: series.map((colorValue) => ({
              field: multiMeasure
                ? colorLabel(colorValue)
                : (measureField?.name ?? ""),
              colorValue,
            })),
            colorIndices: series.map(
              (category, index) => domain.get(category) ?? index,
            ),
            countRecords: spec.countRecords === true,
          }}
          mark={spec.mark}
          orientation={spec.orientation}
          stackMode={spec.stackMode}
          binCount={spec.binCount}
          funnelOutcomes={spec.funnelOutcomes}
          stacked={spec.stacked}
          colors={spec.colors}
          yFormatter={spec.yFormatter}
          seriesLabels={spec.seriesLabels}
          legend={spec.legend}
          tooltipChannels={spec.tooltipChannels}
          title={spec.title}
          onMarkClick={onMarkClick}
          onMarkSelect={onMarkClick ? undefined : openMark}
        />
      )}
      {onChange && (spec.filters?.length || spec.excludedMarks?.length) ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange({ chartSpec: { filters: [], excludedMarks: [] } })
          }
        >
          {t("chartData.clearFilters")}
        </Button>
      ) : null}
      {selection && !drill ? (
        <div
          ref={toolbar}
          tabIndex={-1}
          className="flex flex-wrap gap-1"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            closeSelection();
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!drillFields.length}
              >
                {t("pivot.drillDown")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {drillFields.map(({ fieldId, name }) => (
                <DropdownMenuItem
                  key={fieldId}
                  onSelect={() => request("drill-down", fieldId)}
                >
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {onChange ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={changing}
                onClick={() => void filterMark("keep")}
              >
                {t("chartData.keep")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={changing}
                onClick={() => void filterMark("remove")}
              >
                {t("chartData.remove")}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => request("view-data")}
          >
            {t("pivot.viewData")}
          </Button>
          {failed ? <p role="alert">{t("chartData.failed")}</p> : null}
        </div>
      ) : null}
      {drill ? (
        <VisualizationDrillPanel request={drill} onClose={closeSelection} />
      ) : null}
    </>
  );
}
