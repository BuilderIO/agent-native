import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowDown,
  IconArrowUp,
  IconColumns3,
  IconDatabaseOff,
  IconDotsVertical,
  IconEyeOff,
  IconListCheck,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  HEADER_HEIGHT,
  overlayProps,
  ROW_HEIGHT,
  SELECTION_RING_INSET,
  selectionCornerRadius,
} from "../shared/ui-tokens";
import { decodeTsv, encodeTsv } from "./clipboard";
import {
  AttributeTypeIcon,
  CellDisplay,
  CellEditor,
  ProvenanceMarker,
  RecordAvatar,
  type CrmAvatarShape,
} from "./GridCell";
import {
  cellSpecFor,
  copyCell,
  isCellEditable,
  isSuppressedDisplayNameCell,
  parseCell,
  type CrmCellValue,
  type CrmGridAttribute,
  type CrmGridRow,
} from "./model";
import {
  applyMove,
  isInRange,
  jumpCell,
  moveCell,
  pasteTargets,
  resolveGridKey,
  selectionRange,
  type CellRef,
  type GridDirection,
  type GridSelection,
} from "./navigation";
import {
  moveGridColumn,
  resolveGridColumns,
  setGridColumnHidden,
  setGridColumnWidth,
  type CrmGridColumn,
  type CrmGridSortEntry,
} from "./query";

const ICON_WIDTH = 36;
const NAME_WIDTH = 333;
const DEFAULT_WIDTH = 180;
/** Rows from the bottom of the loaded set at which the next page is requested. */
const PREFETCH_ROWS = 8;

/**
 * The frozen first columns. `clip-path` lets the blur spill to the right and
 * nowhere else — unclipped it bleeds over the header and the row below, which
 * reads as a smudge rather than a lifted edge.
 */
const STICKY_FLAT: React.CSSProperties = {
  clipPath: "inset(0 -38px 0 0)",
  boxShadow: "none",
  transition: "box-shadow var(--motion-breezy) ease-in-out",
};
const STICKY_SCROLLED: React.CSSProperties = {
  ...STICKY_FLAT,
  boxShadow: "var(--crm-shadow-sticky)",
};

export interface CrmGridCommit {
  row: CrmGridRow;
  attribute: CrmGridAttribute;
  value: CrmCellValue;
}

export interface CrmGridProps {
  attributes: CrmGridAttribute[];
  rows: CrmGridRow[];
  columns: CrmGridColumn[];
  onColumnsChange: (next: CrmGridColumn[]) => void;
  sort: CrmGridSortEntry[];
  onSortChange: (next: CrmGridSortEntry[]) => void;
  isLoading: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  /** Header for the fixed record-name column. */
  nameLabel: string;
  /** The object's own glyph, shown in the icon column until the row is hovered. */
  objectIcon?: React.ComponentType<{ className?: string }>;
  /** Avatar shape for this object type: round is a person, squircle is not. */
  avatarShape?: CrmAvatarShape;
  /** Href for one row's record page; the name column links to it when given. */
  rowHref?: (row: CrmGridRow) => string;
  onCommitCell: (commit: CrmGridCommit) => Promise<void>;
  onAddAttribute?: () => void;
  onAddToList?: (rowIds: string[]) => void;
  onDeleteRows?: (rowIds: string[]) => Promise<void>;
  now?: Date;
}

