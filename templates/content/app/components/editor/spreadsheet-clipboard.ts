import {
  Fragment,
  type Node as ProseMirrorNode,
  type NodeType,
  type Schema,
  Slice,
} from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";

// Sheets, Excel and Numbers copy cells as tab-separated text: rows end in a
// line break, and a cell holding a tab or line break is wrapped in double
// quotes with its own quotes doubled. This reads that text into a table and
// writes a copied table back out the same way, also quoting a cell that starts
// with a quote so it isn't read back as a quoted one.

/**
 * The rows of tab-separated text, or null unless it is a grid of at least two
 * rows and two columns with the same number of cells in every row. Prose with
 * a stray tab and indented lines stay text.
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
    const delimiter = text.charAt(index);
    if (delimiter === "\t") {
      index += 1;
      continue;
    }
    rows.push(row);
    row = [];
    if (delimiter === "") break;
    index += text.startsWith("\r\n", index) ? 2 : 1;
    // A line break at the very end closes the last row; it isn't a new one.
    if (index === text.length) break;
  }

  const width = rows[0]?.length ?? 0;
  if (rows.length < 2 || width < 2) return null;
  if (rows.some((cells) => cells.length !== width)) return null;
  if (rows.every(startsBlank)) return null;
  return rows;
}

/** Whether a row's first cell is empty or only spaces, as indentation is. */
function startsBlank(cells: string[]) {
  for (const cell of cells) return cell.trim() === "";
  return true;
}

function readCell(text: string, start: number) {
  if (text.charAt(start) === '"') {
    let value = "";
    let index = start + 1;
    while (index < text.length) {
      const character = text.charAt(index);
      if (character !== '"') {
        value += character;
        index += 1;
      } else if (text.charAt(index + 1) === '"') {
        value += '"';
        index += 2;
      } else {
        index += 1;
        if (isDelimiter(text.charAt(index))) return { value, end: index };
        break;
      }
    }
    // Not a quoted cell after all, such as `"Quoted" word`: read it as written.
  }
  let end = start;
  while (!isDelimiter(text.charAt(end))) end += 1;
  return { value: text.slice(start, end), end };
}

/** A tab, a line break, or the end of the text, where charAt gives "". */
function isDelimiter(character: string) {
  return (
    character === "" ||
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
  const { table, tableRow, tableCell, paragraph, hardBreak } =
    nodeTypes(schema);
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

/**
 * Excel writes one `<col span="3">` for three columns of the same width, and
 * a pasted cell takes its width from the `<col>` at its own column's index, so
 * every column after the first lost its width. One `<col>` per column keeps
 * them all.
 */
export function expandColumnSpans(html: string): string {
  if (!/<col\b[^>]*\bspan\s*=/i.test(html)) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const col of Array.from(
    template.content.querySelectorAll("col[span]"),
  )) {
    // Browsers cap a column span at 1000. A span that isn't a number adds no
    // columns.
    const span = Math.min(Number(col.getAttribute("span")), 1000);
    col.removeAttribute("span");
    for (let copy = 1; copy < span; copy++) col.after(col.cloneNode());
  }
  return template.innerHTML;
}

/**
 * Whether a paste's files are only a picture of the table in its HTML, as
 * Excel puts beside the cells it copies. HTML with media of its own, such as
 * a table and an image copied from Word, keeps its files.
 */
export function isSpreadsheetPicture(clipboardData: DataTransfer) {
  const files = Array.from(clipboardData.files);
  if (files.length === 0) return false;
  if (!files.every((file) => file.type.startsWith("image/"))) return false;
  // A template's content is inert: nothing in it loads or runs.
  const template = document.createElement("template");
  template.innerHTML = clipboardData.getData("text/html");
  const html = template.content;
  return (
    html.querySelector("table") !== null &&
    html.querySelector(
      "img, picture, video, audio, svg, object, embed, iframe",
    ) === null
  );
}

/**
 * Tab-separated text for a copied slice that is one table, or rows of one
 * table as a cell selection copies them; null for anything else, such as text
 * selected inside a cell. A merged cell's text goes in its first position and
 * the rest stay empty.
 */
export function spreadsheetTextForSlice(
  slice: Slice,
  schema: Schema,
): string | null {
  // A cell selection's slice is open one level, into its table. Text selected
  // inside a cell comes with the table, row and cell around it, open deeper.
  if (slice.openStart > 1 || slice.openEnd > 1) return null;
  const table = copiedTable(slice.content, schema);
  if (!table) return null;

  // The map lists each grid position's cell in reading order, so a merged
  // cell's first position is its top-left one.
  const map = TableMap.get(table);
  const written = new Set<number>();
  const cells = map.map.map((position) => {
    if (written.has(position)) return "";
    written.add(position);
    const cell = table.nodeAt(position);
    return cell ? quoteCell(cellText(cell)) : "";
  });
  const lines: string[] = [];
  for (let row = 0; row < map.height; row++) {
    lines.push(cells.slice(row * map.width, (row + 1) * map.width).join("\t"));
  }
  return lines.join("\n");
}

function copiedTable(content: Fragment, schema: Schema) {
  const only = content.childCount === 1 ? content.firstChild : null;
  if (only?.type.spec.tableRole === "table") return only;
  const rows = allChildren(content);
  if (rows.length === 0) return null;
  if (!rows.every((node) => node.type.spec.tableRole === "row")) return null;
  return nodeTypes(schema).table?.create(null, content) ?? null;
}

/** The schema's node types, any of which a schema may leave out. */
function nodeTypes(schema: Schema) {
  return schema.nodes as Partial<Record<string, NodeType>>;
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
