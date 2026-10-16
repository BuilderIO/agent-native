import { setClientAppState } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  BREAKDOWN_SMALL_GROUP,
  breakdownRowKey,
  buildBreakdownTable,
  planBreakdown,
  rowsForBreakdown,
  sameCell,
  type PanelBreakdown,
} from "@shared/row-breakdown";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  formatCell,
  isNumericColumnFormat,
} from "@/components/dashboard/SqlChart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/cost-tracker";
import { useSqlQuery } from "@/lib/sql-query";
import { cn } from "@/lib/utils";

import { interpolateDashboardPanelSql } from "./interpolate";
import { serializePanelSql } from "./panel-sql";
import type { SqlPanel, TableColumnConfig } from "./types";

export const ROW_BREAKDOWN_STATE_KEY = "row-breakdown";

export interface RowBreakdownSelection {
  row: Record<string, unknown>;
  rows: Record<string, unknown>[];
  /** When this row was opened; a breakdown fetched before then cost this row nothing. */
  openedAt: number;
}

function shownColumns(
  panel: SqlPanel,
  row: Record<string, unknown>,
): TableColumnConfig[] {
  const configured = (panel.config?.columns ?? []).filter(
    (column) =>
      !column.hidden && Object.prototype.hasOwnProperty.call(row, column.key),
  );
  return configured.length > 0
    ? configured
    : Object.keys(row).map((key) => ({ key }));
}

