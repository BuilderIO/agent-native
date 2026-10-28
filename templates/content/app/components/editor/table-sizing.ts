/**
 * Column widths for a table nobody has resized.
 *
 * The browser's automatic table layout takes every column the same fraction
 * of the way from its narrowest to its widest, so a column of short links
 * wraps as hard as a column of sentences. Instead, each column is measured
 * once, and then:
 *
 * - no column gets narrower than its longest word, nor than about twelve
 *   characters unless its values are shorter (a header wraps instead);
 * - when those floors don't fit, the table keeps them and scrolls sideways,
 *   or, in a column as narrow as a phone's, a table that holds sentences
 *   shows each row as a card;
 * - otherwise the columns start from fair shares (a column that needs less
 *   than an equal share of what's left gets all it needs) and trade width
 *   while that makes the table shorter, judged by wrapping each cell's
 *   measured words.
 *
 * Only a piece of text longer than 30 characters, such as a URL or a hash,
 * breaks mid-word. The widths are never saved, so they follow the page width
 * and the text.
 */

/** About twelve characters of body text, with the cell's padding. */
export const TEXT_COLUMN_FLOOR = 128;

/** A piece of text longer than this (a URL, a hash) may break anywhere. */
export const LONG_PIECE_LENGTH = 30;

/** Rows become cards only in a column this narrow: a phone's. */
export const CARD_LAYOUT_MAX_WIDTH = 420;

/**
 * How a content-sized table is laid out, on its `data-column-sizing`:
 * "content" until it has been measured, "measuring" while it is, then
 * "measured" or "cards".
 */
export const COLUMN_SIZING_ATTRIBUTE = "data-column-sizing";

/** On a table's wrapper while the table is wider than the page. */
export const TABLE_SCROLLS_ATTRIBUTE = "data-table-scrolls";

// The table's CSS keeps it at least as wide as the page, so this floor only
// matters once unsized columns stop fitting: the table then scrolls inside
// `.tableWrapper` instead of squeezing each column to a letter per line. It
// holds for a table with some columns resized, and for a content-sized one
// until it has been measured. Tiptap's `cellMinWidth` stays small because it
// is also the drag minimum.
export const READABLE_TABLE_COLUMN_MIN_WIDTH = 96;

// Column drags rewrite the table's inline `min-width` on every frame, so the
// floor lives in a custom property that the stylesheet enforces instead.
export const READABLE_TABLE_MIN_WIDTH_PROPERTY = "--content-table-min-width";
const MIN_WIDTH_PROPERTY = READABLE_TABLE_MIN_WIDTH_PROPERTY;

// Trading widths reads every cell's line count for each width it tries. Past
// this many reads it keeps the shortest widths found so far, so a wide table
// never holds up the page.
const BALANCE_BUDGET = 400_000;

interface Piece {
  width: number;
  /** The width of the spaces after it. */
  space: number;
  /** A line break in the text, rather than text. */
  newline?: boolean;
}

interface TextBlock {
  indent: number;
  pieces: Piece[];
}

export interface MeasuredCell {
  /** Padding and borders. */
  inset: number;
  blocks: TextBlock[];
}

/** A cell across several columns, which wraps in their combined width. */
export interface SpanningCell {
  row: number;
  /** The first column it covers. */
  column: number;
  span: number;
  cell: MeasuredCell;
}

export interface TableMeasure {
  /** Each column's width with nothing wrapped. */
  natural: number[];
  floor: number[];
  /** Each row's cells by column; null where no cell starts alone there. */
  rows: Array<Array<MeasuredCell | null>>;
  spans: SpanningCell[];
  /** Whether a body cell holds a sentence or more. */
  prose: boolean;
}

export interface ColumnPlan {
  widths: number[];
  layout: "columns" | "scroll" | "cards";
}

const sum = (values: number[]) => values.reduce((total, x) => total + x, 0);

/** `values[index]`, which may be past the end. (Content's lib predates `.at()`.) */
function at<T>(values: readonly T[], index: number): T | undefined {
  return values[index];
}

const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
// A word breaks after a hyphen or a dash.
const WORD_PARTS = /[^-‐-—]*[-‐-—]+|[^-‐-—]+/g;
const TEXT_BLOCKS = "p, h1, h2, h3, h4, h5, h6";

