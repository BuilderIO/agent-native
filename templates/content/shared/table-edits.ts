import {
  docToNfm,
  locateNfmTables,
  NFM_BASE_COLORS,
  nfmToDoc,
  parseNfmWithLosses,
  type NfmTableSource,
  type PMDoc,
  type PMNode,
} from "./nfm.js";

export type TableOperation =
  | {
      op: "insert-row";
      at?: number | undefined;
      cells?: string[] | undefined;
    }
  | { op: "delete-row"; row: number }
  | { op: "move-row"; row: number; to: number }
  | { op: "duplicate-row"; row: number }
  | { op: "clear-row"; row: number }
  | {
      op: "insert-column";
      at?: number | undefined;
      cells?: string[] | undefined;
    }
  | { op: "delete-column"; column: number }
  | { op: "move-column"; column: number; to: number }
  | { op: "duplicate-column"; column: number }
  | { op: "clear-column"; column: number }
  | { op: "set-cell"; row: number; column: number; text: string }
  | { op: "set-header-row"; value: boolean }
  | { op: "set-header-column"; value: boolean }
  | { op: "set-fit-page-width"; value: boolean }
  | {
      op: "set-color";
      row?: number | undefined;
      column?: number | undefined;
      color: TableColor | null;
    };

export const TABLE_OPERATION_NAMES = [
  "insert-row",
  "delete-row",
  "move-row",
  "duplicate-row",
  "clear-row",
  "insert-column",
  "delete-column",
  "move-column",
  "duplicate-column",
  "clear-column",
  "set-cell",
  "set-header-row",
  "set-header-column",
  "set-fit-page-width",
  "set-color",
] as const satisfies readonly TableOperation["op"][];

export const TABLE_COLORS = [
  ...NFM_BASE_COLORS,
  ...NFM_BASE_COLORS.map((color) => `${color}_bg` as const),
] as const;
export type TableColor = (typeof TABLE_COLORS)[number];

export type TableEditErrorCode =
  | "TABLE_NOT_FOUND"
  | "TABLE_NOT_LOCATED"
  | "TABLE_POSITION_OUT_OF_RANGE"
  | "TABLE_OPERATION_INVALID"
  | "TABLE_EDIT_UNVERIFIED";

export class TableEditError extends Error {
  constructor(
    readonly code: TableEditErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TableEditError";
  }
}

export interface TableSummary {
  table: number;
  rows: number;
  columns: number;
  headerRow: boolean;
  headerColumn: boolean;
  fitPageWidth: boolean;
}

export interface NfmTableEdit {
  edit: { find: string; replace: string };
  summary: TableSummary;
  changed: boolean;
  markdown: string;
}

interface Cell {
  attrs: Record<string, unknown>;
  content: PMNode[];
}

interface Row {
  attrs: Record<string, unknown>;
  cells: Cell[];
}

interface ColumnMeta {
  color?: string | null;
  width?: string | null;
}

interface TableModel {
  attrs: Record<string, unknown>;
  columns: ColumnMeta[];
  rows: Row[];
  width: number;
}

const clone = <T>(value: T): T => structuredClone(value);

function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return items[index];
}

function entry<T>(items: readonly T[], index: number, operation: number): T {
  const item = itemAt(items, index);
  if (item === undefined) {
    throw new TableEditError(
      "TABLE_POSITION_OUT_OF_RANGE",
      `Operation ${operation}: position ${index + 1} is out of range.`,
      { operation },
    );
  }
  return item;
}

const TABLE_TAG = /<\/?(?:table|colgroup|col|thead|tbody|tr|td|th)\b/i;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

function outsideCode(text: string): string {
  return text.includes("\\") ? text : text.replace(CODE_SPAN, "");
}

function cellContent(text: string, operation: number): PMNode[] {
  if (/[\r\n]/.test(text)) {
    throw new TableEditError(
      "TABLE_OPERATION_INVALID",
      `Operation ${operation}: a cell's text is one line; use <br> for a line break.`,
      { operation },
    );
  }
  if (TABLE_TAG.test(outsideCode(text)) || CONTROL_CHARACTER.test(text)) {
    throw new TableEditError(
      "TABLE_OPERATION_INVALID",
      `Operation ${operation}: a cell's text can't hold table tags or control characters.`,
      { operation },
    );
  }
  const { doc, losses } = parseNfmWithLosses(
    `<table>\n<tr>\n<td>${text}</td>\n</tr>\n</table>`,
  );
  const table = itemAt(doc.content, 0);
  const row =
    table?.type === "table" ? itemAt(table.content ?? [], 0) : undefined;
  const cell = row && itemAt(row.content ?? [], 0);
  if (
    losses.length > 0 ||
    doc.content.length !== 1 ||
    table?.content?.length !== 1 ||
    row?.content?.length !== 1 ||
    !cell
  ) {
    throw new TableEditError(
      "TABLE_OPERATION_INVALID",
      `Operation ${operation}: the text isn't the content of one cell.`,
      { operation },
    );
  }
  return cell.content ?? [];
}

