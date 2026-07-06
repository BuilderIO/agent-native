import { useT } from "@agent-native/core/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconCircleX,
  IconCopy,
  IconTableColumn,
  IconTableRow,
  IconTrash,
} from "@tabler/icons-react";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { findTable } from "@tiptap/pm/tables";
import { Editor } from "@tiptap/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";

interface TableHoverControlsProps {
  editor: Editor;
}

type ResizeKind = "column" | "row";

interface PointerResizeState {
  didResize: boolean;
  kind: ResizeKind;
  startX: number;
  startY: number;
  table: HTMLElement;
  tableRect: DOMRect;
  baseRowCount: number;
  baseColumnCount: number;
  lastTarget: number;
}

interface HoveredTableEdges {
  columnTable: HTMLElement | null;
  rowTable: HTMLElement | null;
}

interface SelectedCellAddress {
  columnIndex: number;
  rowIndex: number;
  tableIndex: number;
}

interface SelectionOverlayRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

const DRAG_THRESHOLD = 5;
const MAX_DRAG_COLUMNS = 12;
const MAX_DRAG_ROWS = 24;
const TABLE_HANDLE_HIT_PADDING = 8;
const AXIS_OPTIONS_MARKER_THICKNESS = 2;
const EDGE_HANDLE_THICKNESS = 3;
const COLUMN_OPTIONS_MARKER_WIDTH = "2rem";
const COLUMN_OPTIONS_MARKER_WIDTH_PX = 32;
const COLUMN_OPTIONS_HIT_WIDTH =
  COLUMN_OPTIONS_MARKER_WIDTH_PX + TABLE_HANDLE_HIT_PADDING * 2;
const COLUMN_OPTIONS_HIT_HEIGHT =
  AXIS_OPTIONS_MARKER_THICKNESS + TABLE_HANDLE_HIT_PADDING * 2;
const COLUMN_OPTIONS_MENU_ALIGN_OFFSET = COLUMN_OPTIONS_HIT_WIDTH / 2;
const COLUMN_OPTIONS_MENU_WIDTH = 176;
const ROW_OPTIONS_MARKER_HEIGHT = "2rem";
const ROW_OPTIONS_MARKER_HEIGHT_PX = 32;
const ROW_OPTIONS_HIT_WIDTH =
  AXIS_OPTIONS_MARKER_THICKNESS + TABLE_HANDLE_HIT_PADDING * 2;
const ROW_OPTIONS_HIT_HEIGHT =
  ROW_OPTIONS_MARKER_HEIGHT_PX + TABLE_HANDLE_HIT_PADDING * 2;
const ROW_OPTIONS_MENU_ALIGN_OFFSET = ROW_OPTIONS_HIT_HEIGHT / 2;
const ROW_OPTIONS_MENU_HEIGHT = 260;
const EDGE_HANDLE_LENGTH = 56;
const COLUMN_EDGE_HANDLE_HIT_WIDTH =
  EDGE_HANDLE_THICKNESS + TABLE_HANDLE_HIT_PADDING * 2;
const COLUMN_EDGE_HANDLE_HIT_HEIGHT =
  EDGE_HANDLE_LENGTH + TABLE_HANDLE_HIT_PADDING * 2;
const ROW_EDGE_HANDLE_HIT_WIDTH =
  EDGE_HANDLE_LENGTH + TABLE_HANDLE_HIT_PADDING * 2;
const ROW_EDGE_HANDLE_HIT_HEIGHT =
  EDGE_HANDLE_THICKNESS + TABLE_HANDLE_HIT_PADDING * 2;
const EDGE_HANDLE_TOOLTIP_DELAY = 350;
const MENU_COLLISION_PADDING = 8;

const menuIconClass = "size-4 shrink-0 text-muted-foreground";

function getRows(table: HTMLElement) {
  return Array.from(table.querySelectorAll("tr")) as HTMLTableRowElement[];
}

function getCells(row: HTMLTableRowElement | null | undefined) {
  return row
    ? (Array.from(row.querySelectorAll("td, th")) as HTMLElement[])
    : [];
}

function getTableDimensions(table: HTMLElement) {
  const rows = getRows(table);
  return {
    rowCount: rows.length,
    columnCount: getCells(rows[0]).length,
  };
}

function getLastColumnCell(table: HTMLElement) {
  const firstRow = getRows(table)[0];
  const cells = getCells(firstRow);
  return cells[cells.length - 1] ?? null;
}

function getLastRowCell(table: HTMLElement) {
  const rows = getRows(table);
  const cells = getCells(rows[rows.length - 1]);
  return cells[0] ?? null;
}

function getCellAddress(editor: Editor, cell: HTMLElement) {
  const table = cell.closest("table") as HTMLElement | null;
  const row = cell.closest("tr") as HTMLTableRowElement | null;
  if (!table || !row) return null;

  const tables = Array.from(
    editor.view.dom.querySelectorAll("table"),
  ) as HTMLElement[];
  const tableIndex = tables.indexOf(table);
  const rowIndex = getRows(table).indexOf(row);
  const columnIndex = getCells(row).indexOf(cell);

  if (tableIndex < 0 || rowIndex < 0 || columnIndex < 0) return null;

  return { columnIndex, rowIndex, tableIndex };
}

function getCellAtAddress(
  tables: HTMLElement[],
  address: SelectedCellAddress | null,
) {
  if (!address) return null;

  const table = tables[address.tableIndex];
  const row = table ? getRows(table)[address.rowIndex] : null;
  return getCells(row)[address.columnIndex] ?? null;
}

