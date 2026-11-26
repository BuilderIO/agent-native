import {
  type AlignmentPickerOwnProps,
  alignmentPickerProps,
} from "@agent-native/design-system";
import { useDirection } from "@base-ui/react/direction-provider";
import * as React from "react";

import { cn } from "../../utils.js";
import { isComposingKey } from "../is-composing-key.js";
import { useControlledValue } from "./controlled-value.js";
import { splitProps } from "./props.js";
import { activeElementInRoot } from "./surface-target.js";

export type AlignmentJustify = "start" | "center" | "end" | "space-between";
export type AlignmentAlign =
  | "start"
  | "center"
  | "end"
  | "stretch"
  | "baseline";

/** A flex alignment: `justify` is `justify-content`, `align` is `align-items`. */
export interface AlignmentValue {
  justify: AlignmentJustify;
  align: AlignmentAlign;
}

type Position = "start" | "center" | "end";

/**
 * Where a cell sits in the matrix, top to bottom and left to right. `null`
 * is a cell that spans the main axis, as every cell does for `space-between`.
 */
export interface AlignmentCellPosition {
  row: Position | null;
  column: Position | null;
}

export interface AlignmentPickerProps
  extends
    Omit<
      React.ComponentPropsWithoutRef<"div">,
      "defaultValue" | "onChange" | "color" | "dir"
    >,
    AlignmentPickerOwnProps {
  value?: AlignmentValue;
  defaultValue?: AlignmentValue;
  onValueChange?: (value: AlignmentValue) => void;
  disabled?: boolean;
  /** Names a cell's radio; "Top left" … "Bottom right" by default. */
  getCellLabel?: (position: AlignmentCellPosition) => string;
  dir?: "ltr" | "rtl";
}

const POSITIONS: readonly Position[] = ["start", "center", "end"];

const ROW_NAMES: Record<Position, string> = {
  start: "Top",
  center: "Center",
  end: "Bottom",
};

const COLUMN_NAMES: Record<Position, string> = {
  start: "Left",
  center: "Center",
  end: "Right",
};

function defaultCellLabel(
  { row, column }: AlignmentCellPosition,
  rtl: boolean,
): string {
  if (rtl && column !== null && column !== "center")
    column = column === "start" ? "end" : "start";
  if (row === null && column === null) return "Fill";
  if (row === null) return COLUMN_NAMES[column ?? "center"];
  if (column === null) return ROW_NAMES[row];
  if (row === "center" && column === "center") return "Center";
  return `${ROW_NAMES[row]} ${COLUMN_NAMES[column].toLowerCase()}`;
}

interface Cell {
  key: string;
  position: AlignmentCellPosition;
  value: AlignmentValue;
}

function mainPosition(justify: AlignmentJustify): Position | null {
  return justify === "space-between" ? null : justify;
}

function crossPosition(align: AlignmentAlign): Position {
  if (align === "stretch") return "center";
  return align === "baseline" ? "start" : align;
}

function cellsFor(value: AlignmentValue, direction: "row" | "column"): Cell[] {
  const mains = value.justify === "space-between" ? [null] : POSITIONS;
  const crosses = POSITIONS;
  const rows = direction === "row" ? crosses : mains;
  const columns = direction === "row" ? mains : crosses;
  return rows.flatMap((row) =>
    columns.map((column) => {
      const main = direction === "row" ? column : row;
      const cross = direction === "row" ? row : column;
      return {
        key: `${row ?? "all"}-${column ?? "all"}`,
        position: { row, column },
        value: { justify: main ?? "space-between", align: cross ?? "center" },
      };
    }),
  );
}

function isChecked(
  cell: Cell,
  value: AlignmentValue,
  direction: "row" | "column",
): boolean {
  const main = mainPosition(value.justify);
  const cross = crossPosition(value.align);
  const { row, column } = cell.position;
  return direction === "row"
    ? column === main && row === cross
    : row === main && column === cross;
}

function trackAttribute(position: Position | null): string {
  return position === null ? "all" : String(POSITIONS.indexOf(position) + 1);
}

const MOVES = new Map<string, [number, number]>([
  ["ArrowUp", [-1, 0]],
  ["ArrowDown", [1, 0]],
  ["ArrowLeft", [0, -1]],
  ["ArrowRight", [0, 1]],
]);

function neighbour(
  cells: readonly Cell[],
  from: Cell,
  [rowStep, columnStep]: [number, number],
): Cell | undefined {
  const index = (position: Position | null) =>
    position === null ? null : POSITIONS.indexOf(position);
  const row = index(from.position.row);
  const column = index(from.position.column);
  if ((rowStep !== 0 && row === null) || (columnStep !== 0 && column === null))
    return undefined;
  const targetRow = row === null ? null : row + rowStep;
  const targetColumn = column === null ? null : column + columnStep;
  return cells.find(
    (cell) =>
      index(cell.position.row) === targetRow &&
      index(cell.position.column) === targetColumn,
  );
}

const DEFAULT_VALUE: AlignmentValue = { justify: "start", align: "start" };