function blockPieces(block: HTMLElement, range: Range): Piece[] {
  const pieces: Piece[] = [];
  // Whether the last piece ends mid-word, so text that follows it in another
  // node (a link, a bold run) continues the same word.
  let open = false;
  const widthOf = (node: Text, from: number, to: number) => {
    range.setStart(node, from);
    range.setEnd(node, to);
    return range.getBoundingClientRect().width;
  };
  const text = (node: Text) => {
    const tokens = /\s+|\S+/g;
    let match: RegExpExecArray | null;
    while ((match = tokens.exec(node.data))) {
      const [token] = match;
      const start = match.index;
      if (/^\s/.test(token)) {
        const last = at(pieces, pieces.length - 1);
        if (last) last.space += widthOf(node, start, start + token.length);
        open = false;
        continue;
      }
      if (token.length > LONG_PIECE_LENGTH || CJK.test(token)) {
        // Breaks anywhere: a piece per character, each an equal share.
        const each = widthOf(node, start, start + token.length) / token.length;
        for (let index = 0; index < token.length; index += 1) {
          pieces.push({ width: each, space: 0 });
        }
        open = false;
        continue;
      }
      let offset = start;
      for (const part of token.match(WORD_PARTS) ?? []) {
        const width = widthOf(node, offset, offset + part.length);
        offset += part.length;
        const last = at(pieces, pieces.length - 1);
        if (open && last) last.width += width;
        else pieces.push({ width, space: 0 });
        open = !/[-‐-—]$/.test(part);
      }
    }
  };
  const visit = (parent: Node) => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3) {
        text(child as Text);
      } else if (child.nodeType === 1) {
        const element = child as HTMLElement;
        if (element.nodeName === "BR") {
          if (!element.classList.contains("ProseMirror-trailingBreak")) {
            pieces.push({ width: 0, space: 0, newline: true });
            open = false;
          }
        } else if (!element.textContent) {
          // An image or another leaf with no text.
          const width = element.getBoundingClientRect().width;
          if (width > 0) pieces.push({ width, space: 0 });
          open = false;
        } else {
          visit(element);
        }
      }
    }
  };
  visit(block);
  return pieces;
}

function measureCell(cell: HTMLTableCellElement, range: Range): MeasuredCell {
  const style = getComputedStyle(cell);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const inset =
    px(style.paddingLeft) +
    px(style.paddingRight) +
    px(style.borderLeftWidth) +
    px(style.borderRightWidth);
  const contentLeft =
    cell.getBoundingClientRect().left +
    px(style.borderLeftWidth) +
    px(style.paddingLeft);
  const blocks = Array.from(
    cell.querySelectorAll<HTMLElement>(TEXT_BLOCKS),
  ).map((block) => ({
    indent: Math.max(0, block.getBoundingClientRect().left - contentLeft),
    pieces: blockPieces(block, range),
  }));
  return { inset, blocks };
}

// The editor keeps spaces as typed (`white-space: break-spaces`), so a space
// takes room on its line like a letter instead of hanging past the end; one
// that doesn't fit starts the next line. A word therefore needs room for the
// spaces after it.
const footprint = (piece: Piece) => piece.width + piece.space;

const widestPiece = (cell: MeasuredCell) =>
  Math.max(
    0,
    ...cell.blocks.map(
      (block) => block.indent + Math.max(0, ...block.pieces.map(footprint)),
    ),
  );

const unwrappedWidth = (cell: MeasuredCell) =>
  Math.max(
    0,
    ...cell.blocks.map(
      (block) => block.indent + sum(block.pieces.map(footprint)),
    ),
  );

interface PlacedCell {
  cell: HTMLTableCellElement;
  /** The first column it covers. */
  column: number;
  /** How many columns it covers, within the table's `columns`. */
  span: number;
}

/**
 * Each row's cells with the columns they cover, past the columns that cells
 * from rows above still span into.
 */