function getSelectionOverlayRect(rects: DOMRect[]) {
  if (rects.length === 0) return null;

  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    height: bottom - top,
    left,
    top,
    width: right - left,
  } satisfies SelectionOverlayRect;
}

function getRowSelectionOverlayRect(
  table: HTMLElement,
  address: SelectedCellAddress | null,
) {
  if (!address) return null;

  return getSelectionOverlayRect(
    getCells(getRows(table)[address.rowIndex]).map((cell) =>
      cell.getBoundingClientRect(),
    ),
  );
}

function getColumnSelectionOverlayRect(
  table: HTMLElement,
  address: SelectedCellAddress | null,
) {
  if (!address) return null;

  return getSelectionOverlayRect(
    getRows(table)
      .map((row) => getCells(row)[address.columnIndex])
      .filter((cell): cell is HTMLElement => Boolean(cell))
      .map((cell) => cell.getBoundingClientRect()),
  );
}

function getChildren(node: ProseMirrorNode) {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

function findTableNodeByIndex(
  doc: ProseMirrorNode,
  tableIndex: number,
): { node: ProseMirrorNode; pos: number } | null {
  let currentIndex = -1;
  let result: { node: ProseMirrorNode; pos: number } | null = null;

  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;

    currentIndex += 1;
    if (currentIndex === tableIndex) {
      result = { node, pos };
      return false;
    }

    return true;
  });

  return result;
}

function copyNode(node: ProseMirrorNode) {
  return node.copy(node.content);
}

function createEmptyCell(editor: Editor, cell: ProseMirrorNode) {
  const paragraph = editor.schema.nodes.paragraph.create();
  return cell.type.create(cell.attrs, Fragment.from(paragraph), cell.marks);
}

function isHeaderCellNode(cell: ProseMirrorNode | undefined) {
  return cell?.type.name === "tableHeader";
}

function hasHeaderRowAtAddress(
  doc: ProseMirrorNode,
  address: SelectedCellAddress | null,
) {
  if (!address) return false;

  const table = findTableNodeByIndex(doc, address.tableIndex);
  const firstRow = table ? getChildren(table.node)[0] : null;
  const cells = firstRow ? getChildren(firstRow) : [];
  return cells.length > 0 && cells.every(isHeaderCellNode);
}

function hasHeaderColumnAtAddress(
  doc: ProseMirrorNode,
  address: SelectedCellAddress | null,
) {
  if (!address) return false;

  const table = findTableNodeByIndex(doc, address.tableIndex);
  const rows = table ? getChildren(table.node) : [];
  return (
    rows.length > 0 &&
    rows.every((row) => isHeaderCellNode(getChildren(row)[0]))
  );
}

