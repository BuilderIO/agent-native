import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import {
  addColSpan,
  addColumn,
  addRow,
  removeColumn,
  removeRow,
  TableMap,
  type TableRect,
} from "@tiptap/pm/tables";

type CellAttrs = Parameters<typeof addColSpan>[0];

export interface TableAt {
  node: ProseMirrorNode;
  pos: number;
}

export interface TableHeaders {
  row: boolean;
  column: boolean;
}

// The `<col>`s of the table's NFM `<colgroup>`, by column. It can list fewer
// columns than the table has.
interface ColumnMeta {
  color?: string | null;
  width?: string | null;
}

export function findTableByIndex(
  doc: ProseMirrorNode,
  tableIndex: number,
): TableAt | null {
  let currentIndex = -1;
  let result: TableAt | null = null;

  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name !== "table") return !node.isTextblock;

    currentIndex += 1;
    if (currentIndex === tableIndex) result = { node, pos };
    return true;
  });

  return result;
}

function children(node: ProseMirrorNode) {
  const result: ProseMirrorNode[] = [];
  node.forEach((child) => result.push(child));
  return result;
}

const isHeaderCell = (cell: ProseMirrorNode | undefined) =>
  cell?.type.name === "tableHeader";

// The cells are what the table shows; NormalizeTableHeaders keeps the
// table's own attributes in step with them. In a table one row tall or one
// column wide, a header row and a header column make the same cells headers,
// so there the attributes say which the table has.
export function getTableHeaders(table: ProseMirrorNode): TableHeaders {
  const rows = children(table);
  const saved = {
    row: table.attrs.headerRow === true,
    column: table.attrs.headerColumn === true,
  };
  const savedMatchesCells = rows.every((row, rowIndex) =>
    children(row).every(
      (cell, columnIndex) =>
        isHeaderCell(cell) ===
        ((saved.row && rowIndex === 0) || (saved.column && columnIndex === 0)),
    ),
  );
  if (savedMatchesCells) return saved;
  const firstRow = rows[0] ? children(rows[0]) : [];
  return {
    row: firstRow.length > 0 && firstRow.every(isHeaderCell),
    column:
      rows.length > 0 &&
      rows.every((row) => isHeaderCell(row.firstChild ?? undefined)),
  };
}