function emptyCell(attrs: Record<string, unknown> = {}): Cell {
  return {
    attrs: { color: null, textAlign: null, ...attrs },
    content: cellContent("", 0),
  };
}

function toModel(table: PMNode): TableModel {
  const rows: Row[] = (table.content ?? []).map((row) => ({
    attrs: { color: null, ...clone(row.attrs ?? {}) },
    cells: (row.content ?? []).map((cell) => ({
      attrs: { color: null, textAlign: null, ...clone(cell.attrs ?? {}) },
      content: clone(cell.content ?? []),
    })),
  }));
  let width = 0;
  for (const row of rows) width = Math.max(width, row.cells.length);
  for (const row of rows) {
    while (row.cells.length < width) row.cells.push(emptyCell());
  }
  const attrs = clone(table.attrs ?? {});
  const columns: ColumnMeta[] = Array.isArray(attrs.colMeta)
    ? attrs.colMeta.map((column: ColumnMeta | null) => ({ ...column }))
    : [];
  return { attrs, columns, rows, width };
}

function fromModel(model: TableModel): PMNode {
  const headerRow = model.attrs.headerRow === true;
  const headerColumn = model.attrs.headerColumn === true;
  return {
    type: "table",
    attrs: {
      ...model.attrs,
      headerRow,
      headerColumn,
      fitPageWidth: model.attrs.fitPageWidth === true,
      colMeta: model.columns.some((column) => column.color || column.width)
        ? model.columns.map((column) => ({
            ...(column.color ? { color: column.color } : {}),
            ...(column.width ? { width: column.width } : {}),
          }))
        : null,
    },
    content: model.rows.map((row, rowIndex) => ({
      type: "tableRow",
      attrs: row.attrs,
      content: row.cells.map((cell, columnIndex) => ({
        type:
          (headerRow && rowIndex === 0) || (headerColumn && columnIndex === 0)
            ? "tableHeader"
            : "tableCell",
        attrs: cell.attrs,
        content: cell.content,
      })),
    })),
  };
}

function positionIndex(
  value: number,
  count: number,
  axis: "row" | "column",
  operation: number,
  field: string,
): number {
  if (!Number.isInteger(value) || value < 1 || value > count) {
    throw new TableEditError(
      "TABLE_POSITION_OUT_OF_RANGE",
      count === 0
        ? `Operation ${operation}: ${field} ${value} is out of range; the table has no ${axis}s.`
        : `Operation ${operation}: ${field} ${value} is out of range; the table has ${axis}s 1 to ${count}.`,
      { operation, field, value, [`${axis}s`]: count },
    );
  }
  return value - 1;
}

function newCells(
  texts: string[] | undefined,
  count: number,
  axis: "row" | "column",
  operation: number,
): Cell[] {
  if (texts && texts.length > count) {
    throw new TableEditError(
      "TABLE_OPERATION_INVALID",
      `Operation ${operation}: ${texts.length} cells were given for a ${axis} of ${count}.`,
      {
        operation,
        cells: texts.length,
        [axis === "row" ? "columns" : "rows"]: count,
      },
    );
  }
  return Array.from({ length: count }, (_, index) => {
    const cell = emptyCell();
    const text = texts?.[index];
    if (text) cell.content = cellContent(text, operation);
    return cell;
  });
}

function columnAlignments(model: TableModel): Array<string | null> {
  return Array.from({ length: model.width }, (_, column) => {
    const first = model.rows[0]?.cells[column]?.attrs.textAlign;
    if (first !== "left" && first !== "center" && first !== "right") {
      return null;
    }
    return model.rows.every(
      (row) => row.cells[column]?.attrs.textAlign === first,
    )
      ? first
      : null;
  });
}

function clearedCell(cell: Cell): Cell {
  return { attrs: cell.attrs, content: emptyCell().content };
}

const isEmptyColumn = (column: ColumnMeta | undefined) =>
  !column?.color && !column?.width;

