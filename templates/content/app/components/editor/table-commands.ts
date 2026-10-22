import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  addColumn,
  addRow,
  removeColumn,
  removeRow,
  TableMap,
  type TableRect,
} from "@tiptap/pm/tables";

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
// table's own attributes in step with them.
export function getTableHeaders(table: ProseMirrorNode): TableHeaders {
  const rows = children(table);
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
  const columns = getColumnMeta(table.node);
  while (columns.length <= columnIndex) columns.push({});
  columns[columnIndex] = { ...columns[columnIndex], color };
  return setColumnMeta(tr, table.pos, columns);
}

function tableRect(tr: Transaction, tablePos: number): TableRect {
  const table = tr.doc.nodeAt(tablePos)!;
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
  addColumn(tr, tableRect(tr, table.pos), columnIndex);
  return spliceColumnMeta(tr, table.pos, columnIndex, 0, {});
}

/** The table's attributes once a copy of a column is inserted after it. */
export function attrsWithDuplicatedColumn(
  table: ProseMirrorNode,
  columnIndex: number,
) {
  const source = getColumnMeta(table)[columnIndex];
  const columns =
    source && splicedColumnMeta(table, columnIndex + 1, 0, { ...source });
  return columns ? withColumnMeta(table, columns) : table.attrs;
}

export function deleteTableColumn(
  tr: Transaction,
  table: TableAt,
  columnIndex: number,
) {
  removeColumn(tr, tableRect(tr, table.pos), columnIndex);
  return spliceColumnMeta(tr, table.pos, columnIndex, 1);
}

export function insertTableRow(
  tr: Transaction,
  table: TableAt,
  rowIndex: number,
) {
  return addRow(tr, tableRect(tr, table.pos), rowIndex);
}

export function deleteTableRow(
  tr: Transaction,
  table: TableAt,
  rowIndex: number,
) {
  removeRow(tr, tableRect(tr, table.pos), rowIndex);
  return tr;
}
