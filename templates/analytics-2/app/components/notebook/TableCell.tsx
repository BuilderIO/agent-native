import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import { Tooltip } from "@agent-native/toolkit/design-system";
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Cell } from "@/lib/model/contracts";
import { cn } from "@/lib/utils";

import type getProject from "../../../actions/get-project";
import { PROJECT_QUERY_PAGE_SIZE as PAGE_SIZE } from "../../../shared/project-query-page";
import type { TableConfig } from "../../../shared/table-visualization-config";
import type {
  VisualizationPageInput,
  VisualizationPageOutput,
} from "../../../shared/visualization-contracts";
import { mergeSavedCell } from "../workspace/merge-saved-cell";
import { formatPublishedValue } from "./CellOutputView";
import { csvFilename, resultCsv } from "./result-csv";
import {
  tableFilterText,
  tableRuleMatches,
  type TableColumn,
} from "./table-cell-display";
import {
  TableCellControls,
  TableColumnMenu,
  TableFilterMenu,
} from "./TableCellControls";
import type { VisualizationViewScope } from "./types";
import { isNumericResultColumn, resultColumnIcon } from "./utils";

type ProjectRead = Awaited<ReturnType<typeof getProject.run>>;
type TablePage = Extract<VisualizationPageOutput, { columns: unknown }>;

const ROW_NUMBER_WIDTH = 48;
const DEFAULT_COLUMN_WIDTH = 160;

function isTablePage(result: VisualizationPageOutput): result is TablePage {
  return result.status === "ready" || result.status === "empty";
}

function tableColumns(result: TablePage, config: TableConfig): TableColumn[] {
  const order = config.columnOrder ?? [];
  return result.columns
    .map((field, index) => {
      const settings = config.columns[field.fieldId];
      const choices =
        field.type === "string"
          ? [
              ...new Set(
                result.rows
                  .map((row) => row[index])
                  .filter(
                    (value): value is string =>
                      typeof value === "string" && value !== "",
                  ),
              ),
            ].sort()
          : [];
      return {
        field,
        index,
        label: settings?.label ?? field.name,
        settings,
        choices,
      };
    })
    .sort((left, right) => {
      const leftRank = order.indexOf(left.field.fieldId);
      const rightRank = order.indexOf(right.field.fieldId);
      return (
        (leftRank < 0 ? order.length : leftRank) -
        (rightRank < 0 ? order.length : rightRank)
      );
    });
}