function applyOperation(
  model: TableModel,
  operation: TableOperation,
  number: number,
) {
  const rowIndex = (row: number, field = "row") =>
    positionIndex(row, model.rows.length, "row", number, field);
  const columnIndex = (column: number, field = "column") =>
    positionIndex(column, model.width, "column", number, field);
  const rowAt = (row: number) => entry(model.rows, rowIndex(row), number);
  const cellAt = (row: number, column: number) =>
    entry(rowAt(row).cells, columnIndex(column), number);
  const keepOne = (axis: "row" | "column") => {
    throw new TableEditError(
      "TABLE_OPERATION_INVALID",
      `Operation ${number}: a table keeps at least one ${axis}; remove the whole table with edit-document instead.`,
      { operation: number },
    );
  };

  switch (operation.op) {
    case "insert-row": {
      const at =
        operation.at === undefined
          ? model.rows.length
          : positionIndex(
              operation.at,
              model.rows.length + 1,
              "row",
              number,
              "at",
            );
      const alignments = columnAlignments(model);
      const cells = newCells(operation.cells, model.width, "row", number).map(
        (cell, column) =>
          alignments[column]
            ? {
                ...cell,
                attrs: { ...cell.attrs, textAlign: alignments[column] },
              }
            : cell,
      );
      model.rows.splice(at, 0, { attrs: { color: null }, cells });
      return;
    }
    case "delete-row": {
      const at = rowIndex(operation.row);
      if (model.rows.length === 1) keepOne("row");
      model.rows.splice(at, 1);
      return;
    }
    case "move-row": {
      const from = rowIndex(operation.row);
      const to = rowIndex(operation.to, "to");
      const row = entry(model.rows, from, number);
      model.rows.splice(from, 1);
      model.rows.splice(to, 0, row);
      return;
    }
    case "duplicate-row": {
      const at = rowIndex(operation.row);
      model.rows.splice(at + 1, 0, clone(entry(model.rows, at, number)));
      return;
    }
    case "clear-row": {
      const row = rowAt(operation.row);
      row.cells = row.cells.map(clearedCell);
      return;
    }
    case "insert-column": {
      const at =
        operation.at === undefined
          ? model.width
          : positionIndex(
              operation.at,
              model.width + 1,
              "column",
              number,
              "at",
            );
      const cells = newCells(
        operation.cells,
        model.rows.length,
        "column",
        number,
      );
      model.rows.forEach((row, index) =>
        row.cells.splice(at, 0, entry(cells, index, number)),
      );
      model.width += 1;
      if (model.columns.length >= at) model.columns.splice(at, 0, {});
      return;
    }
    case "delete-column": {
      const at = columnIndex(operation.column);
      if (model.width === 1) keepOne("column");
      for (const row of model.rows) row.cells.splice(at, 1);
      model.width -= 1;
      model.columns.splice(at, 1);
      return;
    }
    case "move-column": {
      const from = columnIndex(operation.column);
      const to = columnIndex(operation.to, "to");
      for (const row of model.rows) {
        const cell = entry(row.cells, from, number);
        row.cells.splice(from, 1);
        row.cells.splice(to, 0, cell);
      }
      if (model.columns.length > 0) {
        while (model.columns.length < model.width) model.columns.push({});
        const moved = entry(model.columns, from, number);
        model.columns.splice(from, 1);
        model.columns.splice(to, 0, moved);
        while (isEmptyColumn(model.columns[model.columns.length - 1])) {
          model.columns.pop();
          if (model.columns.length === 0) break;
        }
      }
      return;
    }
    case "duplicate-column": {
      const at = columnIndex(operation.column);
      for (const row of model.rows) {
        row.cells.splice(at + 1, 0, clone(entry(row.cells, at, number)));
      }
      model.width += 1;
      if (at < model.columns.length) {
        model.columns.splice(at + 1, 0, { ...model.columns[at] });
      }
      return;
    }
    case "clear-column": {
      const at = columnIndex(operation.column);
      for (const row of model.rows) {
        row.cells[at] = clearedCell(entry(row.cells, at, number));
      }
      return;
    }
    case "set-cell": {
      const cell = cellAt(operation.row, operation.column);
      cell.content = cellContent(operation.text, number);
      return;
    }
    case "set-header-row":
      model.attrs.headerRow = operation.value;
      return;
    case "set-header-column":
      model.attrs.headerColumn = operation.value;
      return;
    case "set-fit-page-width":
      model.attrs.fitPageWidth = operation.value;
      return;
    case "set-color": {
      const color = operation.color ?? null;
      if (
        color !== null &&
        !(TABLE_COLORS as readonly string[]).includes(color)
      ) {
        throw new TableEditError(
          "TABLE_OPERATION_INVALID",
          `Operation ${number}: "${color}" isn't a table colour; use one of ${TABLE_COLORS.join(", ")}, or null to clear it.`,
          { operation: number },
        );
      }
      if (operation.row !== undefined && operation.column !== undefined) {
        const cell = cellAt(operation.row, operation.column);
        cell.attrs = { ...cell.attrs, color };
      } else if (operation.row !== undefined) {
        const row = rowAt(operation.row);
        row.attrs = { ...row.attrs, color };
      } else if (operation.column !== undefined) {
        const at = columnIndex(operation.column);
        while (model.columns.length <= at) model.columns.push({});
        model.columns[at] = { ...model.columns[at], color };
      } else {
        throw new TableEditError(
          "TABLE_OPERATION_INVALID",
          `Operation ${number}: set-color needs a row, a column, or both for one cell.`,
          { operation: number },
        );
      }
      return;
    }
    default: {
      const unknown: never = operation;
      throw new TableEditError(
        "TABLE_OPERATION_INVALID",
        `Operation ${number}: unknown operation ${JSON.stringify((unknown as { op?: unknown }).op)}.`,
        { operation: number },
      );
    }
  }
}