function tableGrid(table: HTMLTableElement, columns: number): PlacedCell[][] {
  let covered: number[] = new Array(columns).fill(0);
  return Array.from(table.rows, (row) => {
    const placed: PlacedCell[] = [];
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      while ((at(covered, column) ?? 0) > 0) column += 1;
      if (column >= columns) break;
      const span = Math.min(cell.colSpan, columns - column);
      placed.push({ cell, column, span });
      covered.fill(Math.max(1, cell.rowSpan), column, column + span);
      column += span;
    }
    covered = covered.map((rows) => Math.max(0, rows - 1));
    return placed;
  });
}

const isHeaderRow = (row: HTMLTableRowElement | null) =>
  row !== null && Array.from(row.cells).every((cell) => cell.nodeName === "TH");

/**
 * Measures `table`, which must be laid out at its natural width (see
 * "measuring" in global.css). Null when it isn't laid out at all, e.g. while
 * its page is hidden.
 */
export function measureTable(
  table: HTMLTableElement,
  columns: number,
): TableMeasure | null {
  if (!table.isConnected || columns === 0) return null;
  const natural: number[] = new Array(columns).fill(0);
  const narrowest: number[] = new Array(columns).fill(0);
  const body: number[] = new Array(columns).fill(0);
  // Spanning cells, with their widths with nothing wrapped.
  const spanning: Array<[SpanningCell, number]> = [];
  const range = table.ownerDocument.createRange();
  const headerRow = isHeaderRow(table.rows.item(0));
  let prose = false;
  const rows = tableGrid(table, columns).map((placed, rowIndex) => {
    const cells: Array<MeasuredCell | null> = new Array(columns).fill(null);
    const inBody = !(headerRow && rowIndex === 0);
    for (const { cell, column, span } of placed) {
      const measured = measureCell(cell, range);
      const unwrapped = unwrappedWidth(measured);
      if (inBody && unwrapped > 2 * TEXT_COLUMN_FLOOR) prose = true;
      const width = cell.getBoundingClientRect().width;
      if (span > 1) {
        spanning.push([{ row: rowIndex, column, span, cell: measured }, width]);
        continue;
      }
      cells[column] = measured;
      natural[column] = Math.max(at(natural, column) ?? 0, width);
      narrowest[column] = Math.max(
        at(narrowest, column) ?? 0,
        measured.inset + widestPiece(measured),
      );
      if (inBody) {
        body[column] = Math.max(
          at(body, column) ?? 0,
          measured.inset + unwrapped,
        );
      }
    }
    return cells;
  });
  const floor = columnFloors(narrowest, body);
  // A spanning cell needs the same of its columns together. The browser has
  // made room for it unwrapped, so this only widens a column no cell has to
  // itself.
  for (const [{ row, column, span, cell }, width] of spanning) {
    widen(natural, column, span, width);
    const text = headerRow && row === 0 ? 0 : cell.inset + unwrappedWidth(cell);
    widen(floor, column, span, floorOf(cell.inset + widestPiece(cell), text));
  }
  if (natural.every((width) => width === 0)) return null;
  // A pixel to spare, so text that exactly fits never wraps on rounding.
  const fitted = natural.map((width, column) =>
    Math.max(Math.ceil(width) + 1, at(floor, column) ?? 0),
  );
  const spans = spanning.map(([placed]) => placed);
  return { natural: fitted, floor, rows, spans, prose };
}

/**
 * Widens the `span` columns from `column` evenly until together they are
 * `need` wide.
 */
function widen(widths: number[], column: number, span: number, need: number) {
  const short = need - sum(widths.slice(column, column + span));
  if (short <= 0) return;
  for (let index = column; index < column + span; index += 1) {
    widths[index] = (at(widths, index) ?? 0) + short / span;
  }
}

/**
 * How narrow each column may get: as wide as its longest piece that can't
 * break, and about twelve characters unless its body text is shorter. A
 * header counts only for its longest word, so long headers over short values
 * wrap instead of making the table scroll.
 */
export function columnFloors(narrowest: number[], body: number[]) {
  return narrowest.map((piece, column) =>
    floorOf(piece, at(body, column) ?? 0),
  );
}

function floorOf(piece: number, text: number) {
  return Math.max(
    Math.ceil(piece) + 1,
    Math.min(Math.ceil(text) + 1, TEXT_COLUMN_FLOOR),
  );
}

/**
 * Lines a block takes in `room` px, filled the way the browser fills them:
 * each word with the spaces after it, on the line it fits on.
 */
