import {
  type GridSizePickerOwnProps,
  gridSizePickerProps,
} from "@agent-native/design-system";
import * as React from "react";

import { cn } from "../../utils.js";
import { Button } from "./button.js";
import { useControlledValue } from "./controlled-value.js";
import { NumberField } from "./number-field.js";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover.js";
import { splitProps } from "./props.js";
import {
  Select,
  SelectPopup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";

/** A grid's tracks: `rows` is `"auto"` when rows are added as content needs them. */
export interface GridSize {
  columns: number;
  rows: number | "auto";
}

/** The picker's copy, English by default. */
export interface GridSizePickerLabels {
  popup: string;
  columns: string;
  rows: string;
  rowSizing: string;
  auto: string;
  fixed: string;
  matrix: string;
  openSettings: string;
}

export interface GridSizePickerProps
  extends
    Omit<
      React.ComponentPropsWithoutRef<"button">,
      "value" | "defaultValue" | "onChange" | "color"
    >,
    GridSizePickerOwnProps {
  value?: GridSize;
  defaultValue?: GridSize;
  onValueChange?: (value: GridSize) => void;
  /** Called by the "Open grid settings" button, after the popover closes. */
  onOpenSettings?: () => void;
  labels?: Partial<GridSizePickerLabels>;
}

const DEFAULT_LABELS: GridSizePickerLabels = {
  popup: "Grid size",
  columns: "Columns",
  rows: "Rows",
  rowSizing: "Row sizing",
  auto: "Auto",
  fixed: "Fixed",
  matrix: "Columns and rows",
  openSettings: "Open grid settings",
};

const MATRIX_COLUMNS = 12;
const MATRIX_ROWS = 8;
const DEFAULT_VALUE: GridSize = { columns: 2, rows: "auto" };

interface Corner {
  column: number;
  row: number;
}

const MOVES = new Map<string, Corner>([
  ["ArrowUp", { column: 0, row: -1 }],
  ["ArrowDown", { column: 0, row: 1 }],
  ["ArrowLeft", { column: -1, row: 0 }],
  ["ArrowRight", { column: 1, row: 0 }],
]);

const clamp = (value: number, max: number) => Math.min(Math.max(value, 1), max);

function cornerOf(value: GridSize): Corner {
  return {
    column: clamp(value.columns, MATRIX_COLUMNS),
    row: value.rows === "auto" ? 1 : clamp(value.rows, MATRIX_ROWS),
  };
}

/**
 * Sets a Grid layout's columns and rows. The trigger is a tile, the size of
 * an Alignment Picker, that draws the grid it sets and reads "C × R"; auto
 * rows run past its bottom edge, and many columns widen it in 8px steps. Its popover has a field for
 * each, a matrix to size by pointer or arrow keys with a live readout, and
 * a button that opens the full grid settings.
 *
 * @import import { GridSizePicker } from "@agent-native/toolkit/ui/base-ui/grid-size-picker";
 */
const GridSizePicker = React.forwardRef<HTMLButtonElement, GridSizePickerProps>(
  (props, ref) => {
    const [
      attributes,
      {
        className,
        value: valueProp,
        defaultValue = DEFAULT_VALUE,
        onValueChange,
        onOpenSettings,
        labels: labelsProp,
        style,
        ...rest
      },
    ] = splitProps(gridSizePickerProps, props);
    const labels = { ...DEFAULT_LABELS, ...labelsProp };
    const [value, setValue] = useControlledValue(
      valueProp,
      defaultValue,
      onValueChange,
    );
    const [open, setOpen] = React.useState(false);
    const [preview, setPreview] = React.useState<Corner | null>(null);
    const [cursor, setCursor] = React.useState<Corner>(() => cornerOf(value));
    const [fixedRows, setFixedRows] = React.useState(
      value.rows === "auto" ? 1 : value.rows,
    );
    const cells = React.useRef(new Map<string, HTMLDivElement>());

    const format = (columns: number, rows: number | "auto") =>
      `${columns} × ${rows === "auto" ? labels.auto : rows}`;

    const commit = (next: GridSize) => {
      if (next.rows !== "auto") setFixedRows(next.rows);
      setCursor(cornerOf(next));
      setValue(next);
    };

    const moveTo = (corner: Corner) => {
      setCursor(corner);
      setPreview(corner);
      cells.current.get(`${corner.row}-${corner.column}`)?.focus();
    };

    const onCellKeyDown = (event: React.KeyboardEvent, corner: Corner) => {
      const move = MOVES.get(event.key);
      if (move !== undefined) {
        event.preventDefault();
        moveTo({
          column: clamp(corner.column + move.column, MATRIX_COLUMNS),
          row: clamp(corner.row + move.row, MATRIX_ROWS),
        });
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        commit({ columns: corner.column, rows: corner.row });
      }
    };

    const shown = preview ?? {
      column: value.columns,
      row: value.rows === "auto" ? MATRIX_ROWS : value.rows,
    };
    const readout = preview
      ? format(preview.column, preview.row)
      : format(value.columns, value.rows);
    const previewColumns = Math.min(value.columns, MATRIX_COLUMNS);
    const previewRows =
      value.rows === "auto" ? MATRIX_ROWS : Math.min(value.rows, MATRIX_ROWS);
    const tileStyle = {
      ...style,
      "--_columns": previewColumns,
      "--_rows": previewRows,
    } as React.CSSProperties;

    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setCursor(cornerOf(value));
          setPreview(null);
        }}
      >
        <PopoverTrigger
          ref={ref}
          {...rest}
          {...attributes}
          data-auto={value.rows === "auto" ? "" : undefined}
          className={cn("grid-size-picker", className)}
          style={tileStyle}
        >
          <span className="grid-size-picker-preview" aria-hidden>
            {Array.from(
              { length: previewColumns * previewRows },
              (_, index) => (
                <span key={index} className="grid-size-picker-preview-cell" />
              ),
            )}
          </span>
          <span className="grid-size-picker-label">
            {format(value.columns, value.rows)}
          </span>
        </PopoverTrigger>
        <PopoverPopup align="start" aria-label={labels.popup}>
          <div className="grid-size-picker-panel">
            <div
              className="grid-size-picker-fields"
              data-auto={value.rows === "auto" ? "" : undefined}
            >
              <NumberField
                aria-label={labels.columns}
                min={1}
                value={value.columns}
                onValueChange={(columns) => {
                  if (columns !== null) commit({ ...value, columns });
                }}
              />
              <span className="grid-size-picker-times" aria-hidden>
                ×
              </span>
              {value.rows === "auto" ? null : (
                <NumberField
                  aria-label={labels.rows}
                  min={1}
                  value={value.rows}
                  onValueChange={(rows) => {
                    if (rows !== null) commit({ ...value, rows });
                  }}
                />
              )}
              <Select
                items={[
                  { value: "auto", label: labels.auto },
                  { value: "fixed", label: labels.fixed },
                ]}
                value={value.rows === "auto" ? "auto" : "fixed"}
                onValueChange={(mode) => {
                  commit({
                    ...value,
                    rows: mode === "auto" ? "auto" : fixedRows,
                  });
                }}
              >
                <SelectTrigger aria-label={labels.rowSizing}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="auto">{labels.auto}</SelectItem>
                  <SelectItem value="fixed">{labels.fixed}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div
              role="grid"
              aria-label={labels.matrix}
              className="grid-size-picker-matrix"
              onPointerLeave={() => setPreview(null)}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (
                  !(next instanceof Node && event.currentTarget.contains(next))
                )
                  setPreview(null);
              }}
            >
              {Array.from({ length: MATRIX_ROWS }, (_, rowIndex) => {
                const row = rowIndex + 1;
                return (
                  <div key={row} role="row" className="grid-size-picker-row">
                    {Array.from(
                      { length: MATRIX_COLUMNS },
                      (_, columnIndex) => {
                        const column = columnIndex + 1;
                        const corner = { column, row };
                        const selected =
                          column <= value.columns &&
                          (value.rows === "auto" || row <= value.rows);
                        const highlighted =
                          column <= shown.column && row <= shown.row;
                        const isCursor =
                          cursor.column === column && cursor.row === row;
                        return (
                          <div
                            key={column}
                            ref={(node) => {
                              const key = `${row}-${column}`;
                              if (node === null) cells.current.delete(key);
                              else cells.current.set(key, node);
                            }}
                            role="gridcell"
                            aria-label={format(column, row)}
                            aria-selected={selected}
                            tabIndex={isCursor ? 0 : -1}
                            data-highlighted={highlighted ? "" : undefined}
                            className="grid-size-picker-cell"
                            onPointerEnter={() => {
                              setCursor(corner);
                              setPreview(corner);
                            }}
                            onFocus={() => {
                              setCursor(corner);
                              setPreview(corner);
                            }}
                            onClick={() =>
                              commit({ columns: column, rows: row })
                            }
                            onKeyDown={(event) => onCellKeyDown(event, corner)}
                          />
                        );
                      },
                    )}
                  </div>
                );
              })}
            </div>
            <div role="status" className="grid-size-picker-readout">
              {readout}
            </div>
            <Button
              variant="soft"
              color="gray"
              onClick={() => {
                setOpen(false);
                onOpenSettings?.();
              }}
            >
              {labels.openSettings}
            </Button>
          </div>
        </PopoverPopup>
      </Popover>
    );
  },
);
GridSizePicker.displayName = "GridSizePicker";

export { GridSizePicker };