export function TableCell({
  cell,
  config,
  canEdit,
  scope,
  sourceResultId,
}: {
  cell: Cell;
  config: TableConfig;
  canEdit: boolean;
  scope?: VisualizationViewScope | undefined;
  sourceResultId?: string | null;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const client = useQueryClient();
  const [navigation, setNavigation] = useState({
    revision: cell.updatedAt,
    page: 1,
  });
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const activeExport = useRef<AbortController | null>(null);
  const read: VisualizationPageInput = {
    projectId: cell.projectId,
    cellId: cell.id,
    kind: "table",
    page: navigation.revision === cell.updatedAt ? navigation.page : 1,
    ...(scope?.releaseId ? {} : { expectedUpdatedAt: cell.updatedAt }),
    ...scope,
  };
  const query = useActionQuery<VisualizationPageOutput>(
    "get-notebook-visualization-page",
    read,
    { queryKeyScope: [sourceResultId], retry: false },
  );
  const projectKey = ["action", "get-project", { projectId: cell.projectId }];
  const save = useActionMutation("save-project-cell", {
    beforeInvalidate: (saved, change) => {
      client.setQueryData<ProjectRead>(projectKey, (current) =>
        current
          ? {
              ...current,
              project: mergeSavedCell(
                current.project,
                saved.project,
                change.cellId,
                change.expectedUpdatedAt,
              ),
            }
          : current,
      );
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: projectKey });
    },
  });
  useEffect(() => () => activeExport.current?.abort(), []);
  const result = query.isError ? undefined : query.data;
  const ready = result && isTablePage(result) ? result : undefined;
  const pendingConfig =
    save.isPending && save.variables.contents.kind === "display-table"
      ? (save.variables.contents.tableConfig ?? config)
      : config;
  const columns = ready ? tableColumns(ready, pendingConfig) : [];

  function update(patch: Partial<TableConfig>) {
    if (!canEdit || save.isPending || cell.contents.kind !== "display-table")
      return;
    save.mutate({
      projectId: cell.projectId,
      cellId: cell.id,
      expectedUpdatedAt: cell.updatedAt,
      contents: { ...cell.contents, tableConfig: { ...config, ...patch } },
    });
  }

  async function download(result: TablePage) {
    if (activeExport.current) return;
    const controller = new AbortController();
    activeExport.current = controller;
    setExporting(true);
    setExportFailed(false);
    try {
      const visible = visibleColumns(columns);
      const names = visible.map(({ label }) => ({ name: label }));
      const header = resultCsv(names, []);
      const csv = [header];
      const lastPage = Math.max(1, Math.ceil(result.totalRows / PAGE_SIZE));
      for (let page = 1; page <= lastPage; page++) {
        const response = await callAction<VisualizationPageOutput>(
          "get-notebook-visualization-page",
          { ...read, page, resultId: result.resultId },
          { method: "GET", signal: controller.signal },
        );
        if (
          !isTablePage(response) ||
          response.resultId !== result.resultId ||
          response.page !== page ||
          response.totalRows !== result.totalRows ||
          response.rows.length !==
            Math.min(PAGE_SIZE, result.totalRows - (page - 1) * PAGE_SIZE)
        ) {
          throw new Error("Table export changed during pagination");
        }
        const rows = response.rows.map((row) =>
          visible.map(({ index }) => row[index] ?? null),
        );
        if (rows.length) {
          const pageCsv = resultCsv(names, rows);
          csv.push(pageCsv.slice(header.length));
        }
      }
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob(csv, { type: "text/csv;charset=utf-8" }),
      );
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = csvFilename(currentSource?.name);
        link.click();
        toast.success(t("notebook.csvDownloaded"));
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      if (!controller.signal.aborted) setExportFailed(true);
    } finally {
      if (!controller.signal.aborted) setExporting(false);
      activeExport.current = null;
    }
  }

  const message =
    query.isError || result?.status === "unreadable"
      ? "notebook.tableCell.readFailed"
      : result?.status === "denied"
        ? "notebook.tableCell.denied"
        : result?.status === "blocked"
          ? result.reason === "result_incomplete"
            ? "notebook.incomplete"
            : result.reason === "result_limit"
              ? "notebook.resultLimit"
              : "notebook.tableCell.bindingInvalid"
          : result?.status === "stale"
            ? "notebook.tableCell.stale"
            : undefined;
  const sources = result?.sources ?? [];
  const sourceKey = ({
    cellId,
    exportId,
  }: NonNullable<TableConfig["source"]>) => JSON.stringify([cellId, exportId]);
  const currentSource = sources.find(
    ({ binding }) =>
      binding.cellId === pendingConfig.source?.cellId &&
      binding.exportId === pendingConfig.source.exportId,
  );

  return (
    <div className="min-w-0 border-t border-border">
      {canEdit && (sources.length || !ready) ? (
        <div className="flex max-w-full flex-wrap items-center gap-2 px-2 py-1">
          <Select
            value={currentSource ? sourceKey(currentSource.binding) : ""}
            disabled={query.isPending || save.isPending}
            onValueChange={(value) => {
              const source = sources.find(
                ({ binding }) => sourceKey(binding) === value,
              );
              if (source) {
                update({
                  source: {
                    cellId: source.binding.cellId,
                    exportId: source.binding.exportId,
                  },
                  filters: [],
                  sort: null,
                  totals: {},
                  columns: {},
                  columnOrder: [],
                  formatRules: [],
                });
              }
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("notebook.tableCell.chooseSource")}
              className="max-w-full"
            >
              <SelectValue placeholder={t("notebook.tableCell.chooseSource")} />
            </SelectTrigger>
            <SelectContent>
              {sources.map(({ binding, name }) => (
                <SelectItem key={sourceKey(binding)} value={sourceKey(binding)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TableFilterMenu
            columns={columns}
            config={pendingConfig}
            update={update}
            disabled={save.isPending}
          />
        </div>
      ) : null}
      {save.isError ? (
        <p role="alert" className="px-2 py-1 text-sm text-destructive">
          {t("notebook.tableCell.saveFailed")}
        </p>
      ) : null}
      {query.isPending ? (
        <div
          role="status"
          aria-label={t("notebook.loadingResults")}
          className="space-y-2 p-2"
        >
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      ) : message ? (
        <div
          role="alert"
          className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground"
        >
          {t(message)}
          {query.isError ||
          result?.status === "unreadable" ||
          result?.status === "stale" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("editorPreferences.retry")}
            </Button>
          ) : null}
        </div>
      ) : ready ? (
        <>
          {pendingConfig.filters.length ? (
            <div
              aria-label={t("notebook.activeFilters")}
              className="flex flex-wrap gap-1 border-b border-border p-2"
            >
              {pendingConfig.filters.map((filter, index) => {
                const name =
                  columns.find(({ field }) => field.fieldId === filter.fieldId)
                    ?.label ?? filter.fieldId;
                return (
                  <span
                    key={`${filter.fieldId}:${index}`}
                    className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
                  >
                    {tableFilterText(filter, name, t)}
                    {canEdit ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        disabled={save.isPending}
                        aria-label={t("notebook.removeFilter", {
                          column: name,
                        })}
                        onClick={() =>
                          update({
                            filters: pendingConfig.filters.filter(
                              (_, item) => item !== index,
                            ),
                          })
                        }
                      >
                        <IconX size={12} />
                      </Button>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : null}
          <ResultTable
            result={ready}
            columns={columns}
            config={pendingConfig}
            update={canEdit ? update : undefined}
            disabled={save.isPending}
          />
          <div className="nb-result-footer justify-end">
            <TablePages
              page={ready.page}
              totalRows={ready.totalRows}
              onChange={(page) =>
                setNavigation({ revision: cell.updatedAt, page })
              }
            />
            {canEdit ? (
              <TableCellControls
                columns={columns}
                config={pendingConfig}
                update={update}
                disabled={save.isPending}
              />
            ) : null}
            <span className="px-1 text-xs text-muted-foreground" role="status">
              {t("notebook.resultRowCount", {
                count: ready.totalRows,
                formattedCount: formatNumber(ready.totalRows),
              })}
            </span>
            <Tooltip
              content={t("notebook.downloadCsv")}
              trigger={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("notebook.downloadCsv")}
                  onClick={() => void download(ready)}
                  disabled={
                    exporting ||
                    save.isPending ||
                    !columns.some(({ settings }) => !settings?.hidden)
                  }
                >
                  <IconDownload size={14} aria-hidden="true" />
                </Button>
              }
            />
            {exportFailed ? (
              <span
                role="alert"
                className="w-full px-2 text-xs text-destructive"
              >
                {t("notebook.tableCell.exportFailed")}
              </span>
            ) : null}
          </div>
        </>
      ) : result?.status === "unconfigured" && !canEdit ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">
          {t("notebook.tableCell.chooseSource")}
        </p>
      ) : null}
    </div>
  );
}

function TablePages({
  page,
  totalRows,
  onChange,
}: {
  page: number;
  totalRows: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  const lastPage = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  if (lastPage === 1) return null;
  const pages = Array.from(new Set([1, 2, page, lastPage])).sort(
    (a, b) => a - b,
  );
  return (
    <div className="flex flex-wrap items-center">
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={page <= 1}
        aria-label={t("notebook.previousPage")}
        onClick={() => onChange(page - 1)}
      >
        <IconChevronLeft
          size={14}
          className="rtl:rotate-180"
          aria-hidden="true"
        />
      </Button>
      {pages.map((value, index) => (
        <span key={value} className="inline-flex items-center">
          {value - (pages[index - 1] ?? value) > 1 ? (
            <span aria-hidden="true">…</span>
          ) : null}
          <Button
            size="xs"
            className="min-w-6 px-1 tabular-nums"
            variant={value === page ? "secondary" : "ghost"}
            aria-current={value === page ? "page" : undefined}
            onClick={() => onChange(value)}
          >
            {value}
          </Button>
        </span>
      ))}
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={page >= lastPage}
        aria-label={t("notebook.nextPage")}
        onClick={() => onChange(page + 1)}
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

function visibleColumns(columns: TableColumn[]) {
  const visible = columns.filter(({ settings }) => !settings?.hidden);
  return [
    ...visible.filter(({ settings }) => settings?.pinned),
    ...visible.filter(({ settings }) => !settings?.pinned),
  ];
}

function ResultTable({
  result,
  columns,
  config,
  update,
  disabled,
}: {
  result: TablePage;
  columns: TableColumn[];
  config: TableConfig;
  update?: ((patch: Partial<TableConfig>) => void) | undefined;
  disabled: boolean;
}) {
  const t = useT();
  const locale = useReaderLocale();
  const { formatNumber } = useFormatters();
  const { rowNumbers, rowNumbersPinned, typeIcons, columnWidth } = config.view;
  const rowIndexPinned = rowNumbers && rowNumbersPinned;
  const width = columnWidth ?? DEFAULT_COLUMN_WIDTH;
  const rowIndexStyle: CSSProperties = {
    width: ROW_NUMBER_WIDTH,
    insetInlineStart: 0,
  };
  const sticky = "sticky z-1 bg-background";
  const ordered = visibleColumns(columns);
  const totals = ordered.some(({ field }) => config.totals[field.fieldId]);
  function columnStyle(column: TableColumn): CSSProperties {
    const inset = column.settings?.pinned
      ? ordered.indexOf(column) * width +
        (rowIndexPinned ? ROW_NUMBER_WIDTH : 0)
      : undefined;
    return { width, minWidth: width, maxWidth: width, insetInlineStart: inset };
  }

  return (
    <>
      {result.status === "empty" ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">
          {t("queryPaging.noData")}
        </p>
      ) : null}
      <div className="nb-table-scroll min-w-0 max-w-full">
        <table className="nb-table nb-result-grid w-max table-fixed">
          <thead>
            <tr>
              {rowNumbers ? (
                <th
                  scope="col"
                  style={rowIndexStyle}
                  className={cn(
                    "nb-result-row-index",
                    rowIndexPinned && sticky,
                  )}
                >
                  <span aria-hidden="true">#</span>
                  <span className="sr-only">{t("notebook.rowNumber")}</span>
                </th>
              ) : null}
              {ordered.map((column) => {
                const { field, label, settings } = column;
                const Icon = resultColumnIcon(field.type);
                const direction =
                  config.sort?.fieldId === field.fieldId
                    ? config.sort.direction
                    : undefined;
                return (
                  <th
                    key={field.fieldId}
                    scope="col"
                    title={label}
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : undefined
                    }
                    style={columnStyle(column)}
                    className={settings?.pinned ? sticky : undefined}
                  >
                    <div className="flex items-center gap-1">
                      {typeIcons ? (
                        <Icon
                          size={14}
                          className="shrink-0 text-muted-foreground"
                          aria-label={field.type}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {update ? (
                        <TableColumnMenu
                          column={column}
                          config={config}
                          update={update}
                          disabled={disabled}
                        />
                      ) : null}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => {
              const rowNumber = (result.page - 1) * PAGE_SIZE + index;
              return (
                <tr key={rowNumber}>
                  {rowNumbers ? (
                    <th
                      scope="row"
                      style={rowIndexStyle}
                      className={cn(
                        "nb-result-row-index",
                        rowIndexPinned && sticky,
                      )}
                    >
                      {formatNumber(rowNumber)}
                    </th>
                  ) : null}
                  {ordered.map((column) => {
                    const { field, index, settings } = column;
                    const value = row[index];
                    const formatted =
                      value === null
                        ? t("notebook.tableCell.nullValue")
                        : typeof value === "boolean"
                          ? t(
                              value
                                ? "notebook.filterTrue"
                                : "notebook.filterFalse",
                            )
                          : formatPublishedValue(
                              value,
                              settings?.format === "default"
                                ? null
                                : (settings?.format ?? null),
                              locale,
                            );
                    const highlighted = config.formatRules.some(
                      (rule) =>
                        rule.fieldId === field.fieldId &&
                        tableRuleMatches(rule, field, value),
                    );
                    return (
                      <td
                        key={field.fieldId}
                        style={columnStyle(column)}
                        className={cn(
                          settings?.pinned && sticky,
                          isNumericResultColumn(field.type) &&
                            "nb-result-number",
                          highlighted && "bg-destructive/15 text-destructive",
                        )}
                        title={formatted}
                      >
                        {formatted}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          {totals ? (
            <tfoot>
              <tr>
                {rowNumbers ? (
                  <th
                    scope="row"
                    style={rowIndexStyle}
                    className={rowIndexPinned ? sticky : undefined}
                  >
                    {t("notebook.resultTotals")}
                  </th>
                ) : null}
                {ordered.map((column) => (
                  <td
                    className={cn(
                      "font-semibold",
                      column.settings?.pinned && sticky,
                      (isNumericResultColumn(column.field.type) ||
                        typeof result.totals[column.index] === "number") &&
                        "nb-result-number",
                    )}
                    style={columnStyle(column)}
                    key={column.field.fieldId}
                  >
                    {config.totals[column.field.fieldId]
                      ? ((typeof result.totals[column.index] === "number"
                          ? formatPublishedValue(
                              result.totals[column.index],
                              "number",
                              locale,
                            )
                          : result.totals[column.index]) ?? "—")
                      : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </>
  );
}
