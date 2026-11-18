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

export function tableIndexAt(doc: ProseMirrorNode, tablePos: number) {
  let currentIndex = -1;
  let result = -1;

  doc.descendants((node, pos) => {
    if (result >= 0) return false;
    if (node.type.name !== "table") return !node.isTextblock;

    currentIndex += 1;
    if (pos === tablePos) result = currentIndex;
    return true;
  });

  return result;
}

function tableNodeAt(doc: ProseMirrorNode, tablePos: number) {
  const table = doc.nodeAt(tablePos);
  if (!table) throw new Error(`No table at position ${tablePos}`);
  return table;
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
    ...tableNodeAt(tr.doc, table.pos).attrs,
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
    ...tableNodeAt(tr.doc, table.pos).attrs,
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
    withColumnMeta(tableNodeAt(tr.doc, tablePos), columns),
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
  const columns = getColumnMeta(tableNodeAt(tr.doc, table.pos));
  while (columns.length <= columnIndex) columns.push({});
  columns[columnIndex] = { ...columns[columnIndex], color };
  return setColumnMeta(tr, table.pos, columns);
}

function tableRect(doc: ProseMirrorNode, tablePos: number): TableRect {
  const table = tableNodeAt(doc, tablePos);
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
    tableNodeAt(tr.doc, tablePos),
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
  const columns = getColumnMeta(table);
  if (columnIndex >= columns.length) return table.attrs;
  columns.splice(columnIndex + 1, 0, { ...columns[columnIndex] });
  return withColumnMeta(table, columns);
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
      if (columnIndex < left || columnIndex >= right) cells.push(cell);
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

export type TableAxis = "row" | "column";

export interface TableSpan {
  start: number;
  end: number;
}

export function tableMoveGaps(table: ProseMirrorNode, axis: TableAxis) {
  const map = TableMap.get(table);
  const covered = new Set<number>();
  for (const cellPos of new Set(map.map)) {
    const cell = map.findCell(cellPos);
    const [start, end] =
      axis === "row" ? [cell.top, cell.bottom] : [cell.left, cell.right];
    for (let gap = start + 1; gap < end; gap += 1) covered.add(gap);
  }
  const size = axis === "row" ? map.height : map.width;
  return Array.from({ length: size + 1 }, (_, gap) => gap).filter(
    (gap) => !covered.has(gap),
  );
}

export function tableMoveBlock(
  table: ProseMirrorNode,
  axis: TableAxis,
  span: TableSpan,
): TableSpan {
  const gaps = tableMoveGaps(table, axis);
  return {
    start: Math.max(...gaps.filter((gap) => gap <= span.start)),
    end: Math.min(...gaps.filter((gap) => gap >= span.end)),
  };
}

export function tableMoveChangesOrder(block: TableSpan, gap: number) {
  return gap < block.start || gap > block.end;
}

export function movedBlockStart(block: TableSpan, gap: number) {
  return gap < block.start ? gap : gap - (block.end - block.start);
}

function keepHeaders(
  tr: Transaction,
  tablePos: number,
  headers: TableHeaders,
  axis: TableAxis,
  block: TableSpan,
  gap: number,
) {
  if (!(axis === "row" ? headers.row : headers.column)) return;
  if (block.start !== 0 && gap !== 0) return;
  setTableHeaders(
    tr,
    { node: tableNodeAt(tr.doc, tablePos), pos: tablePos },
    headers,
  );
}

function childOffset(node: ProseMirrorNode, index: number) {
  let offset = 0;
  for (let child = 0; child < index; child += 1) {
    offset += node.child(child).nodeSize;
  }
  return offset;
}

export type TakenTableBlock =
  | { axis: "row"; at: number; rows: Fragment }
  | {
      axis: "column";
      parts: { row: number; at: number; cells: Fragment }[];
    };

export function takeTableBlock(
  tr: Transaction,
  table: TableAt,
  axis: TableAxis,
  block: TableSpan,
  gap: number,
): TakenTableBlock {
  const contentPos = table.pos + 1;
  if (axis === "row") {
    const from = childOffset(table.node, block.start);
    const to = childOffset(table.node, block.end);
    tr.delete(contentPos + from, contentPos + to);
    return {
      axis,
      at: movedBlockStart(block, gap),
      rows: table.node.content.cut(from, to),
    };
  }

  const map = TableMap.get(table.node);
  const firstStep = tr.steps.length;
  const mapped = (pos: number) => tr.mapping.slice(firstStep).map(pos);
  const parts: { row: number; at: number; cells: Fragment }[] = [];
  table.node.forEach((row, rowOffset, rowIndex) => {
    let from = -1;
    let to = -1;
    let at = -1;
    row.forEach((_cell, cellOffset, cellIndex) => {
      const { left } = map.findCell(rowOffset + 1 + cellOffset);
      if (left >= block.start && left < block.end) {
        if (from < 0) from = cellIndex;
        to = cellIndex + 1;
      } else if (at < 0 && left >= gap) {
        at = cellIndex;
      }
    });
    if (from < 0) return;
    if (at < 0) at = row.childCount;

    const rowPos = contentPos + rowOffset + 1;
    const start = childOffset(row, from);
    const end = childOffset(row, to);
    tr.delete(mapped(rowPos + start), mapped(rowPos + end));
    parts.push({
      row: rowIndex,
      at: at > from ? at - (to - from) : at,
      cells: row.content.cut(start, end),
    });
  });
  return { axis, parts };
}

export function putTableBlock(
  tr: Transaction,
  tablePos: number,
  taken: TakenTableBlock,
) {
  if (taken.axis === "row") {
    const table = tableNodeAt(tr.doc, tablePos);
    tr.insert(tablePos + 1 + childOffset(table, taken.at), taken.rows);
    return tr;
  }
  for (const part of taken.parts) {
    const table = tableNodeAt(tr.doc, tablePos);
    const rowPos = tablePos + 1 + childOffset(table, part.row) + 1;
    tr.insert(rowPos + childOffset(table.child(part.row), part.at), part.cells);
  }
  return tr;
}

export function finishTableMove(
  tr: Transaction,
  tablePos: number,
  before: ProseMirrorNode,
  axis: TableAxis,
  block: TableSpan,
  gap: number,
) {
  const columns = axis === "column" ? getColumnMeta(before) : [];
  if (columns.length > 0) {
    while (columns.length < TableMap.get(before).width) columns.push({});
    const moved = columns.splice(block.start, block.end - block.start);
    columns.splice(movedBlockStart(block, gap), 0, ...moved);
    const isEmpty = (column: ColumnMeta | undefined) =>
      !column?.color && !column?.width;
    while (columns.length > 0 && isEmpty(columns[columns.length - 1])) {
      columns.pop();
    }
    setColumnMeta(tr, tablePos, columns);
  }
  keepHeaders(tr, tablePos, getTableHeaders(before), axis, block, gap);
  return tr;
}

function moveTableBlock(
  tr: Transaction,
  table: TableAt,
  axis: TableAxis,
  block: TableSpan,
  gap: number,
) {
  if (!tableMoveChangesOrder(block, gap)) return tr;
  putTableBlock(tr, table.pos, takeTableBlock(tr, table, axis, block, gap));
  return finishTableMove(tr, table.pos, table.node, axis, block, gap);
}

export function moveTableRows(
  tr: Transaction,
  table: TableAt,
  block: TableSpan,
  gap: number,
) {
  return moveTableBlock(tr, table, "row", block, gap);
}

export function moveTableColumns(
  tr: Transaction,
  table: TableAt,
  block: TableSpan,
  gap: number,
) {
  return moveTableBlock(tr, table, "column", block, gap);
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
