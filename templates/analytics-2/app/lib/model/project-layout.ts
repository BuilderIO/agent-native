import type { Cell } from "./contracts";

export const PROJECT_LAYOUT_COLUMNS = 12;
export const DEFAULT_PROJECT_GRID_HEIGHT = 2;

export interface ProjectGridPlacement {
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
}

type StoredPlacement = {
  gridX?: unknown;
  gridY?: unknown;
  gridWidth?: unknown;
  gridHeight?: unknown;
};

export function projectGridPlacement(
  stored: StoredPlacement,
  index: number,
): ProjectGridPlacement {
  const gridWidth =
    boundedInteger(stored.gridWidth, 1, PROJECT_LAYOUT_COLUMNS) ?? 6;
  const gridX = boundedInteger(
    stored.gridX,
    0,
    PROJECT_LAYOUT_COLUMNS - gridWidth,
  );
  return {
    gridX:
      gridX ?? Math.min((index % 2) * 6, PROJECT_LAYOUT_COLUMNS - gridWidth),
    gridY:
      boundedInteger(stored.gridY, 0, Number.MAX_SAFE_INTEGER) ??
      Math.floor(index / 2) * DEFAULT_PROJECT_GRID_HEIGHT,
    gridWidth,
    gridHeight:
      boundedInteger(stored.gridHeight, 1, 12) ?? DEFAULT_PROJECT_GRID_HEIGHT,
  };
}

export function projectGridLayout(cells: readonly Cell[]) {
  const layout = cells.map((cell, index) => ({
    cell,
    placement: projectGridPlacement(cell.contents, index),
  }));
  const topToBottom = [...layout].sort(
    (left, right) => left.placement.gridY - right.placement.gridY,
  );
  const columnEnds = Array<number>(PROJECT_LAYOUT_COLUMNS).fill(0);
  for (const { placement } of topToBottom) {
    const endColumn = placement.gridX + placement.gridWidth;
    placement.gridY = Math.max(
      placement.gridY,
      ...columnEnds.slice(placement.gridX, endColumn),
    );
    columnEnds.fill(
      placement.gridY + placement.gridHeight,
      placement.gridX,
      endColumn,
    );
  }
  return layout;
}

function boundedInteger(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(max, Math.max(min, value))
    : null;
}
