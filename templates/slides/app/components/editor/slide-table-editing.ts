import { stripCopiedIdentity } from "./bullet-editing";

/** Why a row or column operation cannot run on a table. */
export type TableEditBlocker = "merged-cells" | "column-layout";

export interface TableEditAvailability {
  rows: TableEditBlocker | null;
  columns: TableEditBlocker | null;
}

interface ColumnTrack {
  col: HTMLTableColElement;
  width: number | null;
  unit: "%" | "px" | null;
  fromAttribute: boolean;
}

function hasMergedCells(table: HTMLTableElement): boolean {
  return Array.from(table.rows).some((row) =>
    Array.from(row.cells).some((c) => c.colSpan > 1 || c.rowSpan > 1),
  );
}

function columnCount(table: HTMLTableElement): number {
  return table.rows.item(0)?.cells.length ?? 0;
}

function readTrack(col: HTMLTableColElement): ColumnTrack | null {
  const styled = col.style.getPropertyValue("width").trim();
  const raw = styled || col.getAttribute("width")?.trim() || "";
  if (!raw) return { col, width: null, unit: null, fromAttribute: false };
  const match = /^(\d*\.?\d+)(%|px)?$/.exec(raw);
  const digits = match?.at(1);
  if (!match || digits === undefined) return null;
  return {
    col,
    width: Number.parseFloat(digits),
    unit: match[2] === "%" ? "%" : "px",
    fromAttribute: !styled,
  };
}

/**
 * The table's `<col>` tracks, one per column; `[]` when it has no colgroup;
 * null when the tracks cannot be matched to columns (a `span`, a count that
 * differs from the cells, widths in mixed or unknown units).
 */
function columnTracks(table: HTMLTableElement): ColumnTrack[] | null {
  const groups = Array.from(table.children).filter(
    (child): child is HTMLTableColElement => child.tagName === "COLGROUP",
  );
  if (groups.length === 0) return [];
  const cols: HTMLTableColElement[] = [];
  for (const group of groups) {
    const members = Array.from(group.children).filter(
      (child): child is HTMLTableColElement => child.tagName === "COL",
    );
    if (members.length === 0) return null;
    cols.push(...members);
  }
  if (cols.length !== columnCount(table)) return null;
  if (cols.some((col) => col.span > 1)) return null;
  const tracks: ColumnTrack[] = [];
  for (const col of cols) {
    const track = readTrack(col);
    if (!track) return null;
    tracks.push(track);
  }
  const units = new Set(tracks.map((track) => track.unit));
  if (units.size > 1) return null;
  return tracks;
}

function writeTrackWidth(track: ColumnTrack, width: number) {
  if (track.unit === null) return;
  const rounded =
    track.unit === "%"
      ? Math.round(width * 10_000) / 10_000
      : Math.round(width * 100) / 100;
  const value = `${rounded}${track.unit}`;
  if (track.fromAttribute) track.col.setAttribute("width", value);
  else track.col.style.setProperty("width", value);
}

/** Rescales every track so the widths add up to `total` again. */
function renormalizeTracks(tracks: readonly ColumnTrack[], total: number) {
  const sum = tracks.reduce((acc, track) => acc + (track.width ?? 0), 0);
  if (sum <= 0 || total <= 0) return;
  for (const track of tracks) {
    if (track.width === null) continue;
    writeTrackWidth(track, (track.width * total) / sum);
  }
}

export function tableEditAvailability(
  table: HTMLTableElement,
): TableEditAvailability {
  if (hasMergedCells(table)) {
    return { rows: "merged-cells", columns: "merged-cells" };
  }
  return {
    rows: null,
    columns: columnTracks(table) === null ? "column-layout" : null,
  };
}

/**
 * The element chain a cell's first text run sits in (a paragraph, a styled
 * span), copied empty, so new text in another cell looks like this one's.
 */
function emptyTextChain(source: HTMLElement): {
  outer: Node | null;
  inner: HTMLElement | null;
} {
  const walker = source.ownerDocument.createTreeWalker(
    source,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  let anchor: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      (node instanceof Text && node.data.trim()) ||
      (node instanceof HTMLElement && node.tagName === "BR")
    ) {
      anchor = node;
      break;
    }
  }
  let outer: HTMLElement | null = null;
  let inner: HTMLElement | null = null;
  for (
    let parent = anchor?.parentElement ?? null;
    parent && parent !== source && source.contains(parent);
    parent = parent.parentElement
  ) {
    const copy = parent.cloneNode(false) as HTMLElement;
    stripCopiedIdentity(copy);
    if (outer) copy.append(outer);
    else inner = copy;
    outer = copy;
  }
  return { outer, inner };
}

/** Replaces a cell's content with `text` in the style of `source`'s first run. */
export function setTableCellText(
  cell: HTMLTableCellElement,
  text: string,
  source: HTMLElement = cell,
) {
  const { outer, inner } = emptyTextChain(source);
  const content = text
    ? cell.ownerDocument.createTextNode(text)
    : cell.ownerDocument.createElement("br");
  if (inner) inner.append(content);
  cell.replaceChildren(outer ?? content);
}