export function setTableHeaders(
  tr: Transaction,
  table: TableAt,
  headers: Partial<TableHeaders>,
) {
  const { tableCell, tableHeader } = tr.doc.type.schema.nodes;
  const next = { ...getTableHeaders(table.node), ...headers };

  // Changing a cell's type keeps its size, so every position here holds.
  let rowPos = table.pos + 1;
  table.node.forEach((row, _offset, rowIndex) => {
    let cellPos = rowPos + 1;
    row.forEach((cell, _cellOffset, columnIndex) => {
      const type =
        (next.row && rowIndex === 0) || (next.column && columnIndex === 0)
          ? tableHeader
          : tableCell;
      if (cell.type !== type) {
        tr.setNodeMarkup(cellPos, type, cell.attrs, cell.marks);
      }
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });

  return tr.setNodeMarkup(table.pos, undefined, {
    ...tr.doc.nodeAt(table.pos)!.attrs,
    headerRow: next.row,
    headerColumn: next.column,
  });
}

export function setTableFitWidth(
  tr: Transaction,
  table: TableAt,
  fitPageWidth: boolean,
) {
  return tr.setNodeMarkup(table.pos, undefined, {
    ...tr.doc.nodeAt(table.pos)!.attrs,
    fitPageWidth,
  });
}

function getColumnMeta(table: ProseMirrorNode): ColumnMeta[] {
  return Array.isArray(table.attrs.colMeta)
    ? table.attrs.colMeta.map((column: ColumnMeta | null) => ({
        ...column,
      }))
    : [];
}

function withColumnMeta(table: ProseMirrorNode, columns: ColumnMeta[]) {
  return {
    ...table.attrs,
    colMeta: columns.some((column) => column.color || column.width)
      ? columns
      : null,
  };
}

function setColumnMeta(
  tr: Transaction,
  tablePos: number,
  columns: ColumnMeta[],
) {
  return tr.setNodeMarkup(
    tablePos,
    undefined,
    withColumnMeta(tr.doc.nodeAt(tablePos)!, columns),
  );
}

export function getRowColor(table: ProseMirrorNode, rowIndex: number) {
  return (table.maybeChild(rowIndex)?.attrs.color as string | null) ?? null;
}

export function getColumnColor(table: ProseMirrorNode, columnIndex: number) {
  return getColumnMeta(table)[columnIndex]?.color ?? null;
}

export function setRowColor(
  tr: Transaction,
  table: TableAt,
  rowIndex: number,
  color: string | null,
) {
  let rowPos = table.pos + 1;
  for (let index = 0; index < rowIndex; index += 1) {
    rowPos += table.node.child(index).nodeSize;
  }
  const row = table.node.child(rowIndex);
  return tr.setNodeMarkup(rowPos, undefined, { ...row.attrs, color });
}

export function setColumnColor(
  tr: Transaction,
  table: TableAt,
  columnIndex: number,
  color: string | null,
) {
  const columns = getColumnMeta(tr.doc.nodeAt(table.pos)!);
  while (columns.length <= columnIndex) columns.push({});
  columns[columnIndex] = { ...columns[columnIndex], color };
  return setColumnMeta(tr, table.pos, columns);
}

function tableRect(doc: ProseMirrorNode, tablePos: number): TableRect {
  const table = doc.nodeAt(tablePos)!;
  const map = TableMap.get(table);
  return {
    map,
    table,
    tableStart: tablePos + 1,
    left: 0,
    top: 0,
    right: map.width,
    bottom: map.height,
  };
}

// Columns carry their colour in `colMeta`, by index, so anything that adds or
// removes a column moves those entries with it.
function splicedColumnMeta(
  table: ProseMirrorNode,
  columnIndex: number,
  deleteCount: number,
  ...inserted: ColumnMeta[]
) {
  const columns = getColumnMeta(table);
  if (columns.length < columnIndex) return null;
  columns.splice(columnIndex, deleteCount, ...inserted);
  return columns;
}

function spliceColumnMeta(
  tr: Transaction,
  tablePos: number,
  columnIndex: number,
  deleteCount: number,
  ...inserted: ColumnMeta[]
) {
  const columns = splicedColumnMeta(
    tr.doc.nodeAt(tablePos)!,
    columnIndex,
    deleteCount,
    ...inserted,
  );
  return columns ? setColumnMeta(tr, tablePos, columns) : tr;
}

export function insertTableColumn(
  tr: Transaction,
  table: TableAt,
  columnIndex: number,
) {
  // addColumn maps its positions through every step in the transaction it's
  // given, so on one that already holds steps it inserts in the wrong place.
  const own = EditorState.create({ doc: tr.doc }).tr;
  addColumn(own, tableRect(own.doc, table.pos), columnIndex);
  for (const step of own.steps) tr.step(step);
  return spliceColumnMeta(tr, table.pos, columnIndex, 0, {});
}

/** The table's attributes once a copy of a column is inserted after it. */
function attrsWithDuplicatedColumn(
  table: ProseMirrorNode,
  columnIndex: number,
) {
  const source = getColumnMeta(table)[columnIndex];
  const columns =
    source && splicedColumnMeta(table, columnIndex + 1, 0, { ...source });
  return columns ? withColumnMeta(table, columns) : table.attrs;
}

/**
 * The table with a copy of a column inserted after it. The column is counted
 * by the table's grid, as `colMeta` is, so a merged cell can't shift the copy
 * off its colour. A cell merged across the column grows by one column.
 */
export function tableWithDuplicatedColumn(
  table: ProseMirrorNode,
  columnIndex: number,
) {
  const map = TableMap.get(table);
  const rows: ProseMirrorNode[] = [];
  table.forEach((row, rowOffset) => {
    const cells: ProseMirrorNode[] = [];
    row.forEach((cell, cellOffset) => {
      const { left, right } = map.findCell(rowOffset + 1 + cellOffset);
      if (left > columnIndex || right <= columnIndex) cells.push(cell);
      else if (right - left === 1) cells.push(cell, cell.copy(cell.content));
      else {
        const at = columnIndex - left;
        const attrs = addColSpan(cell.attrs as CellAttrs, at + 1);
        if (attrs.colwidth) attrs.colwidth[at + 1] = attrs.colwidth[at];
        cells.push(cell.type.create(attrs, cell.content, cell.marks));
      }
    });
    rows.push(row.copy(Fragment.fromArray(cells)));
  });
  return table.type.create(
    attrsWithDuplicatedColumn(table, columnIndex),
    Fragment.fromArray(rows),
    table.marks,
  );
}

export function deleteTableColumn(
  tr: Transaction,
  table: TableAt,
  columnIndex: number,
) {
  removeColumn(tr, tableRect(tr.doc, table.pos), columnIndex);
  return spliceColumnMeta(tr, table.pos, columnIndex, 1);
}

// A merged cell's row and column menus act on every row or column it covers.
type CellSpan = Pick<TableRect, "left" | "right" | "top" | "bottom">;

export function setColumnColors(
  tr: Transaction,
  table: TableAt,
  cell: CellSpan,
  color: string | null,
) {
  for (let column = cell.left; column < cell.right; column += 1) {
    setColumnColor(tr, table, column, color);
  }
  return tr;
}

export function setRowColors(
  tr: Transaction,
  table: TableAt,
  cell: CellSpan,
  color: string | null,
) {
  for (let row = cell.top; row < cell.bottom; row += 1) {
    setRowColor(tr, table, row, color);
  }
  return tr;
}

export function deleteTableColumns(
  tr: Transaction,
  table: TableAt,
  cell: CellSpan,
) {
  for (let column = cell.right - 1; column >= cell.left; column -= 1) {
    deleteTableColumn(tr, table, column);
  }
  return tr;
}

export function deleteTableRows(
  tr: Transaction,
  table: TableAt,
  cell: CellSpan,
) {
  for (let row = cell.bottom - 1; row >= cell.top; row -= 1) {
    deleteTableRow(tr, table, row);
  }
  return tr;
}

export function insertTableRow(
  tr: Transaction,
  table: TableAt,
  rowIndex: number,
) {
  return addRow(tr, tableRect(tr.doc, table.pos), rowIndex);
}

export function deleteTableRow(
  tr: Transaction,
  table: TableAt,
  rowIndex: number,
) {
  removeRow(tr, tableRect(tr.doc, table.pos), rowIndex);
  return tr;
}

/**
 * A table's size by its grid, as these commands count it: a cell merged
 * across columns takes up every column it spans.
 */
export function tableGridSize(table: ProseMirrorNode) {
  return { rows: table.childCount, columns: TableMap.get(table).width };
}

/** Adds or removes columns at the table's end until it has `count`. */
export function setTableColumnCount(
  tr: Transaction,
  table: TableAt,
  count: number,
) {
  let { columns } = tableGridSize(table.node);
  for (; columns < count; columns += 1) insertTableColumn(tr, table, columns);
  for (; columns > count; columns -= 1) {
    deleteTableColumn(tr, table, columns - 1);
  }
  return tr;
}

/** Adds or removes rows at the table's end until it has `count`. */
export function setTableRowCount(
  tr: Transaction,
  table: TableAt,
  count: number,
) {
  let { rows } = tableGridSize(table.node);
  for (; rows < count; rows += 1) insertTableRow(tr, table, rows);
  for (; rows > count; rows -= 1) deleteTableRow(tr, table, rows - 1);
  return tr;
}
