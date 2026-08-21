import * as React from "react";

import { cn } from "../utils.js";

export type DataGridSelectionMode = "none" | "single" | "multiple";

export type DataGridDirection = "up" | "down" | "left" | "right";

export interface DataGridActiveCell {
  rowId: string;
  columnId: string;
  editing: boolean;
}

export interface DataGridColumn<Row, Value = unknown> {
  id: string;
  label?: React.ReactNode;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  editable?: boolean | ((row: Row) => boolean);
  getValue?: (row: Row) => Value;
  renderCell?: (context: DataGridCellContext<Row, Value>) => React.ReactNode;
  renderEditor?: (
    context: DataGridEditorContext<Row, Value>,
  ) => React.ReactNode;
}

export interface DataGridCellContext<Row, Value = unknown> {
  row: Row;
  rowIndex: number;
  column: DataGridColumn<Row, Value>;
  value: Value | undefined;
  active: boolean;
  editing: boolean;
  editable: boolean;
  startEditing: () => void;
  commit: (value: Value) => void;
  cancel: () => void;
  move: (direction: DataGridDirection) => void;
}

export interface DataGridEditorContext<
  Row,
  Value = unknown,
> extends DataGridCellContext<Row, Value> {
  onCommit: (value: Value) => void;
  onCancel: () => void;
  onMove: (direction: DataGridDirection) => void;
}

export interface DataGridCommitContext<Row> {
  row: Row;
  rowIndex: number;
  column: DataGridColumn<Row>;
  previousValue: unknown;
  value: unknown;
}

export interface DataGridSlotContext<Row> {
  rows: readonly Row[];
  columns: readonly DataGridColumn<Row>[];
  columnWidths: Readonly<Record<string, number>>;
  gridTemplateColumns: string;
  selection: DataGridSelectionMode;
  selectedRowIds: ReadonlySet<string>;
  getRowId: (row: Row, rowIndex: number) => string;
  setActiveCell: (cell: DataGridActiveCell | null) => void;
  toggleRowSelection: (rowId: string) => void;
  resizeColumn: (columnId: string, width: number) => void;
}

export interface DataGridRowContext<Row> extends DataGridSlotContext<Row> {
  row: Row;
  rowIndex: number;
  rowId: string;
  selected: boolean;
}

type DataGridScrollContainerProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> &
  Record<`data-${string}`, string | undefined>;

export interface DataGridProps<Row> extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  rows: readonly Row[];
  columns: readonly DataGridColumn<Row>[];
  getRowId: (row: Row, rowIndex: number) => string;
  columnWidths?: Readonly<Record<string, number>>;
  onColumnWidthsChange?: (columnWidths: Record<string, number>) => void;
  selection?: DataGridSelectionMode;
  selectedRowIds?: ReadonlySet<string>;
  onSelectedRowIdsChange?: (rowIds: ReadonlySet<string>) => void;
  activeCell?: DataGridActiveCell | null;
  onActiveCellChange?: (cell: DataGridActiveCell | null) => void;
  onCellCommit?: (context: DataGridCommitContext<Row>) => void;
  renderHeader?: (context: DataGridSlotContext<Row>) => React.ReactNode;
  renderBody?: (context: DataGridSlotContext<Row>) => React.ReactNode;
  renderRow?: (context: DataGridRowContext<Row>) => React.ReactNode;
  renderFooter?: (context: DataGridSlotContext<Row>) => React.ReactNode;
  emptyState?: React.ReactNode;
  loading?: boolean;
  loadingRowCount?: number;
  contentClassName?: string;
  rowClassName?: string | ((row: Row, rowIndex: number) => string);
  scrollContainerProps?: DataGridScrollContainerProps;
}

const DEFAULT_COLUMN_WIDTH = 160;
const DEFAULT_MIN_COLUMN_WIDTH = 96;
const DEFAULT_MAX_COLUMN_WIDTH = 640;
const SELECTION_COLUMN_WIDTH = 40;