function emptyRowLike(row: HTMLTableRowElement): HTMLTableRowElement {
  const copy = row.cloneNode(false) as HTMLTableRowElement;
  stripCopiedIdentity(copy);
  for (const cell of Array.from(row.cells)) {
    const blank = cell.cloneNode(false) as HTMLTableCellElement;
    stripCopiedIdentity(blank);
    setTableCellText(blank, "", cell);
    copy.append(blank);
  }
  return copy;
}

export function insertTableRow(
  cell: HTMLTableCellElement,
  position: "above" | "below",
): boolean {
  const row = cell.closest("tr");
  const table = row?.closest("table");
  if (!row || !table || tableEditAvailability(table).rows) return false;
  row.insertAdjacentElement(
    position === "above" ? "beforebegin" : "afterend",
    emptyRowLike(row),
  );
  return true;
}

export function deleteTableRow(cell: HTMLTableCellElement): boolean {
  const row = cell.closest("tr");
  const table = row?.closest("table");
  if (
    !row ||
    !table ||
    table.rows.length <= 1 ||
    tableEditAvailability(table).rows
  ) {
    return false;
  }
  row.remove();
  return true;
}

export function insertTableColumn(
  cell: HTMLTableCellElement,
  position: "left" | "right",
): boolean {
  const table = cell.closest("table");
  if (!table || tableEditAvailability(table).columns) return false;
  const tracks = columnTracks(table);
  if (tracks === null) return false;
  const columnIndex = cell.cellIndex;
  const where = position === "left" ? "beforebegin" : "afterend";
  for (const row of Array.from(table.rows)) {
    const refCell = row.cells.item(columnIndex);
    if (!refCell) continue;
    const newCell = refCell.cloneNode(false) as HTMLTableCellElement;
    stripCopiedIdentity(newCell);
    setTableCellText(newCell, "", refCell);
    refCell.insertAdjacentElement(where, newCell);
  }
  const ref = columnIndex < 0 ? undefined : tracks.at(columnIndex);
  if (ref) {
    const total = tracks.reduce((acc, track) => acc + (track.width ?? 0), 0);
    const col = ref.col.cloneNode(false) as HTMLTableColElement;
    stripCopiedIdentity(col);
    ref.col.insertAdjacentElement(where, col);
    const added: ColumnTrack = { ...ref, col };
    renormalizeTracks(
      position === "left"
        ? [...tracks.slice(0, columnIndex), added, ...tracks.slice(columnIndex)]
        : [
            ...tracks.slice(0, columnIndex + 1),
            added,
            ...tracks.slice(columnIndex + 1),
          ],
      total,
    );
  }
  return true;
}

export function deleteTableColumn(cell: HTMLTableCellElement): boolean {
  const table = cell.closest("table");
  if (
    !table ||
    columnCount(table) <= 1 ||
    tableEditAvailability(table).columns
  ) {
    return false;
  }
  const tracks = columnTracks(table);
  if (tracks === null) return false;
  const columnIndex = cell.cellIndex;
  for (const row of Array.from(table.rows)) row.cells[columnIndex]?.remove();
  const removed = columnIndex < 0 ? undefined : tracks.at(columnIndex);
  if (removed) {
    const total = tracks.reduce((acc, track) => acc + (track.width ?? 0), 0);
    removed.col.remove();
    renormalizeTracks(
      tracks.filter((track) => track !== removed),
      total,
    );
  }
  return true;
}

function cellText(cell: Element): string {
  return cell.textContent.replace(/\s+/g, " ").trim();
}

/**
 * Spreadsheet cells on the clipboard as rows of values: an HTML `<table>`,
 * else tab-separated lines. Null when the clipboard holds a single value or
 * text without tabs, which pastes as ordinary text.
 */
export function parseClipboardGrid(
  html: string,
  text: string,
): string[][] | null {
  let grid: string[][] = [];
  if (html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const table = template.content.querySelector("table");
    if (table) {
      grid = Array.from(table.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("td, th")).flatMap((cell) => [
          cellText(cell),
          ...Array.from<string>({
            length: Math.max(0, (cell as HTMLTableCellElement).colSpan - 1),
          }).fill(""),
        ]),
      );
    }
  }
  if (grid.length === 0 && text.includes("\t")) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    grid = lines.map((line) => line.split("\t"));
  }
  grid = grid.filter((row) => row.length > 0);
  const cells = grid.reduce((acc, row) => acc + row.length, 0);
  return cells > 1 ? grid : null;
}

/**
 * Fills cells across and down from `cell`, adding rows below the table's last
 * row as needed. Columns past the table's width are dropped, never added.
 */
export function pasteGridIntoTable(
  cell: HTMLTableCellElement,
  grid: readonly (readonly string[])[],
): boolean {
  const row = cell.closest("tr");
  const table = row?.closest("table");
  if (!row || !table || tableEditAvailability(table).rows) return false;
  const startRow = Array.from(table.rows).indexOf(row);
  const startColumn = cell.cellIndex;
  if (startRow < 0 || startColumn < 0) return false;
  grid.forEach((values, offset) => {
    let target = table.rows.item(startRow + offset);
    if (!target) {
      const last = table.rows.item(table.rows.length - 1);
      if (!last) return;
      target = emptyRowLike(last);
      last.insertAdjacentElement("afterend", target);
    }
    values.forEach((value, column) => {
      const into = target.cells.item(startColumn + column);
      if (into) setTableCellText(into, value);
    });
  });
  return true;
}
