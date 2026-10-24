import { useT } from "@agent-native/core/client/i18n";
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
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  findTable,
  TableMap,
  type Rect as TableCellRect,
} from "@tiptap/pm/tables";
import { Editor } from "@tiptap/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ColorSubmenu } from "./ColorSubmenu";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { instantCloseMenuClass, menuIconClass } from "./menu-classes";
import { MenuSwitchItem } from "./MenuSwitchItem";
import {
  attrsWithDuplicatedColumn,
  deleteTableColumn,
  deleteTableColumns,
  deleteTableRow,
  deleteTableRows,
  findTableByIndex,
  getColumnColor,
  getRowColor,
  getTableHeaders,
  insertTableColumn,
  insertTableRow,
  setColumnColors,
  setRowColors,
  setTableHeaders,
  type TableAt,
} from "./table-commands";

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
const ROW_OPTIONS_MENU_HEIGHT = 290;
// The block grip, in the gutter left of every block.
const BLOCK_GRIP_WIDTH = 24;
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

// A reference preview inside a cell brings its own tables, so these keep only
// the rows and cells that belong to the given table or row.
function getRows(table: HTMLElement) {
  return (
    Array.from(table.querySelectorAll("tr")) as HTMLTableRowElement[]
  ).filter((row) => row.closest("table") === table);
}

function getCells(row: HTMLTableRowElement | null | undefined) {
  return row
    ? (Array.from(row.querySelectorAll("td, th")) as HTMLElement[]).filter(
        (cell) => cell.closest("tr") === row,
      )
    : [];
}

function getTableDimensions(table: HTMLElement) {
  const rows = getRows(table);
  return {
    rowCount: rows.length,
    columnCount: getCells(rows[0]).length,
  };
}

// A reference preview renders its own read-only editor, tables included,
// inside this one. Those tables aren't in this editor's document.
function isInEditor(root: HTMLElement, element: Element) {
  return element.closest(".ProseMirror") === root;
}

export function getEditorTables(root: HTMLElement) {
  return (Array.from(root.querySelectorAll("table")) as HTMLElement[]).filter(
    (table) => isInEditor(root, table),
  );
}

function getCellAddress(editor: Editor, cell: HTMLElement) {
  const table = cell.closest("table") as HTMLElement | null;
  const row = cell.closest("tr") as HTMLTableRowElement | null;
  if (!table || !row) return null;

  const tables = getEditorTables(editor.view.dom);
  const tableIndex = tables.indexOf(table);
  const rowIndex = getRows(table).indexOf(row);
  const columnIndex = getCells(row).indexOf(cell);

  if (tableIndex < 0 || rowIndex < 0 || columnIndex < 0) return null;

  return { columnIndex, rowIndex, tableIndex };
}

export function getCellAtAddress(
  tables: HTMLElement[],
  address: SelectedCellAddress | null,
) {
  if (!address) return null;

  const table = tables[address.tableIndex];
  const row = table ? getRows(table)[address.rowIndex] : null;
  return getCells(row)[address.columnIndex] ?? null;
}

function getSelectionOverlayRect(table: HTMLElement, rects: DOMRect[]) {
  if (rects.length === 0) return null;

  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return clampToScrollport(
    { height: bottom - top, left, top, width: right - left },
    getTableScrollport(table),
  );
}

// Tables scroll sideways inside `.tableWrapper`, but these controls render
// beside the editor, outside its clipping, so they clip themselves to it.
function getTableScrollport(table: HTMLElement) {
  return (table.closest(".tableWrapper") ?? table).getBoundingClientRect();
}

function clampToScrollport(
  rect: SelectionOverlayRect,
  scrollport: DOMRect,
): SelectionOverlayRect {
  const clamp = (x: number) =>
    Math.min(Math.max(x, scrollport.left), scrollport.right);
  const left = clamp(rect.left);

  return {
    height: rect.height,
    left,
    top: rect.top,
    width: clamp(rect.left + rect.width) - left,
  };
}