function columnWidth<Row>(
  column: DataGridColumn<Row>,
  requestedWidth: number | undefined,
) {
  const fallback = column.width ?? DEFAULT_COLUMN_WIDTH;
  const width =
    requestedWidth !== undefined && Number.isFinite(requestedWidth)
      ? requestedWidth
      : fallback;
  const minWidth = column.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH;
  const maxWidth = Math.max(
    minWidth,
    column.maxWidth ?? DEFAULT_MAX_COLUMN_WIDTH,
  );
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

export function clampDataGridColumnWidth<Row>(
  width: number,
  column: DataGridColumn<Row>,
) {
  return columnWidth(column, width);
}

export function dataGridColumnTemplate<Row>(
  columns: readonly DataGridColumn<Row>[],
  columnWidths: Readonly<Record<string, number>> = {},
  selection: DataGridSelectionMode = "none",
) {
  const selectionTemplate =
    selection === "none" ? [] : [`${SELECTION_COLUMN_WIDTH}px`];
  return [
    ...selectionTemplate,
    ...columns.map(
      (column) => `${columnWidth(column, columnWidths[column.id])}px`,
    ),
  ].join(" ");
}

function isColumnEditable<Row>(column: DataGridColumn<Row>, row: Row) {
  if (!column.renderEditor) return false;
  return typeof column.editable === "function"
    ? column.editable(row)
    : column.editable !== false;
}

function defaultCellText(value: unknown) {
  return value == null ? "" : String(value);
}

function loadingRows<Row>({
  count,
  columns,
  gridTemplateColumns,
  selection,
}: {
  count: number;
  columns: readonly DataGridColumn<Row>[];
  gridTemplateColumns: string;
  selection: DataGridSelectionMode;
}) {
  return Array.from({ length: count }, (_, rowIndex) => (
    <div
      key={`loading-${rowIndex}`}
      role="row"
      aria-hidden="true"
      className="grid min-h-10 border-b border-border/30"
      style={{ gridTemplateColumns }}
    >
      {selection !== "none" ? <div role="gridcell" /> : null}
      {columns.map((column) => (
        <div key={column.id} role="gridcell" className="p-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  ));
}

function DataGridHeader<Row>({
  columns,
  gridTemplateColumns,
  selection,
  rows,
  getRowId,
  selectedRowIds,
  onToggleAll,
  onStartResize,
}: {
  columns: readonly DataGridColumn<Row>[];
  gridTemplateColumns: string;
  selection: DataGridSelectionMode;
  rows: readonly Row[];
  getRowId: (row: Row, rowIndex: number) => string;
  selectedRowIds: ReadonlySet<string>;
  onToggleAll: () => void;
  onStartResize: (
    event: React.PointerEvent<HTMLButtonElement>,
    column: DataGridColumn<Row>,
  ) => void;
}) {
  const allSelected =
    rows.length > 0 &&
    rows.every((row, rowIndex) => selectedRowIds.has(getRowId(row, rowIndex)));

  return (
    <div
      role="row"
      className="grid border-y border-border/35 text-xs font-medium text-muted-foreground/80"
      style={{ gridTemplateColumns }}
    >
      {selection !== "none" ? (
        <div
          role="columnheader"
          className="flex h-9 items-center justify-center border-r border-border/30"
        >
          {selection === "multiple" ? (
            <input
              type="checkbox"
              aria-label="Select all rows"
              checked={allSelected}
              onChange={onToggleAll}
            />
          ) : null}
        </div>
      ) : null}
      {columns.map((column) => (
        <div
          key={column.id}
          role="columnheader"
          data-data-grid-column-id={column.id}
          className="group relative flex h-9 min-w-0 items-center gap-1 border-r border-border/30 px-2 last:border-r-0"
        >
          <span className="min-w-0 truncate">{column.label ?? column.id}</span>
          {column.resizable === false ? null : (
            <button
              type="button"
              aria-label={`Resize ${column.id} column`}
              className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"
              onPointerDown={(event) => onStartResize(event, column)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function DataGridDefaultRow<Row>({
  row,
  rowIndex,
  rowId,
  columns,
  gridTemplateColumns,
  selection,
  selected,
  rowClassName,
  activeCell,
  setActiveCell,
  toggleRowSelection,
  moveActiveCell,
  commitCell,
}: {
  row: Row;
  rowIndex: number;
  rowId: string;
  columns: readonly DataGridColumn<Row>[];
  gridTemplateColumns: string;
  selection: DataGridSelectionMode;
  selected: boolean;
  rowClassName?: string;
  activeCell: DataGridActiveCell | null;
  setActiveCell: (cell: DataGridActiveCell | null) => void;
  toggleRowSelection: (rowId: string) => void;
  moveActiveCell: (
    rowIndex: number,
    columnIndex: number,
    direction: DataGridDirection,
  ) => void;
  commitCell: (
    row: Row,
    rowIndex: number,
    column: DataGridColumn<Row>,
    value: unknown,
  ) => void;
}) {
  return (
    <div
      role="row"
      data-data-grid-row-id={rowId}
      aria-selected={selected || undefined}
      className={cn(
        "grid min-h-10 border-b border-border/30 text-sm",
        rowClassName,
        selected && "bg-muted/35",
      )}
      style={{ gridTemplateColumns }}
    >
      {selection !== "none" ? (
        <div
          role="gridcell"
          className="flex items-center justify-center border-r border-border/30"
        >
          <input
            type={selection === "single" ? "radio" : "checkbox"}
            name={selection === "single" ? "data-grid-selection" : undefined}
            aria-label={`Select row ${rowId}`}
            checked={selected}
            onChange={() => toggleRowSelection(rowId)}
          />
        </div>
      ) : null}
      {columns.map((column, columnIndex) => {
        const value = column.getValue?.(row);
        const active =
          activeCell?.rowId === rowId && activeCell.columnId === column.id;
        const editing = active && activeCell.editing;
        const editable = isColumnEditable(column, row);
        const startEditing = () => {
          if (editable) {
            setActiveCell({ rowId, columnId: column.id, editing: true });
          }
        };
        const cancel = () => {
          setActiveCell({ rowId, columnId: column.id, editing: false });
        };
        const commit = (nextValue: unknown) => {
          commitCell(row, rowIndex, column, nextValue);
          setActiveCell({ rowId, columnId: column.id, editing: false });
        };
        const move = (direction: DataGridDirection) => {
          moveActiveCell(rowIndex, columnIndex, direction);
        };
        const context = {
          row,
          rowIndex,
          column,
          value,
          active,
          editing,
          editable,
          startEditing,
          commit,
          cancel,
          move,
        } satisfies DataGridCellContext<Row>;

        return (
          <div
            key={column.id}
            role="gridcell"
            data-data-grid-cell="true"
            data-data-grid-row-id={rowId}
            data-data-grid-column-id={column.id}
            tabIndex={active ? 0 : -1}
            className={cn(
              "min-w-0 border-r border-border/30 px-2 py-2 outline-none last:border-r-0",
              active && "bg-accent/50 ring-1 ring-inset ring-ring",
            )}
            onClick={() =>
              setActiveCell({ rowId, columnId: column.id, editing: false })
            }
            onDoubleClick={startEditing}
            onKeyDown={(event) => {
              if (editing) {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
                return;
              }
              if (event.key === "Enter" || event.key === "F2") {
                if (editable) {
                  event.preventDefault();
                  startEditing();
                }
                return;
              }
              const direction = {
                ArrowUp: "up",
                ArrowDown: "down",
                ArrowLeft: "left",
                ArrowRight: "right",
                Tab: event.shiftKey ? "left" : "right",
              }[event.key] as DataGridDirection | undefined;
              if (direction) {
                event.preventDefault();
                move(direction);
              }
            }}
            onPointerDown={(event) => {
              if (event.button === 0) event.currentTarget.focus();
            }}
          >
            {editing && column.renderEditor
              ? column.renderEditor({
                  ...context,
                  onCommit: (nextValue) => commit(nextValue),
                  onCancel: cancel,
                  onMove: move,
                })
              : column.renderCell
                ? column.renderCell(context)
                : defaultCellText(value)}
          </div>
        );
      })}
    </div>
  );
}

export function DataGrid<Row>({
  rows,
  columns,
  getRowId,
  columnWidths,
  onColumnWidthsChange,
  selection = "none",
  selectedRowIds,
  onSelectedRowIdsChange,
  activeCell,
  onActiveCellChange,
  onCellCommit,
  renderHeader,
  renderBody,
  renderRow,
  renderFooter,
  emptyState,
  loading = false,
  loadingRowCount = 4,
  contentClassName,
  rowClassName,
  scrollContainerProps,
  className,
  ...gridProps
}: DataGridProps<Row>) {
  const gridRef = React.useRef<HTMLDivElement>(null);
  const hasMountedActiveCellRef = React.useRef(false);
  const [internalColumnWidths, setInternalColumnWidths] = React.useState<
    Record<string, number>
  >({});
  const [internalSelectedRowIds, setInternalSelectedRowIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set());
  const [internalActiveCell, setInternalActiveCell] =
    React.useState<DataGridActiveCell | null>(() =>
      rows.length > 0 && columns.length > 0
        ? {
            rowId: getRowId(rows[0], 0),
            columnId: columns[0].id,
            editing: false,
          }
        : null,
    );

  const resolvedColumnWidths = columnWidths ?? internalColumnWidths;
  const resolvedSelectedRowIds = selectedRowIds ?? internalSelectedRowIds;
  const resolvedActiveCell =
    activeCell === undefined ? internalActiveCell : activeCell;
  const gridTemplateColumns = dataGridColumnTemplate(
    columns,
    resolvedColumnWidths,
    selection,
  );

  const setActive = React.useCallback(
    (cell: DataGridActiveCell | null) => {
      if (activeCell === undefined) setInternalActiveCell(cell);
      onActiveCellChange?.(cell);
    },
    [activeCell, onActiveCellChange],
  );

  React.useEffect(() => {
    if (!resolvedActiveCell) return;
    const hasRow = rows.some(
      (row, rowIndex) => getRowId(row, rowIndex) === resolvedActiveCell.rowId,
    );
    const hasColumn = columns.some(
      (column) => column.id === resolvedActiveCell.columnId,
    );
    if (!hasRow || !hasColumn) setActive(null);
  }, [columns, getRowId, rows, resolvedActiveCell, setActive]);

  React.useEffect(() => {
    if (activeCell !== undefined || resolvedActiveCell) return;
    if (rows.length === 0 || columns.length === 0) return;
    setActive({
      rowId: getRowId(rows[0], 0),
      columnId: columns[0].id,
      editing: false,
    });
  }, [activeCell, columns, getRowId, resolvedActiveCell, rows, setActive]);

  React.useEffect(() => {
    if (!resolvedActiveCell || resolvedActiveCell.editing) return;
    if (!hasMountedActiveCellRef.current) {
      hasMountedActiveCellRef.current = true;
      return;
    }
    const cells = gridRef.current?.querySelectorAll<HTMLElement>(
      "[data-data-grid-cell='true']",
    );
    const target = Array.from(cells ?? []).find(
      (cell) =>
        cell.dataset.dataGridRowId === resolvedActiveCell.rowId &&
        cell.dataset.dataGridColumnId === resolvedActiveCell.columnId,
    );
    target?.focus();
  }, [resolvedActiveCell]);

  const setColumnWidth = React.useCallback(
    (columnId: string, width: number) => {
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column) return;
      const nextWidths = {
        ...resolvedColumnWidths,
        [columnId]: clampDataGridColumnWidth(width, column),
      };
      if (columnWidths === undefined) setInternalColumnWidths(nextWidths);
      onColumnWidthsChange?.(nextWidths);
    },
    [columnWidths, columns, onColumnWidthsChange, resolvedColumnWidths],
  );

  const startResize = React.useCallback(
    (
      event: React.PointerEvent<HTMLButtonElement>,
      column: DataGridColumn<Row>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidth(column, resolvedColumnWidths[column.id]);
      const handleMove = (moveEvent: PointerEvent) => {
        setColumnWidth(column.id, startWidth + moveEvent.clientX - startX);
      };
      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
      };
      document.addEventListener("pointermove", handleMove);
      document.addEventListener("pointerup", handleUp, { once: true });
    },
    [resolvedColumnWidths, setColumnWidth],
  );

  const setSelected = React.useCallback(
    (nextRowIds: ReadonlySet<string>) => {
      if (selectedRowIds === undefined) setInternalSelectedRowIds(nextRowIds);
      onSelectedRowIdsChange?.(nextRowIds);
    },
    [onSelectedRowIdsChange, selectedRowIds],
  );

  const toggleRowSelection = React.useCallback(
    (rowId: string) => {
      if (selection === "none") return;
      const next = new Set(resolvedSelectedRowIds);
      if (selection === "single") {
        if (next.has(rowId)) next.clear();
        else {
          next.clear();
          next.add(rowId);
        }
      } else if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      setSelected(next);
    },
    [resolvedSelectedRowIds, selection, setSelected],
  );

  const toggleAllRows = React.useCallback(() => {
    if (selection !== "multiple") return;
    const allSelected =
      rows.length > 0 &&
      rows.every((row, rowIndex) =>
        resolvedSelectedRowIds.has(getRowId(row, rowIndex)),
      );
    setSelected(
      allSelected
        ? new Set()
        : new Set(rows.map((row, rowIndex) => getRowId(row, rowIndex))),
    );
  }, [getRowId, resolvedSelectedRowIds, rows, selection, setSelected]);

  const moveActiveCell = React.useCallback(
    (rowIndex: number, columnIndex: number, direction: DataGridDirection) => {
      if (rows.length === 0 || columns.length === 0) return;
      let nextRowIndex = rowIndex;
      let nextColumnIndex = columnIndex;
      if (direction === "up") nextRowIndex = Math.max(0, rowIndex - 1);
      if (direction === "down") {
        nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
      }
      if (direction === "left") {
        if (columnIndex > 0) nextColumnIndex = columnIndex - 1;
        else if (rowIndex > 0) {
          nextRowIndex = rowIndex - 1;
          nextColumnIndex = columns.length - 1;
        }
      }
      if (direction === "right") {
        if (columnIndex < columns.length - 1) nextColumnIndex = columnIndex + 1;
        else if (rowIndex < rows.length - 1) {
          nextRowIndex = rowIndex + 1;
          nextColumnIndex = 0;
        }
      }
      setActive({
        rowId: getRowId(rows[nextRowIndex], nextRowIndex),
        columnId: columns[nextColumnIndex].id,
        editing: false,
      });
    },
    [columns, getRowId, rows, setActive],
  );

  const commitCell = React.useCallback(
    (
      row: Row,
      rowIndex: number,
      column: DataGridColumn<Row>,
      value: unknown,
    ) => {
      onCellCommit?.({
        row,
        rowIndex,
        column,
        previousValue: column.getValue?.(row),
        value,
      });
    },
    [onCellCommit],
  );

  const slotContext: DataGridSlotContext<Row> = {
    rows,
    columns,
    columnWidths: resolvedColumnWidths,
    gridTemplateColumns,
    selection,
    selectedRowIds: resolvedSelectedRowIds,
    getRowId,
    setActiveCell: setActive,
    toggleRowSelection,
    resizeColumn: setColumnWidth,
  };

  const { className: scrollClassName, ...restScrollContainerProps } =
    scrollContainerProps ?? {};
  const loadingCount = Number.isFinite(loadingRowCount)
    ? Math.max(1, Math.floor(loadingRowCount))
    : 1;

  return (
    <div
      {...gridProps}
      ref={gridRef}
      role={gridProps.role ?? "grid"}
      className={cn("w-full min-w-0", className)}
      aria-busy={loading || undefined}
    >
      <div
        {...restScrollContainerProps}
        data-data-grid-scroll-container="true"
        className={cn(
          "w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain",
          scrollClassName,
        )}
      >
        <div className={cn("w-max min-w-full", contentClassName)}>
          {renderHeader ? (
            renderHeader(slotContext)
          ) : (
            <DataGridHeader
              columns={columns}
              gridTemplateColumns={gridTemplateColumns}
              selection={selection}
              rows={rows}
              getRowId={getRowId}
              selectedRowIds={resolvedSelectedRowIds}
              onToggleAll={toggleAllRows}
              onStartResize={startResize}
            />
          )}
          {renderBody
            ? renderBody(slotContext)
            : loading
              ? loadingRows({
                  count: loadingCount,
                  columns,
                  gridTemplateColumns,
                  selection,
                })
              : rows.length > 0
                ? rows.map((row, rowIndex) => {
                    const rowId = getRowId(row, rowIndex);
                    const rowContext: DataGridRowContext<Row> = {
                      ...slotContext,
                      row,
                      rowIndex,
                      rowId,
                      selected: resolvedSelectedRowIds.has(rowId),
                    };
                    if (renderRow) return renderRow(rowContext);
                    return (
                      <DataGridDefaultRow
                        key={rowId}
                        row={row}
                        rowIndex={rowIndex}
                        rowId={rowId}
                        columns={columns}
                        gridTemplateColumns={gridTemplateColumns}
                        selection={selection}
                        selected={rowContext.selected}
                        rowClassName={
                          typeof rowClassName === "function"
                            ? rowClassName(row, rowIndex)
                            : rowClassName
                        }
                        activeCell={resolvedActiveCell}
                        setActiveCell={setActive}
                        toggleRowSelection={toggleRowSelection}
                        moveActiveCell={moveActiveCell}
                        commitCell={commitCell}
                      />
                    );
                  })
                : emptyState}
          {renderFooter ? renderFooter(slotContext) : null}
        </div>
      </div>
    </div>
  );
}