function getTargetElement(target: EventTarget | null) {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function getMountedEditorView(editor: Editor) {
  if (!editor || editor.isDestroyed) return null;
  try {
    const view = editor.view;
    return view.dom.isConnected ? view : null;
  } catch {
    return null;
  }
}

function getHoveredTableEdges(editor: Editor, target: EventTarget | null) {
  const view = getMountedEditorView(editor);
  if (!view) {
    return { columnTable: null, rowTable: null };
  }

  const targetElement = getTargetElement(target);
  if (!targetElement) {
    return { columnTable: null, rowTable: null };
  }

  const cell = targetElement.closest("td, th") as HTMLElement | null;
  if (!cell || !view.dom.contains(cell)) {
    return { columnTable: null, rowTable: null };
  }

  const table = cell.closest("table") as HTMLElement | null;
  const row = cell.closest("tr") as HTMLTableRowElement | null;
  if (!table || !row) {
    return { columnTable: null, rowTable: null };
  }

  const rows = getRows(table);
  const rowCells = getCells(row);
  const isLastColumn = rowCells[rowCells.length - 1] === cell;
  const isLastRow = rows[rows.length - 1] === row;

  return {
    columnTable: isLastColumn ? table : null,
    rowTable: isLastRow ? table : null,
  };
}

function getCellFromEditorSelection(editor: Editor) {
  try {
    const view = getMountedEditorView(editor);
    if (!view) return null;
    const { node } = view.domAtPos(editor.state.selection.from);
    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    return (element?.closest("td, th") as HTMLElement | null) ?? null;
  } catch {
    return null;
  }
}

function isTableUiTarget(target: Element) {
  return !!target.closest(
    "table, [data-table-edge-control], .notion-table-axis-trigger, [role='menu']",
  );
}

const tableOverlayIds = new WeakMap<HTMLElement, string>();

function getTableOverlayId(table: HTMLElement) {
  const existing = tableOverlayIds.get(table);
  if (existing) return existing;

  const id =
    globalThis.crypto?.randomUUID?.() ??
    `table-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tableOverlayIds.set(table, id);
  return id;
}

export function TableHoverControls({ editor }: TableHoverControlsProps) {
  const t = useT();
  const selectedCellRef = useRef<HTMLElement | null>(null);
  const selectedCellAddressRef = useRef<SelectedCellAddress | null>(null);
  const selectedCellRectRef = useRef<DOMRect | null>(null);
  const selectedTableRectRef = useRef<DOMRect | null>(null);
  const selectedCellStateRef = useRef<HTMLElement | null>(null);
  const tableUiPointerDownRef = useRef(false);
  const hoveredEdgesRef = useRef<HoveredTableEdges>({
    columnTable: null,
    rowTable: null,
  });
  const pointerResizeRef = useRef<PointerResizeState | null>(null);
  const tablesRef = useRef<HTMLElement[]>([]);
  const [tables, setTables] = useState<HTMLElement[]>([]);
  const [selectedCell, setSelectedCell] = useState<HTMLElement | null>(null);
  const [hoveredEdges, setHoveredEdges] = useState<HoveredTableEdges>({
    columnTable: null,
    rowTable: null,
  });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const [viewRetry, setViewRetry] = useState(0);

  const holdTableUiSelection = () => {
    tableUiPointerDownRef.current = true;
    window.setTimeout(() => {
      tableUiPointerDownRef.current = false;
    }, 350);
  };

  const closeTableMenus = () => {
    tableUiPointerDownRef.current = false;
    setColumnMenuOpen(false);
    setRowMenuOpen(false);
  };

  const clearSelectedCell = () => {
    closeTableMenus();
    selectedCellRef.current = null;
    selectedCellAddressRef.current = null;
    selectedCellRectRef.current = null;
    selectedTableRectRef.current = null;
  };

  const syncOverlay = () => {
    const view = getMountedEditorView(editor);
    if (!view) {
      selectedCellRef.current = null;
      selectedCellAddressRef.current = null;
      selectedCellRectRef.current = null;
      selectedTableRectRef.current = null;
      selectedCellStateRef.current = null;
      hoveredEdgesRef.current = { columnTable: null, rowTable: null };
      tablesRef.current = [];
      setTables([]);
      setSelectedCell(null);
      setHoveredEdges({ columnTable: null, rowTable: null });
      return;
    }

    const liveTables = Array.from(
      view.dom.querySelectorAll("table"),
    ) as HTMLElement[];
    const nextSelectedCell =
      (selectedCellRef.current?.isConnected
        ? selectedCellRef.current
        : getCellAtAddress(liveTables, selectedCellAddressRef.current)) ??
      (tableUiPointerDownRef.current ? selectedCellStateRef.current : null);
    const nextHoveredEdges = {
      columnTable: hoveredEdgesRef.current.columnTable?.isConnected
        ? hoveredEdgesRef.current.columnTable
        : null,
      rowTable: hoveredEdgesRef.current.rowTable?.isConnected
        ? hoveredEdgesRef.current.rowTable
        : null,
    };

    selectedCellRef.current = nextSelectedCell;
    selectedCellAddressRef.current = nextSelectedCell
      ? (getCellAddress(editor, nextSelectedCell) ??
        selectedCellAddressRef.current)
      : null;
    if (nextSelectedCell?.isConnected) {
      selectedCellRectRef.current = nextSelectedCell.getBoundingClientRect();
      selectedTableRectRef.current =
        nextSelectedCell.closest("table")?.getBoundingClientRect() ?? null;
    } else if (!tableUiPointerDownRef.current) {
      selectedCellRectRef.current = null;
      selectedTableRectRef.current = null;
    }
    hoveredEdgesRef.current = nextHoveredEdges;

    const previousTables = tablesRef.current;
    const tablesChanged =
      previousTables.length !== liveTables.length ||
      previousTables.some((table, index) => table !== liveTables[index]);

    if (tablesChanged) {
      tablesRef.current = liveTables;
      setTables(liveTables);
    }

    if (selectedCellStateRef.current !== nextSelectedCell) {
      selectedCellStateRef.current = nextSelectedCell;
      setSelectedCell(nextSelectedCell);
    }

    setHoveredEdges((previous) =>
      previous.columnTable === nextHoveredEdges.columnTable &&
      previous.rowTable === nextHoveredEdges.rowTable
        ? previous
        : nextHoveredEdges,
    );
  };

  const updateHoveredEdges = (nextHoveredEdges: HoveredTableEdges) => {
    const previous = hoveredEdgesRef.current;
    if (
      previous.columnTable === nextHoveredEdges.columnTable &&
      previous.rowTable === nextHoveredEdges.rowTable
    ) {
      return;
    }

    hoveredEdgesRef.current = nextHoveredEdges;
    setHoveredEdges(nextHoveredEdges);
  };

  const selectCellForCommand = (cell: HTMLElement | null) => {
    if (!cell || editor.isDestroyed) return false;

    const view = getMountedEditorView(editor);
    if (!view) return false;

    const pos = view.posAtDOM(cell, 0);
    if (pos < 0) return false;

    editor
      .chain()
      .focus()
      .setTextSelection(Math.min(pos + 1, editor.state.doc.content.size))
      .run();

    selectedCellRef.current = cell;
    selectedCellAddressRef.current = getCellAddress(editor, cell);
    syncOverlay();
    return true;
  };

  const runAtCell = (cell: HTMLElement | null, action: () => void) => {
    if (!selectCellForCommand(cell)) return;
    action();
    requestAnimationFrame(() => {
      selectedCellRef.current = getCellFromEditorSelection(editor) ?? cell;
      syncOverlay();
    });
  };

  const addColumnAtEnd = (table: HTMLElement) => {
    runAtCell(getLastColumnCell(table), () => {
      editor.chain().focus().addColumnAfter().run();
    });
  };

  const addRowAtEnd = (table: HTMLElement) => {
    runAtCell(getLastRowCell(table), () => {
      editor.chain().focus().addRowAfter().run();
    });
  };

  const getSelectedCellElement = () =>
    selectedCell?.isConnected
      ? selectedCell
      : getCellAtAddress(tablesRef.current, selectedCellAddressRef.current);

  const getTableMutationContext = (cell: HTMLElement | null) => {
    if (!cell) return null;

    const address = getCellAddress(editor, cell);
    if (!address) return null;

    const pos = editor.view.posAtDOM(cell, 0);
    if (pos < 0) return null;

    const table = findTable(editor.state.doc.resolve(pos));
    if (!table) return null;

    return { address, table };
  };

  const replaceTable = (
    tablePos: number,
    oldTable: ProseMirrorNode,
    nextTable: ProseMirrorNode,
    nextAddress: SelectedCellAddress,
  ) => {
    const transaction = editor.state.tr.replaceWith(
      tablePos,
      tablePos + oldTable.nodeSize,
      nextTable,
    );

    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();

    requestAnimationFrame(() => {
      const nextCell = getCellAtAddress(
        Array.from(editor.view.dom.querySelectorAll("table")) as HTMLElement[],
        nextAddress,
      );

      selectedCellRef.current = nextCell;
      selectedCellAddressRef.current = nextCell
        ? getCellAddress(editor, nextCell)
        : nextAddress;
      if (nextCell) {
        selectCellForCommand(nextCell);
      } else {
        syncOverlay();
      }
    });
  };

  const duplicateRow = (cell: HTMLElement | null) => {
    const context = getTableMutationContext(cell);
    if (!context) return;

    const rows = getChildren(context.table.node);
    const sourceRow = rows[context.address.rowIndex];
    if (!sourceRow) return;

    rows.splice(context.address.rowIndex + 1, 0, copyNode(sourceRow));

    replaceTable(
      context.table.pos,
      context.table.node,
      context.table.node.copy(Fragment.fromArray(rows)),
      {
        ...context.address,
        rowIndex: context.address.rowIndex + 1,
      },
    );
  };

  const duplicateColumn = (cell: HTMLElement | null) => {
    const context = getTableMutationContext(cell);
    if (!context) return;

    const nextRows = getChildren(context.table.node).map((row) => {
      const cells = getChildren(row);
      const sourceCell = cells[context.address.columnIndex];
      if (!sourceCell) return row;

      cells.splice(context.address.columnIndex + 1, 0, copyNode(sourceCell));
      return row.copy(Fragment.fromArray(cells));
    });

    replaceTable(
      context.table.pos,
      context.table.node,
      context.table.node.copy(Fragment.fromArray(nextRows)),
      {
        ...context.address,
        columnIndex: context.address.columnIndex + 1,
      },
    );
  };

  const clearRowContents = (cell: HTMLElement | null) => {
    const context = getTableMutationContext(cell);
    if (!context) return;

    const nextRows = getChildren(context.table.node).map((row, rowIndex) => {
      if (rowIndex !== context.address.rowIndex) return row;

      return row.copy(
        Fragment.fromArray(
          getChildren(row).map((rowCell) => createEmptyCell(editor, rowCell)),
        ),
      );
    });

    replaceTable(
      context.table.pos,
      context.table.node,
      context.table.node.copy(Fragment.fromArray(nextRows)),
      context.address,
    );
  };

  const clearColumnContents = (cell: HTMLElement | null) => {
    const context = getTableMutationContext(cell);
    if (!context) return;

    const nextRows = getChildren(context.table.node).map((row) => {
      const cells = getChildren(row);
      const targetCell = cells[context.address.columnIndex];
      if (!targetCell) return row;

      cells[context.address.columnIndex] = createEmptyCell(editor, targetCell);
      return row.copy(Fragment.fromArray(cells));
    });

    replaceTable(
      context.table.pos,
      context.table.node,
      context.table.node.copy(Fragment.fromArray(nextRows)),
      context.address,
    );
  };

  const toggleHeaderRow = (address: SelectedCellAddress | null) => {
    if (!address || address.rowIndex !== 0) return;

    const table = findTableNodeByIndex(editor.state.doc, address.tableIndex);
    if (!table) return;

    const tableCell = editor.schema.nodes.tableCell;
    const tableHeader = editor.schema.nodes.tableHeader;
    if (!tableCell || !tableHeader) return;

    const rows = getChildren(table.node);
    const firstRowCells = getChildren(rows[0]);
    const enableHeaderRow = !firstRowCells.every(isHeaderCellNode);
    const keepHeaderColumn =
      rows.length > 0 &&
      rows.every((row) => isHeaderCellNode(getChildren(row)[0]));

    const nextRows = rows.map((row, rowIndex) => {
      if (rowIndex !== 0) return row;

      return row.copy(
        Fragment.fromArray(
          getChildren(row).map((rowCell, columnIndex) => {
            const targetType =
              enableHeaderRow || (columnIndex === 0 && keepHeaderColumn)
                ? tableHeader
                : tableCell;
            return targetType.create(
              rowCell.attrs,
              rowCell.content,
              rowCell.marks,
            );
          }),
        ),
      );
    });

    replaceTable(
      table.pos,
      table.node,
      table.node.copy(Fragment.fromArray(nextRows)),
      address,
    );
  };

  const toggleHeaderColumn = (address: SelectedCellAddress | null) => {
    if (!address || address.columnIndex !== 0) return;

    const table = findTableNodeByIndex(editor.state.doc, address.tableIndex);
    if (!table) return;

    const tableCell = editor.schema.nodes.tableCell;
    const tableHeader = editor.schema.nodes.tableHeader;
    if (!tableCell || !tableHeader) return;

    const rows = getChildren(table.node);
    const enableHeaderColumn = !rows.every((row) =>
      isHeaderCellNode(getChildren(row)[0]),
    );
    const keepHeaderRow = getChildren(rows[0]).every(isHeaderCellNode);

    const nextRows = rows.map((row, rowIndex) => {
      const cells = getChildren(row);
      const firstCell = cells[0];
      if (!firstCell) return row;

      const targetType =
        enableHeaderColumn || (rowIndex === 0 && keepHeaderRow)
          ? tableHeader
          : tableCell;
      cells[0] = targetType.create(
        firstCell.attrs,
        firstCell.content,
        firstCell.marks,
      );
      return row.copy(Fragment.fromArray(cells));
    });

    replaceTable(
      table.pos,
      table.node,
      table.node.copy(Fragment.fromArray(nextRows)),
      address,
    );
  };

  const adjustColumnCount = (table: HTMLElement, targetCount: number) => {
    let { columnCount } = getTableDimensions(table);
    const nextCount = Math.max(1, Math.min(MAX_DRAG_COLUMNS, targetCount));

    while (columnCount < nextCount) {
      if (!selectCellForCommand(getLastColumnCell(table))) break;
      editor.chain().focus().addColumnAfter().run();
      columnCount += 1;
    }

    while (columnCount > nextCount) {
      if (!selectCellForCommand(getLastColumnCell(table))) break;
      editor.chain().focus().deleteColumn().run();
      columnCount -= 1;
    }

    requestAnimationFrame(syncOverlay);
  };

  const adjustRowCount = (table: HTMLElement, targetCount: number) => {
    let { rowCount } = getTableDimensions(table);
    const nextCount = Math.max(1, Math.min(MAX_DRAG_ROWS, targetCount));

    while (rowCount < nextCount) {
      if (!selectCellForCommand(getLastRowCell(table))) break;
      editor.chain().focus().addRowAfter().run();
      rowCount += 1;
    }

    while (rowCount > nextCount) {
      if (!selectCellForCommand(getLastRowCell(table))) break;
      editor.chain().focus().deleteRow().run();
      rowCount -= 1;
    }

    requestAnimationFrame(syncOverlay);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const current = pointerResizeRef.current;
    if (!current) return;

    const dragDistance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY,
    );

    if (!current.didResize && dragDistance < DRAG_THRESHOLD) return;

    current.didResize = true;
    document.documentElement.classList.add(
      current.kind === "column"
        ? "notion-table-resizing-column"
        : "notion-table-resizing-row",
    );

    if (current.kind === "column") {
      const averageWidth = current.tableRect.width / current.baseColumnCount;
      const target = Math.round(
        (event.clientX - current.tableRect.left) / averageWidth,
      );
      if (target !== current.lastTarget) {
        current.lastTarget = target;
        adjustColumnCount(current.table, target);
      }
    } else {
      const averageHeight = current.tableRect.height / current.baseRowCount;
      const target = Math.round(
        (event.clientY - current.tableRect.top) / averageHeight,
      );
      if (target !== current.lastTarget) {
        current.lastTarget = target;
        adjustRowCount(current.table, target);
      }
    }
  };

  const handlePointerUp = () => {
    const current = pointerResizeRef.current;
    pointerResizeRef.current = null;
    document.documentElement.classList.remove(
      "notion-table-resizing-column",
      "notion-table-resizing-row",
    );
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);

    if (!current) return;

    if (!current.didResize) {
      if (current.kind === "column") {
        addColumnAtEnd(current.table);
      } else {
        addRowAtEnd(current.table);
      }
    }

    syncOverlay();
  };

  const startHandlePointer = (
    kind: ResizeKind,
    table: HTMLElement,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const { rowCount, columnCount } = getTableDimensions(table);
    pointerResizeRef.current = {
      didResize: false,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      table,
      tableRect: table.getBoundingClientRect(),
      baseRowCount: rowCount,
      baseColumnCount: columnCount,
      lastTarget: kind === "column" ? columnCount : rowCount,
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const view = getMountedEditorView(editor);
    if (!view) {
      if (viewRetry >= 5) return;
      const frame = requestAnimationFrame(() => {
        setViewRetry((retry) => (retry >= 5 ? retry : retry + 1));
      });
      return () => cancelAnimationFrame(frame);
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = getTargetElement(event.target);
      if (!target) return;

      const columnAxisTrigger = target.closest(
        '[data-testid="table-column-options"]',
      );
      if (columnAxisTrigger) {
        event.preventDefault();
        event.stopPropagation();
        holdTableUiSelection();
        setColumnMenuOpen(true);
        return;
      }

      const rowAxisTrigger = target.closest(
        '[data-testid="table-row-options"]',
      );
      if (rowAxisTrigger) {
        event.preventDefault();
        event.stopPropagation();
        holdTableUiSelection();
        setRowMenuOpen(true);
        return;
      }

      const cell = target.closest("td, th") as HTMLElement | null;

      if (cell && view.dom.contains(cell)) {
        closeTableMenus();
        selectedCellRef.current = cell;
        selectedCellAddressRef.current = getCellAddress(editor, cell);
        syncOverlay();
        return;
      }

      if (isTableUiTarget(target)) {
        holdTableUiSelection();
        return;
      }

      if (!isTableUiTarget(target)) {
        if (tableUiPointerDownRef.current) return;

        clearSelectedCell();
        syncOverlay();
      }
    };
    const handleHoverPointerMove = (event: PointerEvent) => {
      if (pointerResizeRef.current) return;
      updateHoveredEdges(getHoveredTableEdges(editor, event.target));
    };

    const handleKeyUp = () => {
      const cell = getCellFromEditorSelection(editor);
      selectedCellRef.current = cell && view.dom.contains(cell) ? cell : null;
      selectedCellAddressRef.current = selectedCellRef.current
        ? getCellAddress(editor, selectedCellRef.current)
        : null;
      syncOverlay();
    };
    const handleSelectionUpdate = () => {
      if (tableUiPointerDownRef.current) return;
      if (!view.hasFocus() && selectedCellRef.current?.isConnected) {
        syncOverlay();
        return;
      }

      const cell = getCellFromEditorSelection(editor);
      if (cell && view.dom.contains(cell)) {
        selectedCellRef.current = cell;
        selectedCellAddressRef.current = getCellAddress(editor, cell);
      } else if (!selectedCellRef.current?.isConnected) {
        selectedCellRef.current = null;
        selectedCellAddressRef.current = null;
      }
      syncOverlay();
    };

    const handleGeometryChange = () => syncOverlay();
    const observer = new MutationObserver(syncOverlay);

    syncOverlay();
    editor.on("selectionUpdate", handleSelectionUpdate);
    observer.observe(view.dom, { childList: true, subtree: true });
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("click", handlePointerDown, true);
    document.addEventListener("pointermove", handleHoverPointerMove, true);
    window.addEventListener("resize", handleGeometryChange);
    window.addEventListener("scroll", handleGeometryChange, true);
    view.dom.addEventListener("keyup", handleKeyUp);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("click", handlePointerDown, true);
      document.removeEventListener("pointermove", handleHoverPointerMove, true);
      window.removeEventListener("resize", handleGeometryChange);
      window.removeEventListener("scroll", handleGeometryChange, true);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      view.dom.removeEventListener("keyup", handleKeyUp);
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, viewRetry]);

  const view = getMountedEditorView(editor);
  if (!view) return null;

  const wrapper = view.dom.closest(
    ".visual-editor-wrapper",
  ) as HTMLElement | null;
  const wrapperRect = wrapper?.getBoundingClientRect();

  if (!wrapperRect || tables.length === 0) return null;

  const selectedRect = selectedCell?.isConnected
    ? selectedCell.getBoundingClientRect()
    : selectedCellRectRef.current;
  const selectedTable =
    (selectedCell?.closest("table") as HTMLElement | null) ??
    (selectedCellAddressRef.current
      ? tables[selectedCellAddressRef.current.tableIndex]
      : null);
  const selectedTableRect =
    selectedTable?.getBoundingClientRect() ?? selectedTableRectRef.current;
  const selectedDimensions = selectedTable
    ? getTableDimensions(selectedTable)
    : { rowCount: 0, columnCount: 0 };
  const selectedCellAddress = selectedCellAddressRef.current;
  const selectedRowOverlayRect =
    rowMenuOpen && selectedTable
      ? getRowSelectionOverlayRect(selectedTable, selectedCellAddress)
      : null;
  const selectedColumnOverlayRect =
    columnMenuOpen && selectedTable
      ? getColumnSelectionOverlayRect(selectedTable, selectedCellAddress)
      : null;
  const canToggleHeaderColumn = selectedCellAddress?.columnIndex === 0;
  const canToggleHeaderRow = selectedCellAddress?.rowIndex === 0;
  const headerColumnEnabled =
    Boolean(selectedTable) && canToggleHeaderColumn
      ? hasHeaderColumnAtAddress(editor.state.doc, selectedCellAddress)
      : false;
  const headerRowEnabled =
    Boolean(selectedTable) && canToggleHeaderRow
      ? hasHeaderRowAtAddress(editor.state.doc, selectedCellAddress)
      : false;
  const viewportWidth =
    typeof window === "undefined"
      ? Number.POSITIVE_INFINITY
      : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined"
      ? Number.POSITIVE_INFINITY
      : window.innerHeight;
  const columnMenuWouldOverflowRight = selectedRect
    ? selectedRect.left +
        selectedRect.width / 2 +
        COLUMN_OPTIONS_MENU_ALIGN_OFFSET +
        COLUMN_OPTIONS_MENU_WIDTH >
      viewportWidth - MENU_COLLISION_PADDING
    : false;
  const rowMenuWouldOverflowBottom = selectedRect
    ? selectedRect.top +
        selectedRect.height / 2 +
        ROW_OPTIONS_MENU_ALIGN_OFFSET +
        ROW_OPTIONS_MENU_HEIGHT >
      viewportHeight - MENU_COLLISION_PADDING
    : false;
  const columnMenuAlign = columnMenuWouldOverflowRight ? "end" : "start";
  const columnMenuAlignOffset = columnMenuWouldOverflowRight
    ? -COLUMN_OPTIONS_MENU_ALIGN_OFFSET
    : COLUMN_OPTIONS_MENU_ALIGN_OFFSET;
  const rowMenuAlign = rowMenuWouldOverflowBottom ? "end" : "start";
  const rowMenuAlignOffset = rowMenuWouldOverflowBottom
    ? -ROW_OPTIONS_MENU_ALIGN_OFFSET
    : ROW_OPTIONS_MENU_ALIGN_OFFSET;

  const lineButtonClass =
    "notion-table-axis-trigger group absolute z-40 flex items-center justify-center rounded-md bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const axisMarkerClass =
    "block rounded-full bg-muted-foreground/55 transition-colors group-hover:bg-primary group-focus-visible:bg-primary";
  const handleClass =
    "table-hover-controls group absolute z-40 flex items-center justify-center rounded-md bg-transparent opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const edgeHandleMarkerClass =
    "block rounded-full bg-muted-foreground/55 transition-colors group-hover:bg-primary group-focus-visible:bg-primary";

  return (
    <>
      {selectedRect && selectedTable && selectedTableRect ? (
        <>
          {selectedColumnOverlayRect ? (
            <div
              className="pointer-events-none absolute z-20 rounded-[3px] border-2 border-primary/60 bg-primary/10"
              data-testid="table-selected-column"
              style={{
                left: selectedColumnOverlayRect.left - wrapperRect.left,
                top: selectedColumnOverlayRect.top - wrapperRect.top,
                width: selectedColumnOverlayRect.width,
                height: selectedColumnOverlayRect.height,
              }}
            />
          ) : null}

          {selectedRowOverlayRect ? (
            <div
              className="pointer-events-none absolute z-20 rounded-[3px] border-2 border-primary/60 bg-primary/10"
              data-testid="table-selected-row"
              style={{
                left: selectedRowOverlayRect.left - wrapperRect.left,
                top: selectedRowOverlayRect.top - wrapperRect.top,
                width: selectedRowOverlayRect.width,
                height: selectedRowOverlayRect.height,
              }}
            />
          ) : null}

          <div
            className="pointer-events-none absolute z-30 rounded-[3px] border-2 border-primary/75 bg-primary/10"
            data-testid="table-selected-cell"
            style={{
              left: selectedRect.left - wrapperRect.left,
              top: selectedRect.top - wrapperRect.top,
              width: selectedRect.width,
              height: selectedRect.height,
            }}
          />

          <DropdownMenu open={columnMenuOpen} onOpenChange={setColumnMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("database.columnOptions")}
                className={lineButtonClass}
                data-testid="table-column-options"
                onClickCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  holdTableUiSelection();
                  setRowMenuOpen(false);
                  setColumnMenuOpen(true);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onPointerDownCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  holdTableUiSelection();
                  setRowMenuOpen(false);
                  setColumnMenuOpen(true);
                }}
                style={{
                  left:
                    selectedRect.left -
                    wrapperRect.left +
                    selectedRect.width / 2,
                  top:
                    selectedTableRect.top -
                    wrapperRect.top -
                    COLUMN_OPTIONS_HIT_HEIGHT / 2,
                  height: COLUMN_OPTIONS_HIT_HEIGHT,
                  transform: "translateX(-50%)",
                  width: COLUMN_OPTIONS_HIT_WIDTH,
                }}
              >
                <span
                  className={cn(
                    axisMarkerClass,
                    columnMenuOpen && "!bg-primary",
                  )}
                  style={{
                    height: AXIS_OPTIONS_MARKER_THICKNESS,
                    width: COLUMN_OPTIONS_MARKER_WIDTH,
                  }}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={columnMenuAlign}
              alignOffset={columnMenuAlignOffset}
              collisionPadding={MENU_COLLISION_PADDING}
            >
              <DropdownMenuLabel>{t("database.column")}</DropdownMenuLabel>
              {canToggleHeaderColumn ? (
                <DropdownMenuItem
                  className="gap-2"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    toggleHeaderColumn(selectedCellAddress);
                  }}
                  onSelect={(event) => {
                    event.preventDefault();
                    toggleHeaderColumn(selectedCellAddress);
                  }}
                >
                  <IconTableColumn className={menuIconClass} />
                  {t("database.headerColumn")}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                      headerColumnEnabled
                        ? "bg-primary"
                        : "bg-muted-foreground/25",
                    )}
                    data-state={headerColumnEnabled ? "checked" : "unchecked"}
                    data-testid="header-column-switch"
                  >
                    <span
                      className={cn(
                        "size-4 rounded-full bg-background shadow-sm transition-transform",
                        headerColumnEnabled && "translate-x-4",
                      )}
                    />
                  </span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  runAtCell(getSelectedCellElement(), () => {
                    editor.chain().focus().addColumnBefore().run();
                  })
                }
              >
                <IconArrowLeft className={menuIconClass} />
                {t("database.insertLeft")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  runAtCell(getSelectedCellElement(), () => {
                    editor.chain().focus().addColumnAfter().run();
                  })
                }
              >
                <IconArrowRight className={menuIconClass} />
                {t("database.insertRight")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => duplicateColumn(getSelectedCellElement())}
              >
                <IconCopy className={menuIconClass} />
                {t("database.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => clearColumnContents(getSelectedCellElement())}
              >
                <IconCircleX className={menuIconClass} />
                {t("database.clearColumn")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={() =>
                  runAtCell(getSelectedCellElement(), () => {
                    if (selectedDimensions.columnCount <= 1) {
                      editor.chain().focus().deleteTable().run();
                    } else {
                      editor.chain().focus().deleteColumn().run();
                    }
                  })
                }
              >
                <IconTrash className="size-4 shrink-0" />
                {t("database.deleteColumn")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu open={rowMenuOpen} onOpenChange={setRowMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("database.rowOptions")}
                className={lineButtonClass}
                data-testid="table-row-options"
                onClickCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  holdTableUiSelection();
                  setColumnMenuOpen(false);
                  setRowMenuOpen(true);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onPointerDownCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  holdTableUiSelection();
                  setColumnMenuOpen(false);
                  setRowMenuOpen(true);
                }}
                style={{
                  left:
                    selectedTableRect.left -
                    wrapperRect.left -
                    ROW_OPTIONS_HIT_WIDTH / 2,
                  top:
                    selectedRect.top -
                    wrapperRect.top +
                    selectedRect.height / 2,
                  height: ROW_OPTIONS_HIT_HEIGHT,
                  transform: "translateY(-50%)",
                  width: ROW_OPTIONS_HIT_WIDTH,
                }}
              >
                <span
                  className={cn(axisMarkerClass, rowMenuOpen && "!bg-primary")}
                  style={{
                    height: ROW_OPTIONS_MARKER_HEIGHT,
                    width: AXIS_OPTIONS_MARKER_THICKNESS,
                  }}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={rowMenuAlign}
              alignOffset={rowMenuAlignOffset}
              collisionPadding={MENU_COLLISION_PADDING}
              side="right"
            >
              <DropdownMenuLabel>{t("database.row")}</DropdownMenuLabel>
              {canToggleHeaderRow ? (
                <DropdownMenuItem
                  className="gap-2"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    toggleHeaderRow(selectedCellAddress);
                  }}
                  onSelect={(event) => {
                    event.preventDefault();
                    toggleHeaderRow(selectedCellAddress);
                  }}
                >
                  <IconTableRow className={menuIconClass} />
                  {t("database.headerRow")}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                      headerRowEnabled
                        ? "bg-primary"
                        : "bg-muted-foreground/25",
                    )}
                    data-state={headerRowEnabled ? "checked" : "unchecked"}
                    data-testid="header-row-switch"
                  >
                    <span
                      className={cn(
                        "size-4 rounded-full bg-background shadow-sm transition-transform",
                        headerRowEnabled && "translate-x-4",
                      )}
                    />
                  </span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  runAtCell(getSelectedCellElement(), () => {
                    editor.chain().focus().addRowBefore().run();
                  })
                }
              >
                <IconArrowUp className={menuIconClass} />
                {t("database.insertAbove")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  runAtCell(getSelectedCellElement(), () => {
                    editor.chain().focus().addRowAfter().run();
                  })
                }
              >
                <IconArrowDown className={menuIconClass} />
                {t("database.insertBelow")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => duplicateRow(getSelectedCellElement())}
              >
                <IconCopy className={menuIconClass} />
                {t("database.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => clearRowContents(getSelectedCellElement())}
              >
                <IconCircleX className={menuIconClass} />
                {t("database.clearRow")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={() =>
                  runAtCell(getSelectedCellElement(), () => {
                    if (selectedDimensions.rowCount <= 1) {
                      editor.chain().focus().deleteTable().run();
                    } else {
                      editor.chain().focus().deleteRow().run();
                    }
                  })
                }
              >
                <IconTrash className="size-4 shrink-0" />
                {t("database.deleteRow")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      {tables.map((table) => {
        if (!table.isConnected) return null;

        const tableId = getTableOverlayId(table);
        const rect = table.getBoundingClientRect();
        const left = rect.left - wrapperRect.left;
        const top = rect.top - wrapperRect.top;
        const right = rect.right - wrapperRect.left;
        const bottom = rect.bottom - wrapperRect.top;
        const isColumnHandleVisible = hoveredEdges.columnTable === table;
        const isRowHandleVisible = hoveredEdges.rowTable === table;

        return (
          <div key={tableId}>
            <Tooltip delayDuration={EDGE_HANDLE_TOOLTIP_DELAY}>
              <TooltipTrigger asChild>
                <button
                  aria-label={t("database.tableColumnHandle")}
                  className={cn(
                    handleClass,
                    "cursor-col-resize -translate-y-1/2",
                    isColumnHandleVisible && "opacity-100",
                  )}
                  data-table-edge-control
                  data-table-edge="column"
                  data-table-id={tableId}
                  data-testid="table-column-handle"
                  onPointerDown={(event) =>
                    startHandlePointer("column", table, event)
                  }
                  style={{
                    height: COLUMN_EDGE_HANDLE_HIT_HEIGHT,
                    left: right - COLUMN_EDGE_HANDLE_HIT_WIDTH / 2,
                    top: top + rect.height / 2,
                    width: COLUMN_EDGE_HANDLE_HIT_WIDTH,
                  }}
                  type="button"
                >
                  <span
                    className={edgeHandleMarkerClass}
                    style={{
                      height: EDGE_HANDLE_LENGTH,
                      width: EDGE_HANDLE_THICKNESS,
                    }}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <strong>{t("database.click")}</strong>{" "}
                {t("database.toAddAColumn")}{" "}
                <strong>{t("database.drag")}</strong>{" "}
                {t("database.toAddOrRemoveColumns")}
              </TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={EDGE_HANDLE_TOOLTIP_DELAY}>
              <TooltipTrigger asChild>
                <button
                  aria-label={t("database.tableRowHandle")}
                  className={cn(
                    handleClass,
                    "cursor-row-resize -translate-x-1/2",
                    isRowHandleVisible && "opacity-100",
                  )}
                  data-table-edge-control
                  data-table-edge="row"
                  data-table-id={tableId}
                  data-testid="table-row-handle"
                  onPointerDown={(event) =>
                    startHandlePointer("row", table, event)
                  }
                  style={{
                    height: ROW_EDGE_HANDLE_HIT_HEIGHT,
                    left: left + rect.width / 2,
                    top: bottom - ROW_EDGE_HANDLE_HIT_HEIGHT / 2,
                    width: ROW_EDGE_HANDLE_HIT_WIDTH,
                  }}
                  type="button"
                >
                  <span
                    className={edgeHandleMarkerClass}
                    style={{
                      height: EDGE_HANDLE_THICKNESS,
                      width: EDGE_HANDLE_LENGTH,
                    }}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <strong>{t("database.click")}</strong> {t("database.toAddARow")}{" "}
                <strong>{t("database.drag")}</strong>{" "}
                {t("database.toAddOrRemoveRows")}
              </TooltipContent>
            </Tooltip>
          </div>
        );
      })}
    </>
  );
}