function blockLines(block: TextBlock, room: number) {
  const space = room - block.indent;
  let lines = 1;
  let used = 0;
  for (const piece of block.pieces) {
    if (piece.newline) {
      lines += 1;
      used = 0;
      continue;
    }
    const need = footprint(piece);
    if (used > 0 && used + need > space + 0.01) {
      lines += 1;
      used = need;
    } else {
      used += need;
    }
  }
  return lines;
}

/** Lines a cell takes in a column `width` px wide. */
export function cellLines(cell: MeasuredCell, width: number) {
  const room = width - cell.inset;
  return Math.max(
    1,
    cell.blocks.reduce((lines, block) => lines + blockLines(block, room), 0),
  );
}

/**
 * Columns that need less than an equal share of what's left get all they
 * need; the rest split what remains, never below their floors.
 */
export function fairShares(
  natural: number[],
  floor: number[],
  available: number,
): number[] {
  const needed = sum(natural);
  if (needed <= available) {
    // Everything fits: the spare width goes to each column by its size.
    return natural.map(
      (width) => width + ((available - needed) * width) / needed,
    );
  }
  let low = 0;
  let high = Math.max(...natural);
  // Every column capped at `level`, above its floor.
  const levelled = (level: number) =>
    natural.map((width, column) =>
      Math.max(at(floor, column) ?? 0, Math.min(level, width)),
    );
  for (let step = 0; step < 40; step += 1) {
    const level = (low + high) / 2;
    if (sum(levelled(level)) > available) high = level;
    else low = level;
  }
  return levelled(low);
}

/**
 * Moves width from one column to another while that makes the table
 * shorter, in shrinking steps. A table's height is its rows' tallest cells,
 * in lines; a little weight on every cell's lines breaks ties toward fewer
 * wrapped lines.
 */
function shortestWidths(measure: TableMeasure, start: number[]) {
  const { natural, floor, rows, spans } = measure;
  const widths = start.slice();
  // Counting a cell's lines takes a step per word, so the budget does too.
  const cost = (cell: MeasuredCell | null | undefined) =>
    1 + (cell ? sum(cell.blocks.map((block) => block.pieces.length)) : 0);
  const columnCost = start.map((_, column) =>
    sum(rows.map((row) => cost(at(row, column)))),
  );
  const spanCost = sum(spans.map(({ cell }) => cost(cell)));
  let budget = BALANCE_BUDGET;
  const cache = new Map<string, number[]>();
  const linesAt = (column: number, width: number) => {
    const key = `${column} ${Math.round(width * 2)}`;
    let lines = cache.get(key);
    if (!lines) {
      budget -= at(columnCost, column) ?? 0;
      lines = rows.map((row) => {
        const cell = at(row, column);
        return cell ? cellLines(cell, width) : 0;
      });
      cache.set(key, lines);
    }
    return lines;
  };
  const height = () => {
    budget -= rows.length * widths.length + spanCost;
    const tallest = rows.map(() => 1);
    let total = 0;
    const add = (row: number, lines: number) => {
      total += lines;
      if (lines > (at(tallest, row) ?? 1)) tallest[row] = lines;
    };
    widths.forEach((width, column) => {
      linesAt(column, width).forEach((lines, row) => add(row, lines));
    });
    for (const { row, column, span, cell } of spans) {
      add(row, cellLines(cell, sum(widths.slice(column, column + span))));
    }
    return sum(tallest) + 0.02 * total;
  };
  let best = height();
  type Move = { to: number; toWidth: number; from: number; fromWidth: number };
  // The move of `step` px that makes the table shortest, of those the budget
  // leaves room to try.
  const bestMove = (step: number) => {
    let move: Move | null = null;
    let moveHeight = best;
    const current = widths.slice();
    for (const [to, toWidth] of current.entries()) {
      const room = (at(natural, to) ?? 0) - toWidth;
      if (room < 0.5) continue;
      for (const [from, fromWidth] of current.entries()) {
        const amount = Math.min(step, room, fromWidth - (at(floor, from) ?? 0));
        if (from === to || amount < 0.5) continue;
        if (budget <= 0) return { move, moveHeight };
        widths[to] = toWidth + amount;
        widths[from] = fromWidth - amount;
        const tried = height();
        widths[to] = toWidth;
        widths[from] = fromWidth;
        if (tried < moveHeight - 1e-9) {
          moveHeight = tried;
          move = {
            to,
            toWidth: toWidth + amount,
            from,
            fromWidth: fromWidth - amount,
          };
        }
      }
    }
    return { move, moveHeight };
  };
  for (const step of [96, 48, 24, 12, 6, 3]) {
    while (budget > 0) {
      // A move found before the budget ran out still counts.
      const { move, moveHeight } = bestMove(step);
      if (!move) break;
      widths[move.to] = move.toWidth;
      widths[move.from] = move.fromWidth;
      best = moveHeight;
    }
  }
  return widths;
}