function sameValue(a: CrmCellValue, b: CrmCellValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function CrmGrid(props: CrmGridProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [editing, setEditing] = useState<{
    ref: CellRef;
    seed?: string;
  } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Drives the frozen-column shadow. It exists only once there is something
  // hidden underneath the frozen columns.
  const [scrolled, setScrolled] = useState(false);

  const ordered = useMemo(
    () => resolveGridColumns(props.columns, props.attributes),
    [props.columns, props.attributes],
  );
  const visible = useMemo(
    () =>
      ordered
        .filter((column) => !column.hidden)
        .flatMap((column) => {
          const attribute = props.attributes.find(
            (candidate) => candidate.apiSlug === column.attributeId,
          );
          return attribute ? [{ column, attribute }] : [];
        }),
    [ordered, props.attributes],
  );
  const bounds = { rows: props.rows.length, cols: visible.length };

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  const commit = useCallback(
    async (ref: CellRef, raw: CrmCellValue, isRawText: boolean) => {
      const row = props.rows[ref.row];
      const target = visible[ref.col];
      if (!row || !target) return false;
      const { attribute } = target;
      let value: CrmCellValue;
      if (isRawText) {
        const parsed = parseCell(attribute, String(raw ?? ""));
        if (!parsed.ok) {
          toast.error(
            t(`grid.parse.${parsed.reason}`, {
              attribute: attribute.label,
              value: parsed.detail ?? "",
            }),
          );
          return false;
        }
        value = parsed.value;
      } else {
        value = raw;
      }
      if (sameValue(row.values[attribute.apiSlug] ?? null, value)) return true;
      await props.onCommitCell({ row, attribute, value });
      return true;
    },
    [props.rows, props.onCommitCell, t, visible],
  );

  // -------------------------------------------------------------------------
  // Clipboard
  // -------------------------------------------------------------------------

  function selectionTsv(): string {
    if (!selection) return "";
    const range = selectionRange(selection);
    const grid: string[][] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      const cells: string[] = [];
      for (let col = range.left; col <= range.right; col++) {
        const target = visible[col];
        const record = props.rows[row];
        cells.push(
          target && record
            ? copyCell(
                target.attribute,
                record.values[target.attribute.apiSlug] ?? null,
              )
            : "",
        );
      }
      grid.push(cells);
    }
    return encodeTsv(grid);
  }

  async function pasteTsv(text: string) {
    if (!selection) return;
    const cells = decodeTsv(text);
    if (!cells.length) return;
    const range = pasteTargets({
      selection,
      bounds,
      rows: cells.length,
      cols: Math.max(...cells.map((row) => row.length)),
    });
    let written = 0;
    let skipped = 0;
    for (let row = range.top; row <= range.bottom; row++) {
      for (let col = range.left; col <= range.right; col++) {
        const source =
          cells[(row - range.top) % cells.length]?.[
            (col - range.left) % Math.max(1, cells[0]?.length ?? 1)
          ];
        if (source === undefined) continue;
        const target = visible[col];
        if (!target || !isCellEditable(target.attribute)) {
          skipped += 1;
          continue;
        }
        const ok = await commit({ row, col }, source, true);
        if (ok) written += 1;
        else skipped += 1;
      }
    }
    if (written) toast.success(t("grid.pasteApplied", { count: written }));
    if (skipped) toast.error(t("grid.pasteSkipped", { count: skipped }));
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  function onKeyDown(event: React.KeyboardEvent) {
    if (!selection) return;
    const intent = resolveGridKey(event, { editing: Boolean(editing) });
    if (!intent) return;
    // Copy and paste stay native so the browser's own clipboard events fire.
    if (intent.type === "copy" || intent.type === "paste") return;
    event.preventDefault();
    const focus = selection.focus;
    if (intent.type === "move") {
      setSelection(
        applyMove(
          selection,
          moveCell(focus, intent.direction, bounds),
          intent.extend,
        ),
      );
      return;
    }
    if (intent.type === "jump") {
      setSelection(
        applyMove(
          selection,
          jumpCell(focus, intent.edge, bounds),
          intent.extend,
        ),
      );
      return;
    }
    if (intent.type === "selectAll") {
      setSelection({
        anchor: { row: 0, col: 0 },
        focus: { row: bounds.rows - 1, col: bounds.cols - 1 },
      });
      return;
    }
    if (intent.type === "edit" || intent.type === "type") {
      const target = visible[focus.col];
      if (!target || !isCellEditable(target.attribute)) {
        toast.error(
          t("grid.cellReadOnly", { attribute: target?.attribute.label ?? "" }),
        );
        return;
      }
      setEditing({
        ref: focus,
        ...(intent.type === "type" ? { seed: intent.text } : {}),
      });
      return;
    }
    if (intent.type === "cancel") {
      setEditing(null);
      return;
    }
    if (intent.type === "clear") {
      const range = selectionRange(selection);
      void (async () => {
        for (let row = range.top; row <= range.bottom; row++) {
          for (let col = range.left; col <= range.right; col++) {
            const target = visible[col];
            if (!target || !isCellEditable(target.attribute)) continue;
            await commit({ row, col }, null, false);
          }
        }
      })();
    }
  }

  async function commitFromEditor(
    raw: CrmCellValue,
    isRawText: boolean,
    direction?: GridDirection,
  ) {
    if (!editing) return;
    const ref = editing.ref;
    setEditing(null);
    const ok = await commit(ref, raw, isRawText);
    // A rejected value keeps the caret where the user can fix it; only a
    // committed one advances.
    if (ok && direction && selection) {
      setSelection(
        applyMove(selection, moveCell(ref, direction, bounds), false),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Columns
  // -------------------------------------------------------------------------

  function toggleSort(attribute: CrmGridAttribute) {
    const current = props.sort[0];
    const isCurrent = current?.attributeId === attribute.apiSlug;
    if (!isCurrent) {
      props.onSortChange([
        { attributeId: attribute.apiSlug, direction: "asc" },
      ]);
      return;
    }
    props.onSortChange(
      current?.direction === "asc"
        ? [{ attributeId: attribute.apiSlug, direction: "desc" }]
        : [],
    );
  }

  const columnDefs = useMemo<ColumnDef<CrmGridRow>[]>(
    () =>
      visible.map(({ column, attribute }) => ({
        id: attribute.apiSlug,
        size:
          column.width ?? cellSpecFor(attribute).defaultWidth ?? DEFAULT_WIDTH,
        header: attribute.label,
        accessorFn: (row: CrmGridRow) => row.values[attribute.apiSlug] ?? null,
      })),
    [visible],
  );

  const table = useReactTable({
    data: props.rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    getRowId: (row) => row.id,
    onColumnSizingChange: (updater) => {
      const current = Object.fromEntries(
        visible.map(({ column, attribute }) => [
          attribute.apiSlug,
          column.width ?? cellSpecFor(attribute).defaultWidth ?? DEFAULT_WIDTH,
        ]),
      );
      const next = typeof updater === "function" ? updater(current) : updater;
      let columns = props.columns.length ? props.columns : ordered;
      for (const [attributeId, width] of Object.entries(next)) {
        if (current[attributeId] === width) continue;
        columns = setGridColumnWidth(
          columns.some((entry) => entry.attributeId === attributeId)
            ? columns
            : [...columns, { attributeId }],
          attributeId,
          width as number,
        );
      }
      props.onColumnsChange(columns);
    },
  });

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  const virtualizer = useVirtualizer({
    count: props.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastVisible = virtualRows[virtualRows.length - 1]?.index ?? 0;
  const { hasNextPage, isFetchingNextPage, onLoadMore } = props;
  const rowCount = props.rows.length;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || rowCount === 0) return;
    if (lastVisible >= rowCount - PREFETCH_ROWS) onLoadMore?.();
  }, [hasNextPage, isFetchingNextPage, lastVisible, onLoadMore, rowCount]);

  const totalWidth =
    ICON_WIDTH +
    NAME_WIDTH +
    visible.reduce(
      (sum, { column, attribute }) =>
        sum +
        (column.width ?? cellSpecFor(attribute).defaultWidth ?? DEFAULT_WIDTH),
      0,
    );
  const stickyStyle = scrolled ? STICKY_SCROLLED : STICKY_FLAT;
  const frozenWidth = ICON_WIDTH + NAME_WIDTH;
  const ObjectIcon = props.objectIcon;
  const avatarShape = props.avatarShape ?? "company";

  function toggleRow(rowId: string) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  if (props.error) {
    return (
      <GridMessage
        icon={<IconRefresh className="size-5" />}
        title={t("grid.errorTitle")}
        description={
          props.error instanceof Error
            ? props.error.message
            : t("grid.errorDescription")
        }
        action={
          props.onRetry ? (
            <Button variant="outline" size="sm" onClick={props.onRetry}>
              {t("grid.retry")}
            </Button>
          ) : null
        }
      />
    );
  }

  if (props.isLoading && props.rows.length === 0) {
    return (
      <div className="grid gap-px">
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton
            key={index}
            className="w-full rounded-none"
            style={{ height: ROW_HEIGHT - 1 }}
          />
        ))}
      </div>
    );
  }

  if (props.rows.length === 0) {
    return (
      <GridMessage
        icon={<IconDatabaseOff className="size-5" />}
        title={props.emptyTitle}
        description={props.emptyDescription ?? t("grid.emptyDescription")}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={(event) => {
          const text = selectionTsv();
          if (!text) return;
          event.preventDefault();
          event.clipboardData.setData("text/plain", text);
        }}
        onPaste={(event) => {
          if (!selection) return;
          const text = event.clipboardData.getData("text/plain");
          if (!text) return;
          event.preventDefault();
          void pasteTsv(text);
        }}
        onScroll={(event) => {
          const next = event.currentTarget.scrollLeft > 0;
          setScrolled((current) => (current === next ? current : next));
        }}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div style={{ width: totalWidth, minWidth: "100%" }}>
          <div
            className="sticky top-0 z-20 flex items-stretch border-y border-hairline bg-background"
            style={{ height: HEADER_HEIGHT }}
          >
            <div
              className="sticky left-0 z-20 flex shrink-0 items-stretch bg-background"
              style={{ ...stickyStyle, width: frozenWidth }}
            >
              <div
                className="flex shrink-0 items-center justify-center"
                style={{ width: ICON_WIDTH }}
              >
                <Checkbox
                  checked={
                    selectedRows.size > 0 &&
                    selectedRows.size === props.rows.length
                  }
                  onCheckedChange={(next) =>
                    setSelectedRows(
                      next === true
                        ? new Set(props.rows.map((row) => row.id))
                        : new Set(),
                    )
                  }
                  aria-label={t("grid.selectAllRows")}
                />
              </div>
              <div
                className="flex shrink-0 items-center gap-1.5 border-l border-hairline px-3 text-sm font-medium text-content-secondary"
                style={{ width: NAME_WIDTH }}
              >
                <span className="min-w-0 truncate">{props.nameLabel}</span>
                {/* The add-column affordance rides the primary column, not the
                    far right of a header row that can be scrolled off-screen. */}
                <ColumnPicker
                  attributes={props.attributes}
                  columns={ordered}
                  onColumnsChange={props.onColumnsChange}
                  {...(props.onAddAttribute
                    ? { onAddAttribute: props.onAddAttribute }
                    : {})}
                />
              </div>
            </div>
            {table.getHeaderGroups()[0]?.headers.map((header, index) => {
              const attribute = visible[index]?.attribute;
              if (!attribute) return null;
              const sorted = props.sort.find(
                (entry) => entry.attributeId === attribute.apiSlug,
              );
              return (
                <div
                  key={header.id}
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", attribute.apiSlug)
                  }
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const moved = event.dataTransfer.getData("text/plain");
                    if (moved && moved !== attribute.apiSlug) {
                      props.onColumnsChange(
                        moveGridColumn(ordered, moved, index),
                      );
                    }
                  }}
                  style={{ width: header.getSize() }}
                  className="group/header relative flex shrink-0 items-center gap-1 border-l border-hairline px-3 text-sm font-medium text-content-secondary"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(attribute)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-foreground"
                  >
                    <AttributeTypeIcon
                      type={attribute.attributeType}
                      className="size-4 shrink-0 text-content-ghost"
                    />
                    <span className="min-w-0 truncate">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </span>
                    {sorted?.direction === "asc" ? (
                      <IconArrowUp className="size-3.5 shrink-0" />
                    ) : sorted?.direction === "desc" ? (
                      <IconArrowDown className="size-3.5 shrink-0" />
                    ) : null}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("grid.columnOptions", {
                          attribute: attribute.label,
                        })}
                        className="shrink-0 cursor-pointer opacity-0 transition-opacity group-hover/header:opacity-100 focus-visible:opacity-100"
                      >
                        <IconDotsVertical className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          props.onColumnsChange(
                            setGridColumnHidden(
                              ordered,
                              attribute.apiSlug,
                              true,
                            ),
                          )
                        }
                      >
                        <IconEyeOff className="size-4" /> {t("grid.hideColumn")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    className="absolute -right-[3px] top-0 z-10 flex h-full w-1.5 cursor-col-resize touch-none select-none justify-center"
                  >
                    {/* The 100ms delay before the handle appears is deliberate:
                        without it, dragging a pointer across the header row
                        strobes a handle at every column boundary. */}
                    <span
                      className={cn(
                        "h-full w-0.5 rounded-[3px] bg-[hsl(var(--crm-accent))] opacity-0 transition-opacity duration-100 delay-100 group-hover/header:opacity-100",
                        header.column.getIsResizing() && "opacity-100",
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualRows.map((virtualRow) => {
              const row = props.rows[virtualRow.index];
              if (!row) return null;
              const range = selection ? selectionRange(selection) : null;
              const rowSelected = selectedRows.has(row.id);
              return (
                <div
                  key={row.id}
                  {...overlayProps({
                    selected: rowSelected,
                    className:
                      "group/row absolute left-0 flex items-stretch border-b border-hairline",
                  })}
                  style={{
                    top: virtualRow.start,
                    height: ROW_HEIGHT,
                    width: totalWidth,
                    minWidth: "100%",
                  }}
                >
                  {/* The frozen columns paint their own background, so the row's
                      overlay cannot reach them — they carry a second one driven
                      by the row's hover instead of a background swap. */}
                  <div
                    {...overlayProps({
                      selected: rowSelected,
                      className: cn(
                        "sticky left-0 z-20 flex shrink-0 items-stretch bg-background",
                        // Selection already owns the overlay at a stronger
                        // alpha; letting hover win would lighten it.
                        !rowSelected &&
                          "group-hover/row:before:opacity-[var(--crm-overlay-hover)]",
                      ),
                    })}
                    style={{ ...stickyStyle, width: frozenWidth }}
                  >
                    <div
                      className="relative flex shrink-0 items-center justify-center"
                      style={{ width: ICON_WIDTH }}
                    >
                      {rowSelected || !ObjectIcon ? (
                        <Checkbox
                          checked={rowSelected}
                          onCheckedChange={() => toggleRow(row.id)}
                          aria-label={t("grid.selectRow", {
                            name: row.displayName,
                          })}
                        />
                      ) : (
                        <>
                          <ObjectIcon className="size-4 text-content-tertiary transition-opacity group-hover/row:opacity-0" />
                          <Checkbox
                            checked={false}
                            onCheckedChange={() => toggleRow(row.id)}
                            aria-label={t("grid.selectRow", {
                              name: row.displayName,
                            })}
                            className="absolute inset-0 m-auto opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
                          />
                        </>
                      )}
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-2 overflow-hidden border-l border-hairline px-3 text-sm font-medium"
                      style={{ width: NAME_WIDTH }}
                    >
                      <RecordAvatar
                        name={row.displayName}
                        shape={avatarShape}
                      />
                      {props.rowHref ? (
                        <Link
                          to={props.rowHref(row)}
                          className="min-w-0 truncate rounded-sm underline decoration-transparent underline-offset-[0.14em] outline-none transition-colors hover:decoration-content-ghost focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {row.displayName}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate">
                          {row.displayName}
                        </span>
                      )}
                    </div>
                  </div>
                  {visible.map(({ column, attribute }, colIndex) => {
                    const ref = { row: virtualRow.index, col: colIndex };
                    const active =
                      selection?.focus.row === ref.row &&
                      selection.focus.col === ref.col;
                    const inRange = range ? isInRange(range, ref) : false;
                    const isEditing =
                      editing?.ref.row === ref.row &&
                      editing.ref.col === ref.col;
                    const spec = cellSpecFor(attribute);
                    // A range is outlined once, not per cell: each cell draws
                    // only the segments that sit on the range's boundary, and a
                    // corner rounds only where two of them meet.
                    const edges = range
                      ? {
                          top: ref.row === range.top,
                          right: ref.col === range.right,
                          bottom: ref.row === range.bottom,
                          left: ref.col === range.left,
                        }
                      : null;
                    return (
                      <div
                        key={attribute.apiSlug}
                        role="gridcell"
                        tabIndex={-1}
                        onMouseDown={(event) => {
                          if (event.shiftKey && selection) {
                            event.preventDefault();
                            setSelection({
                              anchor: selection.anchor,
                              focus: ref,
                            });
                            return;
                          }
                          setSelection({ anchor: ref, focus: ref });
                          setEditing(null);
                        }}
                        onDoubleClick={() => {
                          if (isCellEditable(attribute)) setEditing({ ref });
                        }}
                        style={{
                          width:
                            column.width ?? spec.defaultWidth ?? DEFAULT_WIDTH,
                        }}
                        {...overlayProps({
                          selected: inRange && !active,
                          soft: true,
                          className: cn(
                            "relative flex shrink-0 items-start border-l border-hairline px-3 pt-2 text-sm",
                            !isCellEditable(attribute) &&
                              "text-content-tertiary",
                            // The ring overhangs the shared divider by 1px, so
                            // the cell has to paint above its neighbours or the
                            // next cell's border repaints over it.
                            inRange && "z-[1]",
                            isEditing && "z-[2] bg-background p-0",
                          ),
                        })}
                      >
                        {inRange && edges ? (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute z-[2] border-[hsl(var(--crm-accent))]"
                            style={{
                              inset: SELECTION_RING_INSET,
                              borderTopWidth: edges.top ? 1 : 0,
                              borderRightWidth: edges.right ? 1 : 0,
                              borderBottomWidth: edges.bottom ? 1 : 0,
                              borderLeftWidth: edges.left ? 1 : 0,
                              borderRadius: selectionCornerRadius(edges),
                            }}
                          />
                        ) : null}
                        {isEditing ? (
                          <CellEditor
                            attribute={attribute}
                            value={row.values[attribute.apiSlug] ?? null}
                            {...(editing?.seed !== undefined
                              ? { seed: editing.seed }
                              : {})}
                            onCommit={(raw, isRawText, direction) =>
                              void commitFromEditor(
                                raw as CrmCellValue,
                                isRawText,
                                direction,
                              )
                            }
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <>
                            {/* One 20px line box, so a chip, a checkbox and a
                                line of text all sit on the same baseline under
                                the cell's 8px top padding. */}
                            <span
                              className={cn(
                                "flex min-h-5 w-full min-w-0 items-center overflow-hidden",
                                spec.align === "right" &&
                                  "justify-end tabular-nums",
                                spec.align === "center" && "justify-center",
                              )}
                            >
                              <CellDisplay
                                attribute={attribute}
                                // A displayName that only duplicates this row's
                                // name is hidden here, not dropped from the row:
                                // an absent name must still show its own value.
                                value={
                                  isSuppressedDisplayNameCell(
                                    attribute.apiSlug,
                                    row.values,
                                  )
                                    ? null
                                    : (row.values[attribute.apiSlug] ?? null)
                                }
                                {...(row.valuesSince?.[attribute.apiSlug]
                                  ? {
                                      since: row.valuesSince[attribute.apiSlug],
                                    }
                                  : {})}
                                {...(props.now ? { now: props.now } : {})}
                              />
                            </span>
                            <ProvenanceMarker
                              provenance={row.provenance?.[attribute.apiSlug]}
                              attributeLabel={attribute.label}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {props.isFetchingNextPage ? (
            <div
              className="sticky left-0 flex items-center px-3 text-sm text-content-tertiary"
              style={{ height: ROW_HEIGHT }}
            >
              {t("grid.loadingMore")}
            </div>
          ) : null}
        </div>
      </div>

      {selectedRows.size > 0 ? (
        <BulkBar
          count={selectedRows.size}
          attributes={props.attributes.filter(isCellEditable)}
          onClear={() => setSelectedRows(new Set())}
          {...(props.onAddToList
            ? { onAddToList: () => props.onAddToList?.([...selectedRows]) }
            : {})}
          {...(props.onDeleteRows
            ? { onDelete: () => setConfirmDelete(true) }
            : {})}
          onApply={async (attribute, text) => {
            const parsed = parseCell(attribute, text);
            if (!parsed.ok) {
              toast.error(
                t(`grid.parse.${parsed.reason}`, {
                  attribute: attribute.label,
                  value: parsed.detail ?? "",
                }),
              );
              return;
            }
            const targets = props.rows.filter((row) =>
              selectedRows.has(row.id),
            );
            for (const row of targets) {
              await props.onCommitCell({ row, attribute, value: parsed.value });
            }
            toast.success(t("grid.bulkApplied", { count: targets.length }));
          }}
        />
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("grid.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("grid.deleteDescription", { count: selectedRows.size })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("grid.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ids = [...selectedRows];
                setConfirmDelete(false);
                void props
                  .onDeleteRows?.(ids)
                  .then(() => setSelectedRows(new Set()))
                  .catch((error: unknown) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : t("grid.deleteFailed"),
                    ),
                  );
              }}
            >
              {t("grid.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GridMessage({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[320px] place-items-center p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
        <h2 className="mt-4 text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

function ColumnPicker({
  attributes,
  columns,
  onColumnsChange,
  onAddAttribute,
}: {
  attributes: CrmGridAttribute[];
  columns: CrmGridColumn[];
  onColumnsChange: (next: CrmGridColumn[]) => void;
  onAddAttribute?: () => void;
}) {
  const t = useT();
  const hidden = new Set(
    columns
      .filter((column) => column.hidden)
      .map((column) => column.attributeId),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("grid.configureColumns")}
          className="ml-auto grid size-5 shrink-0 cursor-pointer place-items-center rounded-badge text-content-ghost transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <IconPlus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-56 overflow-y-auto"
      >
        <DropdownMenuLabel className="flex items-center gap-2">
          <IconColumns3 className="size-4" /> {t("grid.columns")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {attributes.map((attribute) => (
          <DropdownMenuCheckboxItem
            key={attribute.apiSlug}
            checked={!hidden.has(attribute.apiSlug)}
            onCheckedChange={(checked) =>
              onColumnsChange(
                setGridColumnHidden(columns, attribute.apiSlug, !checked),
              )
            }
          >
            {attribute.label}
          </DropdownMenuCheckboxItem>
        ))}
        {onAddAttribute ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAddAttribute}>
              <IconPlus className="size-4" /> {t("grid.addAttribute")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BulkBar({
  count,
  attributes,
  onApply,
  onAddToList,
  onDelete,
  onClear,
}: {
  count: number;
  attributes: CrmGridAttribute[];
  onApply: (attribute: CrmGridAttribute, value: string) => Promise<void>;
  onAddToList?: () => void;
  onDelete?: () => void;
  onClear: () => void;
}) {
  const t = useT();
  const [attributeSlug, setAttributeSlug] = useState("");
  const [value, setValue] = useState("");
  const attribute = attributes.find(
    (candidate) => candidate.apiSlug === attributeSlug,
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-background/95 py-1.5 pl-4 pr-2 shadow-e2 backdrop-blur">
        <span className="text-sm font-medium">
          {t("grid.selectedCount", { count })}
        </span>
        <span className="h-4 w-px bg-hairline" />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              {t("grid.bulkEdit")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="center" className="w-72 space-y-2">
            <select
              value={attributeSlug}
              onChange={(event) => setAttributeSlug(event.target.value)}
              aria-label={t("grid.bulkAttribute")}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("grid.bulkChooseAttribute")}</option>
              {attributes.map((candidate) => (
                <option key={candidate.apiSlug} value={candidate.apiSlug}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t("grid.bulkValue")}
            />
            <Button
              size="sm"
              className="w-full"
              disabled={!attribute}
              onClick={() => {
                if (attribute) void onApply(attribute, value);
              }}
            >
              {t("grid.bulkApply", { count })}
            </Button>
          </PopoverContent>
        </Popover>
        {onAddToList ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={onAddToList}
          >
            <IconListCheck className="size-4" /> {t("grid.addToList")}
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <IconTrash className="size-4" /> {t("grid.delete")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t("grid.clearSelection")}
          onClick={onClear}
        >
          <IconX className="size-4" />
        </Button>
      </div>
    </div>
  );
}