function getRowSelectionOverlayRect(
  table: HTMLElement,
  address: SelectedCellAddress | null,
) {
  if (!address) return null;

  return getSelectionOverlayRect(
    table,
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
    table,
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

// Where a cell starts in a table that starts at tablePos.
function getCellPos(
  table: ProseMirrorNode,
  tablePos: number,
  address: SelectedCellAddress,
) {
  const row = table.maybeChild(address.rowIndex);
  if (!row || address.columnIndex >= row.childCount) return null;

  let pos = tablePos + 1;
  for (let index = 0; index < address.rowIndex; index += 1) {
    pos += table.child(index).nodeSize;
  }
  pos += 1;
  for (let index = 0; index < address.columnIndex; index += 1) {
    pos += row.child(index).nodeSize;
  }
  return pos;
}

function copyNode(node: ProseMirrorNode) {
  return node.copy(node.content);
}

function createEmptyCell(editor: Editor, cell: ProseMirrorNode) {
  const paragraph = editor.schema.nodes.paragraph.create();
  return cell.type.create(cell.attrs, Fragment.from(paragraph), cell.marks);
}

// The rows and columns a cell covers, counting merged cells.
function getCellRect(table: TableAt, address: SelectedCellAddress) {
  const cellPos = getCellPos(table.node, table.pos, address);
  return cellPos === null
    ? null
    : TableMap.get(table.node).findCell(cellPos - table.pos - 1);
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
  if (!cell || !isInEditor(view.dom, cell)) {
    return { columnTable: null, rowTable: null };
  }

  const table = cell.closest("table") as HTMLElement | null;
  const row = cell.closest("tr") as HTMLTableRowElement | null;
  if (!table || !row) {
    return { columnTable: null, rowTable: null };
  }

  const rows = getRows(table);
  const rowCells = getCells(row);
  // A table wider than its scrollport keeps its add-column control at the
  // scrollport's edge, beside the column the edge cuts through.
  const isLastColumn =
    rowCells[rowCells.length - 1] === cell ||
    cell.getBoundingClientRect().right > getTableScrollport(table).right + 1;
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
    "table, [data-table-edge-control], .content-table-axis-trigger, [role='menu']",
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
  const hoveredCellRef = useRef<HTMLElement | null>(null);
  const menuDismissedOutsideRef = useRef(false);
  const [tables, setTables] = useState<HTMLElement[]>([]);
  const [selectedCell, setSelectedCell] = useState<HTMLElement | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HTMLElement | null>(null);
  const [hoveredEdges, setHoveredEdges] = useState<HoveredTableEdges>({
    columnTable: null,
    rowTable: null,
  });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const [viewRetry, setViewRetry] = useState(0);
  const [, setGeometryRevision] = useState(0);

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

  // Radix returns focus to the menu's trigger, which strands the keyboard
  // outside the editor: Ctrl+Z there runs the browser's own undo on cell text.
  // The menus aren't modal, so a click elsewhere both closes them and lands;
  // refocusing the editor after it would put back the cell the menu acted on.
  // Radix refocuses a tick after the menu goes, by which time that click (or
  // the other table menu, opening) may already hold focus.
  const returnFocusToEditor = (event: Event) => {
    event.preventDefault();
    const dismissedOutside = menuDismissedOutsideRef.current;
    menuDismissedOutsideRef.current = false;
    const focusTaken =
      !!document.activeElement && document.activeElement !== document.body;
    if (!dismissedOutside && !focusTaken) {
      getMountedEditorView(editor)?.focus();
    }
  };
  const noteMenuDismissedOutside = () => {
    menuDismissedOutsideRef.current = true;
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

    const liveTables = getEditorTables(view.dom);
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

  // The row and column options follow the hovered cell, so the pointer keeps
  // it while crossing onto them or into their menu.
  const updateHoveredCell = (target: EventTarget | null) => {
    const element = getTargetElement(target);
    if (element?.closest(".content-table-axis-trigger, [role='menu']")) return;

    const cell = element?.closest("td, th") as HTMLElement | null;
    const root = getMountedEditorView(editor)?.dom;
    const nextCell = cell && root && isInEditor(root, cell) ? cell : null;
    if (hoveredCellRef.current === nextCell) return;

    hoveredCellRef.current = nextCell;
    setHoveredCell(nextCell);
  };

  const selectCellForCommand = (cell: HTMLElement | null, focus = true) => {
    if (!cell || editor.isDestroyed) return false;

    const view = getMountedEditorView(editor);
    if (!view) return false;

    const pos = view.posAtDOM(cell, 0);
    if (pos < 0) return false;

    (focus ? editor.chain().focus() : editor.chain())
      .setTextSelection(Math.min(pos + 1, editor.state.doc.content.size))
      .run();

    selectedCellRef.current = cell;
    selectedCellAddressRef.current = getCellAddress(editor, cell);
    syncOverlay();
    return true;
  };

  // Without focusing the editor: an unfocused editor takes focus a frame later,
  // after the menu opened, and the menu closes when focus leaves it. The menu's
  // commands focus the editor themselves.
  const selectHoveredCell = () => {
    const cell = hoveredCellRef.current;
    if (cell?.isConnected && cell !== selectedCellRef.current) {
      selectCellForCommand(cell, false);
    }
  };

  // The menus and edge controls act while they, not the editor, hold focus, and
  // Content saves an unfocused change only when it is marked as the user's.
  // The caret stays put: moved into the table, it would outline that cell.
  const editTable = (
    tableIndex: number | undefined,
    edit: (tr: Transaction, table: TableAt) => void,
  ) => {
    const view = getMountedEditorView(editor);
    if (!view || tableIndex === undefined) return;
    const table = findTableByIndex(view.state.doc, tableIndex);
    if (!table) return;
    const tr = view.state.tr;
    edit(tr, table);
    if (tr.docChanged) {
      view.dispatch(tr.setMeta(LOCAL_FILE_USER_EDIT_META, true));
    }
  };

  const getTableIndex = (table: HTMLElement) => {
    const view = getMountedEditorView(editor);
    const index = view ? getEditorTables(view.dom).indexOf(table) : -1;
    return index < 0 ? undefined : index;
  };

  const addColumnAtEnd = (table: HTMLElement) => {
    editTable(getTableIndex(table), (tr, target) => {
      insertTableColumn(tr, target, TableMap.get(target.node).width);
    });
    requestAnimationFrame(() => {
      const scrollport = table.closest(".tableWrapper");
      scrollport?.scrollTo({ left: scrollport.scrollWidth });
    });
  };

  const addRowAtEnd = (table: HTMLElement) => {
    editTable(getTableIndex(table), (tr, target) => {
      insertTableRow(tr, target, target.node.childCount);
    });
  };

  // Menu actions on the selected cell's row or column. The cell is found when
  // the action runs, since a collaborator's edit can move it while the menu is
  // open.
  const editAtCell = (
    edit: (tr: Transaction, table: TableAt, cell: TableCellRect) => void,
  ) => {
    const context = getTableMutationContext(getSelectedCellElement());
    if (!context) return;
    editTable(context.address.tableIndex, (tr, table) => {
      const cell = getCellRect(table, context.address);
      if (cell) edit(tr, table, cell);
    });
  };

  const deleteTableAt = (tr: Transaction, table: TableAt) =>
    tr.delete(table.pos, table.pos + table.node.nodeSize);

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

    // Replacing the table moves the selection out of it, and the controls
    // follow the selected cell: they would unmount, menu and all, until the
    // next frame selects the cell again.
    const cellPos = getCellPos(nextTable, tablePos, nextAddress);
    if (cellPos !== null) {
      transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(cellPos + 1)),
      );
    }
    transaction.setMeta(LOCAL_FILE_USER_EDIT_META, true);
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();

    requestAnimationFrame(() => {
      const nextCell = getCellAtAddress(
        getEditorTables(editor.view.dom),
        nextAddress,
      );

      selectedCellRef.current = nextCell;
      selectedCellAddressRef.current = nextCell
        ? getCellAddress(editor, nextCell)
        : nextAddress;
      if (nextCell) {
        selectCellForCommand(nextCell, true);
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
    const source = context && getCellRect(context.table, context.address);
    if (!context || !source) return;

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
      context.table.node.type.create(
        attrsWithDuplicatedColumn(context.table.node, source.left),
        Fragment.fromArray(nextRows),
        context.table.node.marks,
      ),
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

  // The header switches keep their menu open and focused.
  const toggleHeader = (axis: "row" | "column") => {
    const context = getTableMutationContext(getSelectedCellElement());
    editTable(context?.address.tableIndex, (tr, table) => {
      setTableHeaders(tr, table, {
        [axis]: !getTableHeaders(table.node)[axis],
      });
    });
  };

  const adjustColumnCount = (table: HTMLElement, targetCount: number) => {
    const nextCount = Math.max(1, Math.min(MAX_DRAG_COLUMNS, targetCount));
    editTable(getTableIndex(table), (tr, target) => {
      let columnCount = TableMap.get(target.node).width;
      for (; columnCount < nextCount; columnCount += 1) {
        insertTableColumn(tr, target, columnCount);
      }
      for (; columnCount > nextCount; columnCount -= 1) {
        deleteTableColumn(tr, target, columnCount - 1);
      }
    });
    requestAnimationFrame(syncOverlay);
  };

  const adjustRowCount = (table: HTMLElement, targetCount: number) => {
    const nextCount = Math.max(1, Math.min(MAX_DRAG_ROWS, targetCount));
    editTable(getTableIndex(table), (tr, target) => {
      let rowCount = target.node.childCount;
      for (; rowCount < nextCount; rowCount += 1) {
        insertTableRow(tr, target, rowCount);
      }
      for (; rowCount > nextCount; rowCount -= 1) {
        deleteTableRow(tr, target, rowCount - 1);
      }
    });
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
        ? "content-table-resizing-column"
        : "content-table-resizing-row",
    );

    // Count from where the drag started, not from the table's start: the
    // column control can sit at a scrollport edge well short of the table's end.
    if (current.kind === "column") {
      const averageWidth = current.tableRect.width / current.baseColumnCount;
      const target =
        current.baseColumnCount +
        Math.round((event.clientX - current.startX) / averageWidth);
      if (target !== current.lastTarget) {
        current.lastTarget = target;
        adjustColumnCount(current.table, target);
      }
    } else {
      const averageHeight = current.tableRect.height / current.baseRowCount;
      const target =
        current.baseRowCount +
        Math.round((event.clientY - current.startY) / averageHeight);
      if (target !== current.lastTarget) {
        current.lastTarget = target;
        adjustRowCount(current.table, target);
      }
    }
  };

  const endPointerResize = () => {
    const current = pointerResizeRef.current;
    pointerResizeRef.current = null;
    document.documentElement.classList.remove(
      "content-table-resizing-column",
      "content-table-resizing-row",
    );
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
    return current;
  };

  // The browser cancels a touch it takes over, e.g. to scroll. That ends the
  // drag without the click's added row or column.
  const handlePointerCancel = () => {
    endPointerResize();
    syncOverlay();
  };

  const handlePointerUp = () => {
    const current = endPointerResize();
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
    window.addEventListener("pointercancel", handlePointerCancel);
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
        selectHoveredCell();
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
        selectHoveredCell();
        holdTableUiSelection();
        setRowMenuOpen(true);
        return;
      }

      const cell = target.closest("td, th") as HTMLElement | null;

      if (cell && isInEditor(view.dom, cell)) {
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
    // The pointer keeps an edge handle shown while it's on the handle.
    const updateEdgesFromTarget = (target: EventTarget | null) => {
      if (getTargetElement(target)?.closest("[data-table-edge-control]")) {
        return;
      }
      updateHoveredEdges(getHoveredTableEdges(editor, target));
    };
    const handleHoverPointerMove = (event: PointerEvent) => {
      if (pointerResizeRef.current) return;
      // Touch has no hover. A finger that moves during a tap would show a
      // handle under it before the tap lands, so taps use handleTapEdges.
      if (event.pointerType !== "touch") updateEdgesFromTarget(event.target);
      updateHoveredCell(event.target);
    };
    // Once a tap has placed the caret, the cell it landed on shows its edge
    // handles, so a second tap can use them.
    const handleTapEdges = (event: MouseEvent) => {
      if (pointerResizeRef.current) return;
      updateEdgesFromTarget(event.target);
    };

    const handleKeyUp = () => {
      const cell = getCellFromEditorSelection(editor);
      selectedCellRef.current =
        cell && isInEditor(view.dom, cell) ? cell : null;
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
      if (cell && isInEditor(view.dom, cell)) {
        selectedCellRef.current = cell;
        selectedCellAddressRef.current = getCellAddress(editor, cell);
      } else if (!selectedCellRef.current?.isConnected) {
        selectedCellRef.current = null;
        selectedCellAddressRef.current = null;
      }
      syncOverlay();
    };

    const handleGeometryChange = () => {
      syncOverlay();
      setGeometryRevision((revision) => revision + 1);
    };
    // Page scrolls carry the overlay along with the tables, but a table
    // scrolled sideways inside its own `.tableWrapper` leaves the overlay behind.
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && view.dom.contains(event.target)) {
        handleGeometryChange();
      } else {
        syncOverlay();
      }
    };
    const observer = new MutationObserver(syncOverlay);

    syncOverlay();
    editor.on("selectionUpdate", handleSelectionUpdate);
    observer.observe(view.dom, { childList: true, subtree: true });
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("click", handlePointerDown, true);
    document.addEventListener("pointermove", handleHoverPointerMove, true);
    document.addEventListener("click", handleTapEdges, true);
    window.addEventListener("resize", handleGeometryChange);
    window.addEventListener("scroll", handleScroll, true);
    view.dom.addEventListener("keyup", handleKeyUp);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("click", handlePointerDown, true);
      document.removeEventListener("pointermove", handleHoverPointerMove, true);
      document.removeEventListener("click", handleTapEdges, true);
      window.removeEventListener("resize", handleGeometryChange);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      view.dom.removeEventListener("keyup", handleKeyUp);
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, viewRetry]);

  // Panels opening beside the page narrow the editor without a window resize.
  useEffect(() => {
    const view = getMountedEditorView(editor);
    if (!view || tables.length === 0) return;
    const observer = new ResizeObserver(() =>
      setGeometryRevision((revision) => revision + 1),
    );
    observer.observe(view.dom);
    for (const table of tables) observer.observe(table);
    return () => observer.disconnect();
  }, [editor, tables]);

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
  const selectedScrollport = selectedTable
    ? getTableScrollport(selectedTable)
    : null;
  const visibleSelectedRect =
    selectedRect && selectedScrollport
      ? clampToScrollport(selectedRect, selectedScrollport)
      : null;
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
  const selectedTableAt =
    selectedTable && selectedCellAddress
      ? findTableByIndex(editor.state.doc, selectedCellAddress.tableIndex)
      : null;
  const selectedHeaders = selectedTableAt
    ? getTableHeaders(selectedTableAt.node)
    : { row: false, column: false };
  const headerColumnEnabled = canToggleHeaderColumn && selectedHeaders.column;
  const headerRowEnabled = canToggleHeaderRow && selectedHeaders.row;
  const selectedRowColor =
    selectedTableAt && selectedCellAddress
      ? getRowColor(selectedTableAt.node, selectedCellAddress.rowIndex)
      : null;
  const selectedCellRect =
    selectedTableAt && selectedCellAddress
      ? getCellRect(selectedTableAt, selectedCellAddress)
      : null;
  const selectedColumnColor =
    selectedTableAt && selectedCellRect
      ? getColumnColor(selectedTableAt.node, selectedCellRect.left)
      : null;
  const viewportWidth =
    typeof window === "undefined"
      ? Number.POSITIVE_INFINITY
      : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined"
      ? Number.POSITIVE_INFINITY
      : window.innerHeight;
  const columnMenuWouldOverflowRight = visibleSelectedRect
    ? visibleSelectedRect.left +
        visibleSelectedRect.width / 2 +
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
  const hoveredAxisCell =
    !columnMenuOpen &&
    !rowMenuOpen &&
    hoveredCell?.isConnected &&
    hoveredCell !== selectedCell
      ? hoveredCell
      : null;
  const hoveredAxisTable = hoveredAxisCell?.closest(
    "table",
  ) as HTMLElement | null;
  const axisTableRect = hoveredAxisTable
    ? hoveredAxisTable.getBoundingClientRect()
    : selectedTableRect;
  const axisScrollport = hoveredAxisTable
    ? getTableScrollport(hoveredAxisTable)
    : selectedScrollport;
  const axisRect =
    hoveredAxisCell && hoveredAxisTable && axisScrollport
      ? clampToScrollport(
          hoveredAxisCell.getBoundingClientRect(),
          axisScrollport,
        )
      : visibleSelectedRect;
  const columnMenuAlign = columnMenuWouldOverflowRight ? "end" : "start";
  const columnMenuAlignOffset = columnMenuWouldOverflowRight
    ? -COLUMN_OPTIONS_MENU_ALIGN_OFFSET
    : COLUMN_OPTIONS_MENU_ALIGN_OFFSET;
  // A table at the screen's edge leaves its gutter to the block grip, so its
  // row options take only their half inside the border, which covers no more
  // of the cell than usual.
  const rowOptionsInside =
    !!axisTableRect &&
    !!axisScrollport &&
    Math.max(axisTableRect.left, axisScrollport.left) < BLOCK_GRIP_WIDTH;
  const rowMenuAlign = rowMenuWouldOverflowBottom ? "end" : "start";
  const rowMenuAlignOffset = rowMenuWouldOverflowBottom
    ? -ROW_OPTIONS_MENU_ALIGN_OFFSET
    : ROW_OPTIONS_MENU_ALIGN_OFFSET;

  const lineButtonClass =
    "content-table-axis-trigger group absolute z-40 flex items-center justify-center rounded-md bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const axisMarkerClass =
    "block rounded-full bg-muted-foreground/55 transition-colors group-hover:bg-primary group-focus-visible:bg-primary";
  // touch-none lets a finger drag a handle instead of scrolling the page.
  const handleClass =
    "table-hover-controls group absolute z-40 flex touch-none items-center justify-center rounded-md bg-transparent opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const edgeHandleMarkerClass =
    "block rounded-full bg-muted-foreground/55 transition-colors group-hover:bg-primary group-focus-visible:bg-primary";

  return (
    <>
      {visibleSelectedRect &&
      selectedScrollport &&
      selectedTable &&
      selectedTableRect ? (
        <>
          {selectedColumnOverlayRect?.width ? (
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

          {selectedRowOverlayRect?.width ? (
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

          {visibleSelectedRect.width ? (
            <div
              className="pointer-events-none absolute z-30 rounded-[3px] border-2 border-primary/75 bg-primary/10"
              data-testid="table-selected-cell"
              style={{
                left: visibleSelectedRect.left - wrapperRect.left,
                top: visibleSelectedRect.top - wrapperRect.top,
                width: visibleSelectedRect.width,
                height: visibleSelectedRect.height,
              }}
            />
          ) : null}
        </>
      ) : null}

      {axisRect && axisScrollport && axisTableRect ? (
        <>
          <DropdownMenu
            open={columnMenuOpen}
            onOpenChange={(open) => {
              // Enter, Space and ArrowDown open the menu without a pointer.
              if (open) selectHoveredCell();
              setColumnMenuOpen(open);
            }}
            modal={false}
          >
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("database.columnOptions")}
                className={cn(lineButtonClass, !axisRect.width && "invisible")}
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
                  left: axisRect.left - wrapperRect.left + axisRect.width / 2,
                  top:
                    axisTableRect.top -
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
              className={instantCloseMenuClass}
              collisionPadding={MENU_COLLISION_PADDING}
              onCloseAutoFocus={returnFocusToEditor}
              onInteractOutside={noteMenuDismissedOutside}
            >
              <DropdownMenuLabel>{t("database.column")}</DropdownMenuLabel>
              {canToggleHeaderColumn ? (
                <MenuSwitchItem
                  checked={headerColumnEnabled}
                  icon={<IconTableColumn className={menuIconClass} />}
                  onToggle={() => toggleHeader("column")}
                  switchTestId="header-column-switch"
                >
                  {t("database.headerColumn")}
                </MenuSwitchItem>
              ) : null}
              <ColorSubmenu
                onChange={(color) =>
                  editAtCell((tr, table, cell) =>
                    setColumnColors(tr, table, cell, color),
                  )
                }
                value={selectedColumnColor}
              />
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  editAtCell((tr, table, cell) =>
                    insertTableColumn(tr, table, cell.left),
                  )
                }
              >
                <IconArrowLeft className={menuIconClass} />
                {t("database.insertLeft")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  editAtCell((tr, table, cell) =>
                    insertTableColumn(tr, table, cell.right),
                  )
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
                  editAtCell((tr, table, cell) => {
                    if (
                      cell.left === 0 &&
                      cell.right >= TableMap.get(table.node).width
                    ) {
                      deleteTableAt(tr, table);
                    } else {
                      deleteTableColumns(tr, table, cell);
                    }
                  })
                }
              >
                <IconTrash className="size-4 shrink-0" />
                {t("database.deleteColumn")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu
            open={rowMenuOpen}
            onOpenChange={(open) => {
              // Enter, Space and ArrowDown open the menu without a pointer.
              if (open) selectHoveredCell();
              setRowMenuOpen(open);
            }}
            modal={false}
          >
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t("database.rowOptions")}
                className={cn(
                  lineButtonClass,
                  rowOptionsInside && "justify-start",
                )}
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
                    Math.max(axisTableRect.left, axisScrollport.left) -
                    wrapperRect.left -
                    (rowOptionsInside ? 0 : ROW_OPTIONS_HIT_WIDTH / 2),
                  top: axisRect.top - wrapperRect.top + axisRect.height / 2,
                  height: ROW_OPTIONS_HIT_HEIGHT,
                  transform: "translateY(-50%)",
                  width: rowOptionsInside
                    ? ROW_OPTIONS_HIT_WIDTH / 2
                    : ROW_OPTIONS_HIT_WIDTH,
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
              className={instantCloseMenuClass}
              collisionPadding={MENU_COLLISION_PADDING}
              onCloseAutoFocus={returnFocusToEditor}
              onInteractOutside={noteMenuDismissedOutside}
              side="right"
            >
              <DropdownMenuLabel>{t("database.row")}</DropdownMenuLabel>
              {canToggleHeaderRow ? (
                <MenuSwitchItem
                  checked={headerRowEnabled}
                  icon={<IconTableRow className={menuIconClass} />}
                  onToggle={() => toggleHeader("row")}
                  switchTestId="header-row-switch"
                >
                  {t("database.headerRow")}
                </MenuSwitchItem>
              ) : null}
              <ColorSubmenu
                onChange={(color) =>
                  editAtCell((tr, table, cell) =>
                    setRowColors(tr, table, cell, color),
                  )
                }
                value={selectedRowColor}
              />
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  editAtCell((tr, table, cell) =>
                    insertTableRow(tr, table, cell.top),
                  )
                }
              >
                <IconArrowUp className={menuIconClass} />
                {t("database.insertAbove")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() =>
                  editAtCell((tr, table, cell) =>
                    insertTableRow(tr, table, cell.bottom),
                  )
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
                  editAtCell((tr, table, cell) => {
                    if (
                      cell.top === 0 &&
                      cell.bottom >= TableMap.get(table.node).height
                    ) {
                      deleteTableAt(tr, table);
                    } else {
                      deleteTableRows(tr, table, cell);
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
        const scrollportRect = getTableScrollport(table);
        const visibleLeft = Math.max(rect.left, scrollportRect.left);
        const visibleRight = Math.min(rect.right, scrollportRect.right);
        const top = rect.top - wrapperRect.top;
        const right = visibleRight - wrapperRect.left;
        const bottom = rect.bottom - wrapperRect.top;
        const visibleCenter =
          (visibleLeft + visibleRight) / 2 - wrapperRect.left;
        // A hidden handle lets clicks through to the cell under it.
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
                    isColumnHandleVisible
                      ? "opacity-100"
                      : "pointer-events-none",
                  )}
                  data-table-edge-control
                  data-table-edge="column"
                  data-table-id={tableId}
                  data-testid="table-column-handle"
                  // Enter and Space; a pointer adds on release instead.
                  onClick={(event) => {
                    if (event.detail === 0) addColumnAtEnd(table);
                  }}
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
                    isRowHandleVisible ? "opacity-100" : "pointer-events-none",
                  )}
                  data-table-edge-control
                  data-table-edge="row"
                  data-table-id={tableId}
                  data-testid="table-row-handle"
                  onClick={(event) => {
                    if (event.detail === 0) addRowAtEnd(table);
                  }}
                  onPointerDown={(event) =>
                    startHandlePointer("row", table, event)
                  }
                  style={{
                    height: ROW_EDGE_HANDLE_HIT_HEIGHT,
                    left: visibleCenter,
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