/**
 * A 3×3 matrix of alignment positions for a Flex or Flow layout, as a radio
 * group of nine named radios that the arrow keys move between in two
 * dimensions. Unselected cells draw a dot; the selected cell draws bars in
 * the layout's direction, full length for `stretch`. Double-clicking a cell,
 * or Enter on it, switches between its position and `space-between`, which
 * collapses the matrix to three cells across the main axis; double-clicking
 * a collapsed cell returns to the position under the pointer, and Enter to
 * the centre.
 *
 * @import import { AlignmentPicker } from "@agent-native/toolkit/ui/base-ui/alignment-picker";
 */
const AlignmentPicker = React.forwardRef<HTMLDivElement, AlignmentPickerProps>(
  (props, ref) => {
    const [
      attributes,
      {
        className,
        value: valueProp,
        defaultValue = DEFAULT_VALUE,
        onValueChange,
        disabled = false,
        getCellLabel,
        dir,
        ...rest
      },
    ] = splitProps(alignmentPickerProps, props);
    const inheritedDir = useDirection();
    const readingDirection = dir ?? inheritedDir;
    const rtl = readingDirection === "rtl";
    const direction = props.direction ?? "row";
    const [value, setValue] = useControlledValue(
      valueProp,
      defaultValue,
      onValueChange,
    );
    const cells = cellsFor(value, direction);
    const checked = cells.find((cell) => isChecked(cell, value, direction));
    const tabStop = checked ?? cells.at(0);
    const buttons = React.useRef(new Map<string, HTMLButtonElement>());
    const detachedFocus = React.useRef<HTMLButtonElement | null>(null);
    React.useLayoutEffect(() => {
      const previous = detachedFocus.current;
      detachedFocus.current = null;
      if (
        tabStop &&
        previous &&
        !previous.isConnected &&
        previous.ownerDocument.activeElement === previous.ownerDocument.body
      ) {
        buttons.current.get(tabStop.key)?.focus();
      }
    });

    const select = (cell: Cell) => {
      if (cell === checked) return;
      setValue(cell.value);
    };

    const toggleDistribution = (cell: Cell, main: Position = "center") => {
      const { row, column } = cell.position;
      const cross = (direction === "row" ? row : column) ?? "center";
      const align = cell === checked ? value.align : cross;
      setValue(
        value.justify === "space-between"
          ? { justify: main, align }
          : { justify: "space-between", align },
      );
    };

    const pointerPosition = (event: React.MouseEvent): Position => {
      const rect = event.currentTarget.getBoundingClientRect();
      const [offset, length] =
        direction === "row"
          ? [event.clientX - rect.left, rect.width]
          : [event.clientY - rect.top, rect.height];
      if (!(length > 0)) return "center";
      const third = Math.min(2, Math.max(0, Math.floor((offset / length) * 3)));
      return (
        POSITIONS.at(rtl && direction === "row" ? 2 - third : third) ?? "center"
      );
    };

    const onKeyDown = (event: React.KeyboardEvent, cell: Cell) => {
      if (
        event.defaultPrevented ||
        isComposingKey(event) ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.ctrlKey
      )
        return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (!event.repeat) toggleDistribution(cell);
        return;
      }
      const move = MOVES.get(event.key);
      if (move === undefined) return;
      event.preventDefault();
      const target = neighbour(cells, cell, rtl ? [move[0], -move[1]] : move);
      if (target === undefined) return;
      buttons.current.get(target.key)?.focus();
      select(target);
    };

    return (
      <div
        ref={ref}
        dir={readingDirection}
        role="radiogroup"
        aria-disabled={disabled || undefined}
        {...rest}
        {...attributes}
        data-justify={value.justify}
        data-align={value.align}
        data-disabled={disabled ? "" : undefined}
        className={cn("alignment-picker", className)}
      >
        {cells.map((cell) => {
          const isOn = cell === checked;
          return (
            <button
              key={cell.key}
              ref={(node) => {
                if (node) {
                  buttons.current.set(cell.key, node);
                } else {
                  const previous = buttons.current.get(cell.key);
                  if (previous && activeElementInRoot(previous) === previous)
                    detachedFocus.current = previous;
                  buttons.current.delete(cell.key);
                }
              }}
              type="button"
              role="radio"
              aria-checked={isOn}
              aria-label={
                getCellLabel
                  ? getCellLabel(cell.position)
                  : defaultCellLabel(cell.position, rtl)
              }
              tabIndex={cell === tabStop ? 0 : -1}
              disabled={disabled}
              data-row={trackAttribute(cell.position.row)}
              data-column={trackAttribute(cell.position.column)}
              data-checked={isOn ? "" : undefined}
              className="alignment-picker-cell"
              onClick={() => select(cell)}
              onDoubleClick={(event) =>
                toggleDistribution(cell, pointerPosition(event))
              }
              onKeyDown={(event) => onKeyDown(event, cell)}
            >
              <span className="alignment-picker-glyph" aria-hidden>
                <span className="alignment-picker-mark" />
                <span className="alignment-picker-mark" />
                <span className="alignment-picker-mark" />
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);
AlignmentPicker.displayName = "AlignmentPicker";

export { AlignmentPicker };
