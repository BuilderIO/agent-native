import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsContent } from "@/components/ui/tabs";
import type { Cell } from "@/lib/model/contracts";

import type { PivotConfigV2, PivotScalar } from "../../../shared/pivot-config";
import { PROJECT_QUERY_PAGE_SIZE } from "../../../shared/project-query-page";
import type { PivotTransformResult } from "../../../shared/visualization-contracts";
import type { VisualizationViewScope } from "./types";
import {
  VisualizationDrillPanel,
  VisualizationResultPager,
  VisualizationResultRows,
  useVisualizationSelection,
  type VisualizationDrillRequest,
} from "./VisualizationDrillPanel";

type Drill = { request: VisualizationDrillRequest; trigger: HTMLButtonElement };

function pivotFormatClass(
  rules: PivotConfigV2["formatRules"],
  measureId: string | undefined,
  value: PivotScalar,
) {
  if (typeof value !== "number") return "";
  const matching = rules?.some((rule) => {
    if (rule.measureId !== measureId) return false;
    switch (rule.op) {
      case "eq":
        return value === rule.value;
      case "neq":
        return value !== rule.value;
      case "gt":
        return value > rule.value;
      case "gte":
        return value >= rule.value;
      case "lt":
        return value < rule.value;
      case "lte":
        return value <= rule.value;
    }
  });
  return matching ? "bg-destructive/15 text-destructive" : "";
}

function movePivotFocus(
  event: KeyboardEvent<HTMLButtonElement>,
  row: number,
  column: number,
) {
  const { key, currentTarget } = event;
  if (
    key !== "ArrowLeft" &&
    key !== "ArrowRight" &&
    key !== "ArrowUp" &&
    key !== "ArrowDown"
  )
    return;
  const table = currentTarget.closest("table");
  if (!table) return;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const backwards = key === "ArrowLeft" || key === "ArrowUp";
  const current = horizontal ? column : row;
  const buttons = Array.from(
    table.querySelectorAll<HTMLButtonElement>("button[data-pivot-value]"),
  );
  if (backwards) buttons.reverse();
  const target = buttons.find((button) => {
    const sameAxis = horizontal
      ? Number(button.dataset.pivotRow) === row
      : Number(button.dataset.pivotColumn) === column;
    const position = Number(
      horizontal ? button.dataset.pivotColumn : button.dataset.pivotRow,
    );
    return sameAxis && (backwards ? position < current : position > current);
  });
  event.stopPropagation();
  event.preventDefault();
  target?.focus();
}