/** The widths for `measure` in `available` px between the table's borders. */
export function planColumns(
  measure: TableMeasure,
  available: number,
  { fitPageWidth = false }: { fitPageWidth?: boolean } = {},
): ColumnPlan {
  const { natural, floor } = measure;
  const floors = sum(floor);
  if (floors > available + 0.5) {
    if (fitPageWidth) {
      // Fit to page width never scrolls: every column gives up its share.
      return {
        widths: floor.map((width) => (width * available) / floors),
        layout: "columns",
      };
    }
    const cards = available <= CARD_LAYOUT_MAX_WIDTH && measure.prose;
    // Scrolling anyway, a column needn't wrap its header to make room.
    const widths = floor.map((width, column) =>
      Math.max(width, Math.min(at(natural, column) ?? 0, TEXT_COLUMN_FLOOR)),
    );
    return { widths, layout: cards ? "cards" : "scroll" };
  }
  const shares = fairShares(natural, floor, available);
  return { widths: shortestWidths(measure, shares), layout: "columns" };
}

/**
 * Labels each body cell with its column's header, for cards, and marks empty
 * cells, as TablePresentation's decorations do in the editor. For tables
 * drawn without an editor.
 */
export function labelTableCells(table: HTMLTableElement) {
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      if (!cell.textContent.trim() && !cell.querySelector("img, video")) {
        cell.setAttribute("data-empty", "");
      }
    }
  }
  const header = table.rows.item(0);
  if (!header || !isHeaderRow(header)) return;
  const labels: string[] = [];
  for (const cell of Array.from(header.cells)) {
    labels.push(cellLabel(cell.textContent));
    for (let span = 1; span < cell.colSpan; span += 1) labels.push("");
  }
  for (const placed of tableGrid(table, labels.length).slice(1)) {
    for (const { cell, column } of placed) {
      const label = at(labels, column);
      if (label) cell.setAttribute("data-label", label);
    }
  }
}

/** A header's text as a card label: one line, not too long. */
export function cellLabel(text: string) {
  const label = text.replace(/\s+/g, " ").trim();
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}

/**
 * Sizes one content-sized table: measures it when its text changes, plans
 * its columns again when its page changes width, and holds its widths while
 * someone types in it.
 */
export class ContentTableSizer {
  private measure: TableMeasure | null = null;
  private plan: ColumnPlan | null = null;
  /** Whether `plan` fits the table to the page width. */
  private plannedToFit = false;
  private active = false;
  private holding = false;
  private scheduled = false;
  private destroyed = false;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly fonts: FontFaceSet | null;
  private readonly remeasure = () => {
    if (this.active && !this.holding) this.schedule();
  };

