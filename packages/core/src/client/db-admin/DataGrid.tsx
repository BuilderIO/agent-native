import {
  IconKey,
  IconArrowUp,
  IconArrowDown,
  IconExternalLink,
  IconTrash,
  IconArrowBackUp,
} from "@tabler/icons-react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useCallback, useMemo, useRef } from "react";

import type {
  DbAdminColumn,
  DbAdminForeignKey,
  DbAdminSort,
  DbAdminTableSchema,
} from "../../db-admin/types.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { cn } from "../utils.js";
import { inferEditorKind, type EditorKind } from "./cell-format.js";
import { EditableCell } from "./EditableCell.js";

/** A grid row pairs the displayed values with its stable pk string. */
export interface GridRow {
  pk: string;
  /** Values WITH staged edits already applied (for display). */
  values: Record<string, unknown>;
  isNew?: boolean;
  isDeleted?: boolean;
  /** Local id for new rows (so edits route to the right new-row). */
  localId?: string;
}

/** Identifies the focused cell for keyboard nav. */
export interface ActiveCell {
  rowIndex: number;
  colName: string;
  editing: boolean;
}

export interface DataGridProps {
  schema: DbAdminTableSchema;
  rows: GridRow[];
  isLoading: boolean;
  pageSize: number;

  sort: DbAdminSort[];
  onSortChange: (sort: DbAdminSort[]) => void;

  selectedPks: Set<string>;
  onSelectionChange: (pks: Set<string>) => void;

  columnWidths: Record<string, number>;
  onColumnWidthsChange: (widths: Record<string, number>) => void;

  active: ActiveCell | null;
  onActiveChange: (active: ActiveCell | null) => void;

  /** Whether editing is permitted (table has a PK). */
  editable: boolean;

  /** Commit a staged cell edit. */
  onCellCommit: (row: GridRow, col: string, value: unknown) => void;
  /** Whether a given cell is dirty. */
  isCellDirty: (row: GridRow, col: string) => boolean;
  /** Toggle deletion staging for a single row. */
  onToggleDelete: (row: GridRow) => void;

  onNavigateToRow: (fk: DbAdminForeignKey, value: unknown) => void;
}

const SELECT_COL = "__select__";
const ACTIONS_COL = "__actions__";

