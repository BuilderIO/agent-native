import {
  Fragment,
  type Node as ProseMirrorNode,
  type Schema,
  Slice,
} from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";

// Sheets, Excel and Numbers copy cells as tab-separated text: rows end in a
// line break, and a cell holding a tab, line break or quote is wrapped in
// double quotes with its own quotes doubled. This reads that text into a table
// and writes a copied table back out the same way.

/**
 * The rows of tab-separated text, or null unless it is a grid of at least two
 * rows and two columns with the same number of cells in every row. Prose with
 * a stray tab and tab-indented lines stay text.
 */
export function parseSpreadsheetText(text: string): string[][] | null {
  if (!text.includes("\t")) return null;

  const rows: string[][] = [];
  let row: string[] = [];
  let index = 0;
  while (index <= text.length) {
    const cell = readCell(text, index);
    row.push(cell.value);
    index = cell.end;
    const delimiter = text[index];
    if (delimiter === "\t") {
      index += 1;
      continue;
    }
    rows.push(row);
    row = [];
    if (delimiter === undefined) break;
    index += delimiter === "\r" && text[index + 1] === "\n" ? 2 : 1;
    // A line break at the very end closes the last row; it isn't a new one.
    if (index === text.length) break;
  }

  const width = rows[0]?.length ?? 0;
  if (rows.length < 2 || width < 2) return null;
  if (rows.some((cells) => cells.length !== width)) return null;
  if (rows.every((cells) => cells[0] === "")) return null;
  return rows;
}

function readCell(text: string, start: number) {
  if (text[start] === '"') {
    let value = "";
    let index = start + 1;
    while (index < text.length) {
      if (text[index] !== '"') {
        value += text[index];
        index += 1;
      } else if (text[index + 1] === '"') {
        value += '"';
        index += 2;
      } else {
        index += 1;
        if (isDelimiter(text[index])) return { value, end: index };
        break;
      }
    }
    // Not a quoted cell after all, such as `"Quoted" word`: read it as written.
  }
  let end = start;
  while (!isDelimiter(text[end])) end += 1;
  return { value: text.slice(start, end), end };
}

function isDelimiter(character: string | undefined) {
  return (
    character === undefined ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

/** A table of plain cells, one paragraph each, for the given rows. */
export function spreadsheetTableSlice(
  schema: Schema,
  rows: string[][],
): Slice | null {
  const { table, tableRow, tableCell, paragraph, hardBreak } = schema.nodes;
  if (!table || !tableRow || !tableCell || !paragraph) return null;

  const cellContent = (text: string) => {
    const inline: ProseMirrorNode[] = [];
    text.split(/\r\n?|\n/).forEach((line, index) => {
      if (index > 0)
        inline.push(hardBreak ? hardBreak.create() : schema.text(" "));
      if (line) inline.push(schema.text(line));
    });
    return paragraph.create(null, inline);
  };
  const node = table.create(
    null,
    rows.map((cells) =>
      tableRow.create(
        null,
        cells.map((text) => tableCell.create(null, cellContent(text))),
      ),
    ),
  );
  return new Slice(Fragment.from(node), 0, 0);
}

/** Whether a clipboard's HTML holds a table, as a spreadsheet's copy does. */
export function clipboardHtmlHasTable(clipboardData: DataTransfer) {
  return /<table[\s>]/i.test(clipboardData.getData("text/html"));
}

/**
 * Tab-separated text for a copied slice that is one table, or rows of one
 * table as a cell selection copies them; null for anything else. A merged
 * cell's text goes in its first position and the rest stay empty.
 */
export function spreadsheetTextForSlice(
  slice: Slice,
  schema: Schema,
): string | null {
  const { content } = slice;
  const only = content.childCount === 1 ? content.firstChild : null;
  let table: ProseMirrorNode | null = null;
  if (only?.type.spec.tableRole === "table") {
    table = only;
  } else if (
    content.childCount > 0 &&
    schema.nodes.table &&
    allChildren(content).every((node) => node.type.spec.tableRole === "row")
  ) {
    table = schema.nodes.table.create(null, content);
  }
  if (!table) return null;

  let map: TableMap;
  try {
    map = TableMap.get(table);
  } catch {
    return null;
  }
  const written = new Set<number>();
  const lines: string[] = [];
  for (let row = 0; row < map.height; row++) {
    const cells: string[] = [];
    for (let column = 0; column < map.width; column++) {
      const position = map.map[row * map.width + column];
      const cell =
        position === undefined || written.has(position)
          ? null
          : table.nodeAt(position);
      if (position !== undefined) written.add(position);
      cells.push(cell ? quoteCell(cellText(cell)) : "");
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

function allChildren(fragment: Fragment) {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => nodes.push(node));
  return nodes;
}

function cellText(cell: ProseMirrorNode) {
  return cell.textBetween(0, cell.content.size, "\n", (leaf) =>
    leaf.type.name === "hardBreak"
      ? "\n"
      : (leaf.type.spec.leafText?.(leaf) ?? ""),
  );
}

function quoteCell(text: string) {
  return /[\t\n\r]/.test(text) || text.startsWith('"')
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}