function PivotValueMenu({
  value,
  label,
  nextFields,
  row,
  column,
  tabIndex,
  onFocus,
  onOpen,
}: {
  value: string;
  label: string;
  nextFields: readonly { fieldId: string; name: string }[];
  row: number;
  column: number;
  tabIndex: number;
  onFocus: () => void;
  onOpen: (
    trigger: HTMLButtonElement,
    mode: VisualizationDrillRequest["mode"],
    nextFieldId?: string,
  ) => void;
}) {
  const t = useT();
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDrill = useRef(false);
  function open(mode: VisualizationDrillRequest["mode"], nextFieldId?: string) {
    if (!trigger.current) return;
    openingDrill.current = true;
    onOpen(trigger.current, mode, nextFieldId);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-end px-1 font-inherit"
          data-pivot-value=""
          data-pivot-row={row}
          data-pivot-column={column}
          tabIndex={tabIndex}
          aria-label={label}
          onFocus={onFocus}
          onKeyDown={(event) => movePivotFocus(event, row, column)}
        >
          {value}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (openingDrill.current) event.preventDefault();
          openingDrill.current = false;
        }}
      >
        {nextFields.length ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t("pivot.drillDown")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {nextFields.map(({ fieldId, name }) => (
                <DropdownMenuItem
                  key={fieldId}
                  onSelect={() => open("drill-down", fieldId)}
                >
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem disabled title={t("pivot.noDrillFields")}>
            {t("pivot.drillDown")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => open("view-data")}>
          {t("pivot.viewData")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void writeClipboardText(value).then((copied) => {
              if (copied) toast.success(t("notebook.dataCopied"));
              else toast.error(t("notebook.dataCopyFailed"));
            })
          }
        >
          {t("share.copy")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PivotOutput({
  cell,
  scope,
  result,
  config,
  view,
  onRowPage,
  onColumnPage,
}: {
  cell: Cell;
  scope?: VisualizationViewScope | undefined;
  result: PivotTransformResult;
  config: PivotConfigV2;
  view: "pivot" | "table";
  onRowPage: (page: number) => void;
  onColumnPage: (page: number) => void;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const tableId = useId();
  const [page, setPage] = useState(1);
  const [drill, setDrill] = useState<Drill>();
  const [activeCell, setActiveCell] = useState<{
    key: string;
    selectionId: string;
  }>();
  const { visualizationResultId } = result;
  useVisualizationSelection(
    visualizationResultId && (activeCell || view === "table")
      ? {
          projectId: cell.projectId,
          cellId: cell.id,
          visualizationResultId,
          view,
          drillId: drill?.request.requestId,
          selectionId: activeCell?.selectionId,
        }
      : undefined,
  );

  const { fields } = result.source;
  const fieldNames = new Map(
    fields.map((field) => [String(field.fieldId), field.name]),
  );
  const fieldName = (fieldId: string) => fieldNames.get(fieldId) ?? fieldId;
  const axes = [...config.rows, ...config.columns];
  const nextFields = fields.filter(
    ({ fieldId, type }) =>
      !axes.includes(fieldId) &&
      !["binary", "list", "struct", "json"].includes(type),
  );
  const measures = config.values.map(({ fieldId, aggregation, measureId }) => ({
    id: measureId,
    label: t("pivot.measureLabel", {
      aggregation: t(`pivot.aggregations.${aggregation}`),
      field: fieldName(fieldId),
    }),
  }));
  const count = measures.length;
  const asRows =
    (result.orientation ?? config.orientation) === "rows" && count > 1;
  const totalLabel = t("visualization.charts.totalLabel");
  const axisLabel = (key: PivotScalar[] | null, subtotal: boolean) => {
    if (key === null) return totalLabel;
    const label = key
      .map((value) =>
        value === null
          ? t("pivot.nullCategory")
          : typeof value === "number"
            ? formatNumber(value)
            : String(value),
      )
      .join(" / ");
    return subtotal ? t("pivot.subtotal", { label }) : label;
  };
  const columnAxes = result.columns.map((key, index) => {
    const subtotal = result.columnSubtotals?.includes(index) === true;
    return {
      id: JSON.stringify([key, subtotal]),
      label: axisLabel(key, subtotal),
      total: key === null || subtotal,
    };
  });
  const rowTitle = config.rows.map(fieldName).join(" / ");
  const columnTitle = config.columns.map(fieldName).join(" / ");
  const rowPositions = result.rows.flatMap((row, groupIndex) =>
    asRows
      ? measures.map((_, measure) => ({ row, groupIndex, measure }))
      : [{ row, groupIndex, measure: 0 }],
  );
  const visibleColumns = columnAxes.flatMap((axis, index) =>
    asRows
      ? [{ axis, columnIndex: index, measureIndex: 0 }]
      : measures.map((_, measureIndex) => ({
          axis,
          columnIndex: index,
          measureIndex,
        })),
  );
  function closeDrill() {
    if (!drill) return;
    const { trigger } = drill;
    setDrill(undefined);
    requestAnimationFrame(() => trigger.focus());
  }
  const firstRow = result.rows.findIndex(({ values }) =>
    values.some((entry) => entry.kind === "value" && entry.selectionId),
  );
  const firstValue =
    result.rows[firstRow]?.values.findIndex(
      (entry) => entry.kind === "value" && entry.selectionId,
    ) ?? -1;
  const firstCell = asRows
    ? `${firstRow * count + (firstValue % count)}:${Math.floor(firstValue / count)}`
    : `${firstRow}:${firstValue}`;

  return (
    <>
      {result.capped && (
        <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {t("pivot.groupLimit")}
        </p>
      )}
      <TabsContent value="pivot" className="m-0">
        <div
          hidden={drill?.request.mode === "drill-down"}
          className="max-w-full overflow-auto border-t"
          role="region"
          aria-label={t("pivot.label")}
          tabIndex={0}
        >
          <table className="w-max min-w-full text-sm">
            <thead className="border-b bg-muted text-start">
              <tr>
                <th
                  scope="col"
                  className="sticky start-0 max-w-40 truncate bg-muted px-3 py-2 text-start"
                  title={rowTitle}
                >
                  {rowTitle}
                </th>
                {asRows && (
                  <th scope="col" className="px-3 py-2 text-start">
                    {t("pivot.values")}
                  </th>
                )}
                {visibleColumns.map(({ axis, measureIndex }, column) => (
                  <th
                    key={`${axis.id}:${measures[measureIndex]?.id}`}
                    id={`${tableId}-column-${column}`}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-end font-semibold"
                  >
                    {axis.label ||
                      (asRows ? columnTitle : measures[measureIndex]?.label)}
                    {!asRows && count > 1 && axis.label && (
                      <span className="block text-xs font-normal">
                        {measures[measureIndex]?.label}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowPositions.map(({ row, groupIndex, measure }, rowIndex) => {
                const label = axisLabel(row.key, row.subtotal === true);
                const rowTotal = row.key === null || row.subtotal;
                const rowHeaderId = `${tableId}-row-${groupIndex}`;
                const measureHeaderId = `${tableId}-measure-${rowIndex}`;
                return (
                  <tr
                    key={JSON.stringify([row.key, row.subtotal, measure])}
                    className="border-b last:border-b-0"
                  >
                    {measure === 0 && (
                      <th
                        id={rowHeaderId}
                        scope="row"
                        rowSpan={asRows ? count : 1}
                        className={`sticky start-0 max-w-40 truncate bg-background px-3 py-2 text-start ${rowTotal ? "font-semibold" : "font-normal"}`}
                        title={label}
                      >
                        {label}
                      </th>
                    )}
                    {asRows && (
                      <th
                        id={measureHeaderId}
                        scope="row"
                        className="whitespace-nowrap px-3 py-2 text-start font-normal"
                      >
                        {measures[measure]?.label}
                      </th>
                    )}
                    {visibleColumns.map(
                      ({ axis, columnIndex, measureIndex }, column) => {
                        const offset =
                          columnIndex * count +
                          (asRows ? measure : measureIndex);
                        const entry = row.values[offset];
                        const value =
                          entry?.kind === "value" ? entry.value : null;
                        const display =
                          value === null ? "—" : formatNumber(value);
                        const selectionId =
                          entry?.kind === "value"
                            ? entry.selectionId
                            : undefined;
                        const missing = entry?.kind === "missing";
                        const key = `${rowIndex}:${column}`;
                        const measureId =
                          measures[asRows ? measure : measureIndex]?.id;
                        return (
                          <td
                            key={column}
                            headers={`${rowHeaderId} ${asRows ? `${measureHeaderId} ` : ""}${tableId}-column-${column}`}
                            className={`whitespace-nowrap px-3 py-1 text-end tabular-nums ${rowTotal || axis.total ? "font-semibold" : ""} ${pivotFormatClass(config.formatRules, measureId, value)}`}
                          >
                            {selectionId && visualizationResultId ? (
                              <PivotValueMenu
                                value={display}
                                label={[
                                  label,
                                  axis.label,
                                  measures[asRows ? measure : measureIndex]
                                    ?.label,
                                  value === null
                                    ? t("pivot.noAggregate")
                                    : display,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                                nextFields={nextFields}
                                row={rowIndex}
                                column={column}
                                tabIndex={
                                  (activeCell?.key ?? firstCell) === key
                                    ? 0
                                    : -1
                                }
                                onFocus={() =>
                                  setActiveCell({ key, selectionId })
                                }
                                onOpen={(trigger, mode, nextFieldId) =>
                                  setDrill({
                                    trigger,
                                    request: {
                                      projectId: cell.projectId,
                                      cellId: cell.id,
                                      ...scope,
                                      visualizationResultId,
                                      selectionId,
                                      mode,
                                      nextFieldId,
                                      requestId: crypto.randomUUID(),
                                    },
                                  })
                                }
                              />
                            ) : value === null ? (
                              <>
                                <span aria-hidden="true">—</span>
                                <span className="sr-only">
                                  {t(
                                    missing
                                      ? "pivot.noMatch"
                                      : "pivot.noAggregate",
                                  )}
                                </span>
                              </>
                            ) : (
                              display
                            )}
                          </td>
                        );
                      },
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {drill && (
          <VisualizationDrillPanel
            key={drill.request.requestId}
            request={drill.request}
            groupedRowHeaders
            onClose={closeDrill}
          />
        )}
      </TabsContent>
      <TabsContent value="table" className="m-0 border-t">
        {view === "table" && (
          <PivotFlatTable
            result={result}
            measures={measures}
            formatRules={config.formatRules}
            rowTitle={rowTitle}
            columnTitle={columnTitle}
            axisLabel={axisLabel}
            page={page}
            onPage={setPage}
          />
        )}
      </TabsContent>
      {drill?.request.mode !== "drill-down" && (
        <div className="flex flex-wrap">
          <PivotWindowPager
            axis="row"
            page={result.rowPage ?? 1}
            count={result.rowAxisCount ?? result.rows.length}
            size={50}
            onPage={onRowPage}
          />
          <PivotWindowPager
            axis="column"
            page={result.columnPage ?? 1}
            count={result.columnAxisCount ?? result.columns.length}
            size={100}
            onPage={onColumnPage}
          />
        </div>
      )}
    </>
  );
}

function PivotWindowPager({
  axis,
  page,
  count,
  size,
  onPage,
}: {
  axis: "row" | "column";
  page: number;
  count: number;
  size: number;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  if (count <= size) return null;
  const row = axis === "row";
  return (
    <div className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={page === 1}
        aria-label={t(row ? "pivot.previousRows" : "pivot.previousColumns")}
        onClick={() => onPage(page - 1)}
      >
        <IconChevronLeft
          size={14}
          className="rtl:rotate-180"
          aria-hidden="true"
        />
      </Button>
      <span role="status">
        {t(row ? "pivot.rowWindow" : "pivot.columnWindow", {
          first: formatNumber((page - 1) * size + 1),
          last: formatNumber(Math.min(page * size, count)),
          total: formatNumber(count),
        })}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={page * size >= count}
        aria-label={t(row ? "pivot.nextRows" : "pivot.nextColumns")}
        onClick={() => onPage(page + 1)}
      >
        <IconChevronRight
          size={14}
          className="rtl:rotate-180"
          aria-hidden="true"
        />
      </Button>
    </div>
  );
}

function PivotFlatTable({
  result,
  measures,
  formatRules,
  rowTitle,
  columnTitle,
  axisLabel,
  page,
  onPage,
}: {
  result: PivotTransformResult;
  measures: { id: string; label: string }[];
  formatRules: PivotConfigV2["formatRules"];
  rowTitle: string;
  columnTitle: string;
  axisLabel: (key: PivotScalar[] | null, subtotal: boolean) => string;
  page: number;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const axes = [rowTitle, columnTitle].filter(Boolean);
  const rows = result.rows.flatMap(({ key, subtotal, values }) =>
    result.columns.flatMap((column, index) => {
      const start = index * measures.length;
      const entries = values.slice(start, start + measures.length);
      if (entries.every(({ kind }) => kind === "missing")) return [];
      return [
        [
          ...(rowTitle ? [axisLabel(key, subtotal === true)] : []),
          ...(columnTitle
            ? [
                axisLabel(
                  column,
                  result.columnSubtotals?.includes(index) === true,
                ),
              ]
            : []),
          ...entries.map((entry) =>
            entry.kind === "value" ? entry.value : null,
          ),
        ],
      ];
    }),
  );
  const start = (page - 1) * PROJECT_QUERY_PAGE_SIZE;
  return (
    <>
      <VisualizationResultRows
        label={t("notebookInsert.table")}
        columns={[...axes, ...measures.map(({ label }) => label)]}
        rows={rows.slice(start, start + PROJECT_QUERY_PAGE_SIZE)}
        cellClassName={(value, column) =>
          pivotFormatClass(
            formatRules,
            measures[column - axes.length]?.id,
            value,
          )
        }
      />
      <VisualizationResultPager
        page={page}
        totalRows={rows.length}
        onPage={onPage}
      />
    </>
  );
}