export function applyTableOperations(
  table: PMNode,
  operations: readonly TableOperation[],
): PMNode {
  const model = toModel(table);
  operations.forEach((operation, index) =>
    applyOperation(model, operation, index + 1),
  );
  return fromModel(model);
}

function leadingTabs(line: string): number {
  let tabs = 0;
  while (line[tabs] === "\t") tabs++;
  return tabs;
}

function withoutIndent(table: PMNode): PMNode {
  const { indent: _indent, ...attrs } = table.attrs ?? {};
  return { ...table, attrs };
}

function pageTables(doc: PMDoc): PMNode[] {
  const tables: PMNode[] = [];
  const visit = (nodes: PMNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "table") tables.push(node);
      else visit(node.content);
    }
  };
  visit(doc.content);
  return tables;
}

function sourceText(lines: readonly string[], source: NfmTableSource) {
  return lines
    .slice(source.startLine, source.endLine)
    .map((line) => line.slice(Math.min(source.indent, leadingTabs(line))))
    .join("\n");
}

function sourceTable(lines: readonly string[], source: NfmTableSource) {
  const doc = nfmToDoc(sourceText(lines, source));
  const first = itemAt(doc.content, 0);
  return doc.content.length === 1 && first?.type === "table" ? first : null;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const tableColor = (value: unknown) =>
  (TABLE_COLORS as readonly unknown[]).includes(value) ? value : null;
const tableAlignment = (value: unknown) =>
  value === "left" || value === "center" || value === "right" ? value : null;

function tableShape(table: PMNode) {
  const columns = (
    Array.isArray(table.attrs?.colMeta) ? table.attrs.colMeta : []
  ).map((column: ColumnMeta | null) => [
    tableColor(column?.color),
    column?.width || null,
  ]);
  for (
    let last = itemAt(columns, columns.length - 1);
    last && !last[0] && !last[1];
    last = itemAt(columns, columns.length - 1)
  ) {
    columns.pop();
  }
  return {
    headerRow: table.attrs?.headerRow === true,
    headerColumn: table.attrs?.headerColumn === true,
    fitPageWidth: table.attrs?.fitPageWidth === true,
    columns,
    rows: (table.content ?? []).map((row) => ({
      color: tableColor(row.attrs?.color),
      cells: (row.content ?? []).map((cell) => [
        tableColor(cell.attrs?.color),
        tableAlignment(cell.attrs?.textAlign),
        cell.content ?? [],
      ]),
    })),
  };
}

function countMatches(text: string, find: string): number {
  let count = 0;
  for (
    let at = text.indexOf(find);
    at !== -1 && count < 2;
    at = text.indexOf(find, at + 1)
  ) {
    count++;
  }
  return count;
}

function uniqueEdit(
  lines: readonly string[],
  source: NfmTableSource,
  replacement: readonly string[],
): { find: string; replace: string } {
  const markdown = lines.join("\n");
  let start = source.startLine;
  let end = source.endLine;
  for (;;) {
    const find = lines.slice(start, end).join("\n");
    if (countMatches(markdown, find) === 1) {
      return {
        find,
        replace: [
          ...lines.slice(start, source.startLine),
          ...replacement,
          ...lines.slice(source.endLine, end),
        ].join("\n"),
      };
    }
    if (start > 0) start--;
    else if (end < lines.length) end++;
    else {
      throw new TableEditError(
        "TABLE_NOT_LOCATED",
        "The table's text can't be told apart from the rest of the page; change it with edit-document.",
      );
    }
  }
}

function probeText(markdown: string, doc: PMDoc): string {
  const parsed = JSON.stringify(doc);
  let attempt = 0;
  while (
    markdown.includes(`edittableprobe${attempt}`) ||
    parsed.includes(`edittableprobe${attempt}`)
  ) {
    attempt++;
  }
  return `edittableprobe${attempt}`;
}

function replaceTable(nodes: PMNode[], index: number, table: PMNode): PMNode[] {
  let seen = 0;
  const visit = (list: PMNode[]): PMNode[] =>
    list.map((node) => {
      if (node.type === "table") return seen++ === index ? table : node;
      return node.content ? { ...node, content: visit(node.content) } : node;
    });
  return visit(nodes);
}

function summarize(table: PMNode, number: number): TableSummary {
  const rows = table.content ?? [];
  let columns = 0;
  for (const row of rows) columns = Math.max(columns, row.content?.length ?? 0);
  return {
    table: number,
    rows: rows.length,
    columns,
    headerRow: table.attrs?.headerRow === true,
    headerColumn: table.attrs?.headerColumn === true,
    fitPageWidth: table.attrs?.fitPageWidth === true,
  };
}

export function countNfmTables(markdown: string): number {
  return pageTables(nfmToDoc(markdown)).length;
}

export function editNfmTable(
  markdown: string,
  tableNumber: number,
  operations: readonly TableOperation[],
): NfmTableEdit {
  const doc = nfmToDoc(markdown);
  const tables = pageTables(doc);
  if (
    !Number.isInteger(tableNumber) ||
    tableNumber < 1 ||
    tableNumber > tables.length
  ) {
    throw new TableEditError(
      "TABLE_NOT_FOUND",
      tables.length === 0
        ? "The page has no tables."
        : `The page has tables 1 to ${tables.length}; there is no table ${tableNumber}.`,
      { tables: tables.length },
    );
  }
  const notLocated = () =>
    new TableEditError(
      "TABLE_NOT_LOCATED",
      "This table's text couldn't be found exactly on the page; change it with edit-document.",
      { tables: tables.length },
    );
  if (markdown.includes("\r")) throw notLocated();
  const lines = markdown.split("\n");
  const sources = locateNfmTables(lines);
  if (sources.length !== tables.length) throw notLocated();
  sources.forEach((source, index) => {
    const parsed = itemAt(tables, index);
    const found = sourceTable(lines, source);
    if (!parsed || !found || !same(found, withoutIndent(parsed))) {
      throw notLocated();
    }
  });

  const index = tableNumber - 1;
  const source = itemAt(sources, index);
  const before = itemAt(tables, index);
  if (!source || !before) throw notLocated();
  if (parseNfmWithLosses(sourceText(lines, source)).losses.length > 0) {
    throw new TableEditError(
      "TABLE_NOT_LOCATED",
      "This table's text holds lines or attributes a table can't keep, and rewriting it would drop them; change it with edit-document.",
      { table: tableNumber },
    );
  }
  const indented = (text: string) =>
    text.split("\n").map((line) => "\t".repeat(source.indent) + line);
  const swap = (replacement: readonly string[]) => {
    const nextLines = [
      ...lines.slice(0, source.startLine),
      ...replacement,
      ...lines.slice(source.endLine),
    ];
    const written = sourceTable(nextLines, {
      startLine: source.startLine,
      endLine: source.startLine + replacement.length,
      indent: source.indent,
    });
    if (!written) return null;
    const placed = {
      ...written,
      attrs: {
        ...written.attrs,
        ...(before.attrs?.indent !== undefined
          ? { indent: before.attrs.indent }
          : {}),
      },
    };
    const expected: PMDoc = {
      ...doc,
      content: replaceTable(doc.content, index, placed),
    };
    return same(nfmToDoc(nextLines.join("\n")), expected)
      ? { written, nextLines }
      : null;
  };
  const probe = `<table>\n<tr>\n<td>${probeText(markdown, doc)}</td>\n</tr>\n</table>`;
  if (!swap(indented(probe))) throw notLocated();

  const after = applyTableOperations(withoutIndent(before), operations);
  const replacement = indented(docToNfm({ type: "doc", content: [after] }));
  const swapped = swap(replacement);
  if (!swapped || !same(tableShape(swapped.written), tableShape(after))) {
    throw new TableEditError(
      "TABLE_EDIT_UNVERIFIED",
      "The changed table didn't read back as intended, so nothing was saved; change it with edit-document.",
      { table: tableNumber },
    );
  }

  const nextMarkdown = swapped.nextLines.join("\n");
  return {
    edit: uniqueEdit(lines, source, replacement),
    summary: summarize(swapped.written, tableNumber),
    changed: nextMarkdown !== markdown,
    markdown: nextMarkdown,
  };
}