export function DataGrid(props: DataGridProps) {
  const {
    schema,
    rows,
    isLoading,
    pageSize,
    sort,
    onSortChange,
    selectedPks,
    onSelectionChange,
    columnWidths,
    onColumnWidthsChange,
    active,
    onActiveChange,
    editable,
    onCellCommit,
    isCellDirty,
    onToggleDelete,
    onNavigateToRow,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);

  const fkByColumn = useMemo(() => {
    const map = new Map<string, DbAdminForeignKey>();
    for (const fk of schema.foreignKeys) map.set(fk.column, fk);
    return map;
  }, [schema.foreignKeys]);

  const kindByColumn = useMemo(() => {
    const map = new Map<string, EditorKind>();
    for (const col of schema.columns) map.set(col.name, inferEditorKind(col));
    return map;
  }, [schema.columns]);

  const allSelected =
    rows.length > 0 && rows.every((r) => selectedPks.has(r.pk));
  const someSelected = rows.some((r) => selectedPks.has(r.pk));

  const toggleAll = useCallback(() => {
    if (allSelected) onSelectionChange(new Set());
    else onSelectionChange(new Set(rows.map((r) => r.pk)));
  }, [allSelected, rows, onSelectionChange]);

  const toggleOne = useCallback(
    (pk: string) => {
      const next = new Set(selectedPks);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      onSelectionChange(next);
    },
    [selectedPks, onSelectionChange],
  );

  const cycleSort = useCallback(
    (colName: string) => {
      const current = sort.find((s) => s.column === colName);
      if (!current) onSortChange([{ column: colName, dir: "asc" }]);
      else if (current.dir === "asc")
        onSortChange([{ column: colName, dir: "desc" }]);
      else onSortChange([]);
    },
    [sort, onSortChange],
  );

  const columns = useMemo<ColumnDef<GridRow>[]>(() => {
    const selectCol: ColumnDef<GridRow> = {
      id: SELECT_COL,
      size: 40,
      enableResizing: false,
      header: () => (
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = !allSelected && someSelected;
          }}
          onChange={toggleAll}
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
          aria-label="Select all rows"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedPks.has(row.original.pk)}
          onChange={() => toggleOne(row.original.pk)}
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
          aria-label="Select row"
        />
      ),
    };

    const dataCols: ColumnDef<GridRow>[] = schema.columns.map((col) => ({
      id: col.name,
      accessorFn: (r) => r.values[col.name],
      size: columnWidths[col.name] ?? defaultWidth(col),
      minSize: 60,
      header: () => (
        <ColumnHeader
          column={col}
          fk={fkByColumn.get(col.name)}
          sortDir={sort.find((s) => s.column === col.name)?.dir}
          onSort={() => cycleSort(col.name)}
        />
      ),
      cell: ({ row, getValue }) => {
        const value = getValue();
        const fk = fkByColumn.get(col.name);
        const isActive =
          active?.rowIndex === row.index && active.colName === col.name;
        return (
          <div className="group relative flex h-full items-center">
            <EditableCell
              column={col}
              kind={kindByColumn.get(col.name) ?? "text"}
              value={value}
              editable={editable && !row.original.isDeleted}
              dirty={isCellDirty(row.original, col.name)}
              active={isActive}
              editing={isActive ? active.editing : false}
              onStartEdit={() =>
                onActiveChange({
                  rowIndex: row.index,
                  colName: col.name,
                  editing: true,
                })
              }
              onCancelEdit={() =>
                onActiveChange({
                  rowIndex: row.index,
                  colName: col.name,
                  editing: false,
                })
              }
              onCommit={(v) => {
                onCellCommit(row.original, col.name, v);
                onActiveChange({
                  rowIndex: row.index,
                  colName: col.name,
                  editing: false,
                });
              }}
              onNavigate={(dir) => moveActive(dir, row.index, col.name)}
            />
            {fk && value !== null && value !== undefined && (
              <button
                type="button"
                title={`Open ${fk.refTable}.${fk.refColumn}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToRow(fk, value);
                }}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/50 opacity-0 hover:text-primary group-hover:opacity-100"
              >
                <IconExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      },
    }));

    const actionsCol: ColumnDef<GridRow> = {
      id: ACTIONS_COL,
      size: 44,
      enableResizing: false,
      header: () => null,
      cell: ({ row }) => (
        <div className="flex h-full items-center justify-center">
          <button
            type="button"
            title={row.original.isDeleted ? "Undo delete" : "Delete row"}
            onClick={() => onToggleDelete(row.original)}
            disabled={!editable}
            className={cn(
              "rounded p-1 text-muted-foreground/50 hover:text-destructive disabled:opacity-30",
              row.original.isDeleted && "text-destructive",
            )}
          >
            {row.original.isDeleted ? (
              <IconArrowBackUp className="h-3.5 w-3.5" />
            ) : (
              <IconTrash className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      ),
    };

    return [selectCol, ...dataCols, actionsCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    schema.columns,
    columnWidths,
    fkByColumn,
    kindByColumn,
    sort,
    active,
    selectedPks,
    allSelected,
    someSelected,
    editable,
  ]);

  const moveActive = useCallback(
    (
      dir: "up" | "down" | "left" | "right",
      rowIndex: number,
      colName: string,
    ) => {
      const dataColNames = schema.columns.map((c) => c.name);
      const colIdx = dataColNames.indexOf(colName);
      let nextRow = rowIndex;
      let nextCol = colIdx;
      if (dir === "down") nextRow = Math.min(rows.length - 1, rowIndex + 1);
      else if (dir === "up") nextRow = Math.max(0, rowIndex - 1);
      else if (dir === "right")
        nextCol = Math.min(dataColNames.length - 1, colIdx + 1);
      else if (dir === "left") nextCol = Math.max(0, colIdx - 1);
      onActiveChange({
        rowIndex: nextRow,
        colName: dataColNames[nextCol],
        editing: false,
      });
    },
    [schema.columns, rows.length, onActiveChange],
  );

  const sizingState: ColumnSizingState = useMemo(() => {
    const out: ColumnSizingState = {};
    for (const [k, v] of Object.entries(columnWidths)) out[k] = v;
    return out;
  }, [columnWidths]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    state: { columnSizing: sizingState },
    onColumnSizingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(sizingState) : updater;
      onColumnWidthsChange(next as Record<string, number>);
    },
    getRowId: (r) => r.pk,
  });

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (!active || active.editing) return;
    const dataColNames = schema.columns.map((c) => c.name);
    const colIdx = dataColNames.indexOf(active.colName);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive("down", active.rowIndex, active.colName);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive("up", active.rowIndex, active.colName);
    } else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      moveActive("right", active.rowIndex, active.colName);
    } else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      moveActive("left", active.rowIndex, active.colName);
    } else if (e.key === "Enter" && colIdx >= 0) {
      e.preventDefault();
      onActiveChange({ ...active, editing: true });
    }
  };

  const totalWidth = table.getTotalSize();

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto"
        tabIndex={0}
        onKeyDown={onGridKeyDown}
      >
        <table
          className="border-separate border-spacing-0 text-xs"
          style={{ width: totalWidth, minWidth: "100%" }}
        >
          <thead className="sticky top-0 z-20">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className={cn(
                      "relative h-9 border-b border-r border-border bg-muted/60 px-2 text-left align-middle font-medium text-muted-foreground backdrop-blur",
                      header.column.id === SELECT_COL && "px-0 text-center",
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={cn(
                          "absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent hover:bg-ring",
                          header.column.getIsResizing() && "bg-ring",
                        )}
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <SkeletonRows
                columnCount={schema.columns.length + 2}
                rows={Math.min(pageSize, 12)}
              />
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={schema.columns.length + 2}
                  className="px-4 py-16 text-center text-muted-foreground"
                >
                  No rows.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "group/row hover:bg-muted/30",
                    row.original.isNew && "bg-emerald-500/5",
                    row.original.isDeleted &&
                      "bg-destructive/5 line-through opacity-60",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className={cn(
                        "h-8 border-b border-r border-border p-0 align-middle",
                        cell.column.id === SELECT_COL && "text-center",
                      )}
                    >
                      {cell.column.id === SELECT_COL ||
                      cell.column.id === ACTIONS_COL ? (
                        <div className="flex h-full items-center justify-center">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </div>
                      ) : (
                        flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

function defaultWidth(col: DbAdminColumn): number {
  const kind = inferEditorKind(col);
  if (kind === "boolean") return 90;
  if (kind === "uuid") return 280;
  if (kind === "json") return 240;
  if (kind === "timestamp") return 180;
  if (kind === "number") return 110;
  return 180;
}

function ColumnHeader({
  column,
  fk,
  sortDir,
  onSort,
}: {
  column: DbAdminColumn;
  fk?: DbAdminForeignKey;
  sortDir?: "asc" | "desc";
  onSort: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSort}
      className="flex w-full items-center gap-1 overflow-hidden"
    >
      {column.pk && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <IconKey className="h-3 w-3 shrink-0 text-amber-500" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Primary key</TooltipContent>
        </Tooltip>
      )}
      {fk && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <IconExternalLink className="h-3 w-3 shrink-0 text-primary/70" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            → {fk.refTable}.{fk.refColumn}
          </TooltipContent>
        </Tooltip>
      )}
      <span className="truncate font-medium text-foreground">
        {column.name}
      </span>
      <span className="rounded bg-background/60 px-1 font-mono text-[9px] font-normal text-muted-foreground">
        {column.type}
      </span>
      <span className="ml-auto shrink-0">
        {sortDir === "asc" ? (
          <IconArrowUp className="h-3 w-3" />
        ) : sortDir === "desc" ? (
          <IconArrowDown className="h-3 w-3" />
        ) : null}
      </span>
    </button>
  );
}

function SkeletonRows({
  columnCount,
  rows,
}: {
  columnCount: number;
  rows: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: columnCount }).map((_, c) => (
            <td key={c} className="h-8 border-b border-r border-border px-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