  constructor(
    private readonly wrapper: HTMLElement,
    private readonly table: HTMLTableElement,
    private readonly colgroup: HTMLElement,
    private readonly fitPageWidth: () => boolean = () => false,
  ) {
    // Only the page's width matters; the table's own height changes too.
    let width = -1;
    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (wrapper.clientWidth === width) return;
            width = wrapper.clientWidth;
            this.resized();
          });
    this.resizeObserver?.observe(wrapper);
    // Text measured in a fallback font is measured again in the real one.
    // Not every DOM has a font set, e.g. happy-dom.
    const document = table.ownerDocument;
    this.fonts = "fonts" in document ? document.fonts : null;
    this.fonts?.addEventListener("loadingdone", this.remeasure);
  }

  /**
   * The table's content may have changed. While held, the widths stay as
   * they are unless the columns themselves changed.
   */
  update(hold: boolean) {
    this.active = true;
    this.holding = hold;
    const columns = this.cols().length;
    if (this.plan?.widths.length === columns) {
      // Fit to page width changes the plan, not the measure, so a held table
      // takes it at once.
      if (this.fitPageWidth() !== this.plannedToFit) this.replan();
      this.apply(this.plan);
      if (hold) return;
    } else {
      this.reset();
    }
    this.schedule();
  }

  /** The table has stored widths now, which its view lays out. */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.measure = null;
    this.plan = null;
    for (const col of this.cols()) col.style.removeProperty("width");
    this.table.removeAttribute(COLUMN_SIZING_ATTRIBUTE);
    this.table.style.removeProperty(MIN_WIDTH_PROPERTY);
    this.wrapper.removeAttribute(TABLE_SCROLLS_ATTRIBUTE);
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.fonts?.removeEventListener("loadingdone", this.remeasure);
  }

  private cols() {
    return Array.from(this.colgroup.children) as HTMLElement[];
  }

  private available() {
    const style = getComputedStyle(this.table);
    const borders =
      (Number.parseFloat(style.borderLeftWidth) || 0) +
      (Number.parseFloat(style.borderRightWidth) || 0);
    return this.wrapper.clientWidth - borders;
  }

  // ProseMirror draws a changed table's cells after its view updates, so the
  // table is measured once it has, before the next paint.
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.destroyed || !this.active) return;
      this.measure = this.measureNow();
      this.replan();
    });
  }

  private resized() {
    if (this.destroyed || !this.active) return;
    // A table first laid out now, e.g. on a page that was hidden, is measured.
    if (!this.measure && !this.holding) this.schedule();
    else this.replan();
  }

  private measureNow() {
    const cols = this.cols();
    const scrollLeft = this.wrapper.scrollLeft;
    for (const col of cols) col.style.removeProperty("width");
    this.table.setAttribute(COLUMN_SIZING_ATTRIBUTE, "measuring");
    const measure = measureTable(this.table, cols.length);
    if (this.plan) this.apply(this.plan);
    else this.reset();
    this.wrapper.scrollLeft = scrollLeft;
    return measure;
  }

  private replan() {
    if (!this.measure || this.measure.natural.length !== this.cols().length) {
      return;
    }
    const available = this.available();
    if (available <= 0) return;
    this.plannedToFit = this.fitPageWidth();
    this.plan = planColumns(this.measure, available, {
      fitPageWidth: this.plannedToFit,
    });
    this.apply(this.plan);
  }

  private apply(plan: ColumnPlan) {
    const cols = this.cols();
    this.table.setAttribute(
      COLUMN_SIZING_ATTRIBUTE,
      plan.layout === "cards" ? "cards" : "measured",
    );
    plan.widths.forEach((width, index) => {
      cols[index]?.style.setProperty("width", `${width.toFixed(2)}px`);
    });
    if (plan.layout === "scroll") {
      const style = getComputedStyle(this.table);
      const borders =
        (Number.parseFloat(style.borderLeftWidth) || 0) +
        (Number.parseFloat(style.borderRightWidth) || 0);
      this.table.style.setProperty(
        MIN_WIDTH_PROPERTY,
        `${Math.ceil(sum(plan.widths) + borders)}px`,
      );
      this.wrapper.setAttribute(TABLE_SCROLLS_ATTRIBUTE, "");
    } else {
      this.table.style.setProperty(MIN_WIDTH_PROPERTY, "0px");
      this.wrapper.removeAttribute(TABLE_SCROLLS_ATTRIBUTE);
    }
  }

  // Until it is measured, the browser sizes the table's columns.
  private reset() {
    this.plan = null;
    const cols = this.cols();
    for (const col of cols) col.style.removeProperty("width");
    this.table.setAttribute(COLUMN_SIZING_ATTRIBUTE, "content");
    if (this.fitPageWidth()) {
      this.table.style.removeProperty(MIN_WIDTH_PROPERTY);
    } else {
      this.table.style.setProperty(
        MIN_WIDTH_PROPERTY,
        `${cols.length * READABLE_TABLE_COLUMN_MIN_WIDTH}px`,
      );
    }
    this.wrapper.removeAttribute(TABLE_SCROLLS_ATTRIBUTE);
  }
}
