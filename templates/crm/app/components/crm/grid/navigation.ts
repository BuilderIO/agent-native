/**
 * The grid's keyboard model, kept out of React so it can be tested without a
 * DOM. `resolveGridKey` maps one keydown to one intent; the component only
 * decides what to do with the intent.
 */

export interface CellRef {
  row: number;
  col: number;
}

export interface GridSelection {
  /** Where the range started — fixed while Shift extends it. */
  anchor: CellRef;
  /** The active cell; arrows move it. */
  focus: CellRef;
}

export interface GridBounds {
  rows: number;
  cols: number;
}

export type GridDirection = "up" | "down" | "left" | "right";

export type GridKeyIntent =
  | { type: "move"; direction: GridDirection; extend: boolean }
  | { type: "jump"; edge: "top" | "bottom" | "start" | "end"; extend: boolean }
  | { type: "edit" }
  /** Typing over a cell: start editing seeded with this character. */
  | { type: "type"; text: string }
  | { type: "commit"; direction: GridDirection | null }
  | { type: "cancel" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "clear" }
  | { type: "selectAll" };

export interface GridKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

const ARROWS: Record<string, GridDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * One printable character starts an edit. `event.key.length === 1` is the
 * reliable test — checking key codes or ranges misses every non-Latin keyboard.
 */
function isPrintable(event: GridKeyEvent): boolean {
  return (
    event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
  );
}

export function resolveGridKey(
  event: GridKeyEvent,
  state: { editing: boolean },
): GridKeyIntent | null {
  const mod = event.metaKey || event.ctrlKey;

  if (state.editing) {
    if (event.key === "Escape") return { type: "cancel" };
    if (event.key === "Enter") {
      return { type: "commit", direction: event.shiftKey ? "up" : "down" };
    }
    if (event.key === "Tab") {
      return { type: "commit", direction: event.shiftKey ? "left" : "right" };
    }
    // Everything else belongs to the editor input, not the grid.
    return null;
  }

  if (mod && (event.key === "c" || event.key === "C")) return { type: "copy" };
  if (mod && (event.key === "v" || event.key === "V")) return { type: "paste" };
  if (mod && (event.key === "a" || event.key === "A")) {
    return { type: "selectAll" };
  }
  if (mod && ARROWS[event.key]) {
    const direction = ARROWS[event.key]!;
    const edge =
      direction === "up"
        ? "top"
        : direction === "down"
          ? "bottom"
          : direction === "left"
            ? "start"
            : "end";
    return { type: "jump", edge, extend: event.shiftKey };
  }
  if (ARROWS[event.key]) {
    return {
      type: "move",
      direction: ARROWS[event.key]!,
      extend: event.shiftKey,
    };
  }
  if (event.key === "Tab") {
    return {
      type: "move",
      direction: event.shiftKey ? "left" : "right",
      extend: false,
    };
  }
  if (event.key === "Enter") return { type: "edit" };
  if (event.key === "Escape") return { type: "cancel" };
  if (event.key === "Backspace" || event.key === "Delete") {
    return { type: "clear" };
  }
  if (isPrintable(event)) return { type: "type", text: event.key };
  return null;
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

export function moveCell(
  ref: CellRef,
  direction: GridDirection,
  bounds: GridBounds,
): CellRef {
  const lastRow = Math.max(0, bounds.rows - 1);
  const lastCol = Math.max(0, bounds.cols - 1);
  if (direction === "up")
    return { row: clamp(ref.row - 1, lastRow), col: ref.col };
  if (direction === "down") {
    return { row: clamp(ref.row + 1, lastRow), col: ref.col };
  }
  if (direction === "left") {
    return { row: ref.row, col: clamp(ref.col - 1, lastCol) };
  }
  return { row: ref.row, col: clamp(ref.col + 1, lastCol) };
}

export function jumpCell(
  ref: CellRef,
  edge: "top" | "bottom" | "start" | "end",
  bounds: GridBounds,
): CellRef {
  if (edge === "top") return { row: 0, col: ref.col };
  if (edge === "bottom")
    return { row: Math.max(0, bounds.rows - 1), col: ref.col };
  if (edge === "start") return { row: ref.row, col: 0 };
  return { row: ref.row, col: Math.max(0, bounds.cols - 1) };
}

export interface GridRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function selectionRange(selection: GridSelection): GridRange {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.col, selection.focus.col),
    right: Math.max(selection.anchor.col, selection.focus.col),
  };
}

export function isInRange(range: GridRange, ref: CellRef): boolean {
  return (
    ref.row >= range.top &&
    ref.row <= range.bottom &&
    ref.col >= range.left &&
    ref.col <= range.right
  );
}

/**
 * Apply a movement intent to a selection. `extend` keeps the anchor so
 * Shift+arrow grows the range; a plain move collapses it to one cell.
 */
export function applyMove(
  selection: GridSelection,
  next: CellRef,
  extend: boolean,
): GridSelection {
  return extend
    ? { anchor: selection.anchor, focus: next }
    : { anchor: next, focus: next };
}

/**
 * Where a pasted rectangle lands. A single-cell selection anchors the paste at
 * that cell; a range clamps the paste to the range so a stray large clipboard
 * cannot overwrite rows the user never selected.
 */
export function pasteTargets(input: {
  selection: GridSelection;
  bounds: GridBounds;
  rows: number;
  cols: number;
}): GridRange {
  const range = selectionRange(input.selection);
  const singleCell = range.top === range.bottom && range.left === range.right;
  const bottom = singleCell
    ? range.top + input.rows - 1
    : Math.min(range.bottom, range.top + input.rows - 1);
  const right = singleCell
    ? range.left + input.cols - 1
    : Math.min(range.right, range.left + input.cols - 1);
  return {
    top: range.top,
    left: range.left,
    bottom: Math.min(bottom, input.bounds.rows - 1),
    right: Math.min(right, input.bounds.cols - 1),
  };
}