export function RowBreakdownSheet({
  panel,
  breakdowns,
  dashboardId,
  filters,
  selection,
  onSelectionChange,
}: {
  panel: SqlPanel;
  breakdowns: PanelBreakdown[];
  dashboardId?: string;
  filters: Record<string, string>;
  selection: RowBreakdownSelection | null;
  onSelectionChange: (selection: RowBreakdownSelection | null) => void;
}) {
  const t = useT();
  const [column, setColumn] = useState(breakdowns[0].column);
  const activeColumn = breakdowns.some((item) => item.column === column)
    ? column
    : breakdowns[0].column;
  const breakdown =
    breakdowns.find((item) => item.column === activeColumn) ?? breakdowns[0];
  const row = selection?.row;
  const panelRows = selection?.rows ?? [];
  const columns = useMemo(
    () => (row ? shownColumns(panel, row) : []),
    [panel, row],
  );
  const rowKey = breakdownRowKey(panel.config?.columns, row);
  const sizeKey =
    columns.find((item) => item.key !== rowKey && item.format === "number")
      ?.key ?? null;
  const panelSql = serializePanelSql(panel.sql);
  const plan = planBreakdown({
    column: activeColumn,
    panelRows,
    panelSql,
    vars: filters,
  });
  const breakdownSql =
    plan.kind === "query"
      ? interpolateDashboardPanelSql(panelSql, plan.vars, panel)
      : "";
  // One query returns every row's split, so the cache key leaves out the
  // clicked row: the next row on the same filters reads nothing.
  const query = useSqlQuery(
    ["row-breakdown", dashboardId ?? "", panel.id, panel.source, breakdownSql],
    breakdownSql,
    panel.source,
    {
      enabled: selection !== null && plan.kind === "query",
      reuseCompletedOnEnable: true,
      purpose: "row-breakdown",
    },
  );

  const sourceRows =
    plan.kind === "reuse" ? panelRows : (query.data?.rows ?? null);
  const table = useMemo(() => {
    if (!sourceRows || !row || !rowKey) return null;
    return buildBreakdownTable({
      rows: rowsForBreakdown(sourceRows, rowKey, row[rowKey]),
      column: activeColumn,
      sizeKey,
      // A reused row is one (row, column) pair, not the whole row it names.
      parentSize: sizeKey && plan.kind === "query" ? row[sizeKey] : null,
    });
  }, [sourceRows, row, rowKey, activeColumn, sizeKey, plan.kind]);

  const rowValue = row && rowKey ? row[rowKey] : null;
  const published = useRef(false);
  const open = selection !== null;
  useEffect(() => {
    // Every table panel mounts this sheet closed; only one that was open
    // clears the state, so a dashboard load writes nothing.
    if (!open && !published.current) return;
    published.current = open;
    const state = open
      ? {
          dashboardId: dashboardId ?? null,
          panelId: panel.id,
          panelTitle: panel.title,
          row: rowKey ? { [rowKey]: rowValue } : null,
          breakdownColumn: activeColumn,
        }
      : null;
    setClientAppState(ROW_BREAKDOWN_STATE_KEY, state).catch((error) => {
      console.warn(
        "[row-breakdown] Could not publish the open breakdown",
        error,
      );
    });
  }, [
    open,
    dashboardId,
    panel.id,
    panel.title,
    rowKey,
    rowValue,
    activeColumn,
  ]);

  const valueColumns = columns.filter(
    (item) => item.key !== rowKey && item.key !== activeColumn,
  );
  const groupLabel = (value: unknown) =>
    value == null || value === ""
      ? t("sqlDashboard.rowBreakdownNoValue")
      : formatCell(value, undefined);

  const moveSelection = (offset: number) => {
    if (!selection || !rowKey) return;
    const index = panelRows.findIndex((item) =>
      sameCell(item[rowKey], selection.row[rowKey]),
    );
    const next = panelRows[index + offset];
    if (index >= 0 && next) {
      onSelectionChange({ row: next, rows: panelRows, openedAt: Date.now() });
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (
      event.target instanceof Element &&
      event.target.closest("[role='combobox'], [role='listbox']")
    ) {
      return;
    }
    event.preventDefault();
    moveSelection(event.key === "ArrowDown" ? 1 : -1);
  };

  const costNote =
    plan.kind === "reuse"
      ? t("sqlDashboard.rowBreakdownFromPanel")
      : !query.data || query.isPlaceholderData
        ? null
        : selection && query.dataUpdatedAt < selection.openedAt
          ? t("sqlDashboard.rowBreakdownAlreadyLoaded")
          : query.data.cached
            ? t("sqlDashboard.rowBreakdownFromCache")
            : typeof query.data.bytesProcessed === "number"
              ? t("sqlDashboard.rowBreakdownBytesRead", {
                  bytes: formatBytes(query.data.bytesProcessed),
                })
              : null;

  const numericCell = (item: TableColumnConfig) =>
    isNumericColumnFormat(item.format) ? "text-right tabular-nums" : "";

  return (
    <Sheet
      modal={false}
      open={open}
      onOpenChange={(open) => {
        if (!open) onSelectionChange(null);
      }}
    >
      <SheetContent
        side="right"
        showOverlay={false}
        data-no-panel-chat-select
        className="flex w-[440px] flex-col gap-4 p-5 sm:max-w-[440px]"
        onKeyDown={handleKeyDown}
        // Clicking another row of this table moves the panel instead of
        // closing it.
        onInteractOutside={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(`[data-row-breakdown-panel="${panel.id}"]`)
          ) {
            event.preventDefault();
          }
        }}
      >
        <SheetTitle className="truncate pe-8 text-base">
          {groupLabel(rowValue)}
        </SheetTitle>
        {breakdowns.length > 1 ? (
          <Select value={activeColumn} onValueChange={setColumn}>
            <SelectTrigger
              className="h-8 w-48 text-sm"
              aria-label={t("sqlDashboard.rowBreakdownBy")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {breakdowns.map((item) => (
                <SelectItem key={item.column} value={item.column}>
                  {item.label ?? item.column}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {plan.kind === "unavailable" ? (
            <p className="text-sm text-muted-foreground">
              {t("sqlDashboard.rowBreakdownUnavailable", {
                column: breakdown.label ?? breakdown.column,
              })}
            </p>
          ) : query.error && plan.kind === "query" ? (
            <p className="text-sm text-destructive">
              {query.error instanceof Error
                ? query.error.message
                : String(query.error)}
            </p>
          ) : !table ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-7 w-full" />
              ))}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-2 py-1.5 text-start font-medium">
                    {breakdown.label ?? breakdown.column}
                  </th>
                  {valueColumns.map((item) => (
                    <th
                      key={item.key}
                      className={cn(
                        "px-2 py-1.5 font-medium",
                        isNumericColumnFormat(item.format)
                          ? "text-right"
                          : "text-start",
                      )}
                    >
                      {item.label ?? item.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.kind === "query" ? (
                  <tr className="border-b border-border font-medium">
                    <td className="px-2 py-1.5">
                      {t("sqlDashboard.rowBreakdownAll")}
                    </td>
                    {valueColumns.map((item) => (
                      <td
                        key={item.key}
                        className={cn("px-2 py-1.5", numericCell(item))}
                      >
                        {row ? formatCell(row[item.key], item.format) : ""}
                      </td>
                    ))}
                  </tr>
                ) : null}
                {table.groups.length === 0 && !table.other ? (
                  <tr>
                    <td
                      colSpan={valueColumns.length + 1}
                      className="px-2 py-3 text-muted-foreground"
                    >
                      {t("sqlDashboard.rowBreakdownEmpty")}
                    </td>
                  </tr>
                ) : null}
                {table.groups.map((group, index) => (
                  <tr
                    key={`${String(group.value)}-${index}`}
                    className={cn(
                      "border-b border-border/50",
                      group.small && "text-muted-foreground",
                    )}
                  >
                    <td className="max-w-0 truncate px-2 py-1.5">
                      {group.small ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{groupLabel(group.value)}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("sqlDashboard.rowBreakdownSmallGroup", {
                              count: BREAKDOWN_SMALL_GROUP,
                            })}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        groupLabel(group.value)
                      )}
                    </td>
                    {valueColumns.map((item) => (
                      <td
                        key={item.key}
                        className={cn("px-2 py-1.5", numericCell(item))}
                      >
                        {formatCell(group.row[item.key], item.format)}
                      </td>
                    ))}
                  </tr>
                ))}
                {table.other ? (
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <td className="px-2 py-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{t("sqlDashboard.rowBreakdownOther")}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("sqlDashboard.rowBreakdownOtherHint")}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    {valueColumns.map((item) => (
                      <td
                        key={item.key}
                        className={cn("px-2 py-1.5", numericCell(item))}
                      >
                        {item.key === sizeKey
                          ? formatCell(table.other?.size, item.format)
                          : ""}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
        {costNote ? (
          <p className="text-xs text-muted-foreground">{costNote}</p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
