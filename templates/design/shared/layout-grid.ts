import {
  DEFAULT_GRID_STEP_PX,
  WHOLE_PIXEL_SNAP_STEP,
  quantizeToStep,
} from "./canvas-math";

/** A frame's own grid, not a global setting: one screen can lay out on 8px
 *  while its neighbour does not. `kind` has one value so Figma's `columns` and
 *  `rows` arrive as variants rather than a rewrite of every reader. */
export interface LayoutGrid {
  kind: "uniform";
  /** Cell edge in canvas px. Positions inside the frame snap to multiples. */
  size: number;
  /** Whether the lines are drawn. Snapping does not depend on this — in Figma
   *  the grid's existence is the opt-in, and hiding it only hides the lines. */
  visible: boolean;
}

export type LayoutGridById = Record<string, LayoutGrid>;

export const MIN_LAYOUT_GRID_SIZE = 1;
export const MAX_LAYOUT_GRID_SIZE = 1000;

export const DEFAULT_LAYOUT_GRID: LayoutGrid = {
  kind: "uniform",
  size: DEFAULT_GRID_STEP_PX,
  visible: true,
};

export function normalizeLayoutGridSize(
  value: unknown,
  fallback = DEFAULT_LAYOUT_GRID.size,
): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  return Math.min(
    MAX_LAYOUT_GRID_SIZE,
    Math.max(MIN_LAYOUT_GRID_SIZE, quantizeToStep(parsed)),
  );
}

/** Absent and malformed are both "this frame has no grid" — the caller then
 *  falls back to whole pixels, which is the same thing a size-1 grid does. */
export function parseLayoutGrid(value: unknown): LayoutGrid | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== undefined && raw.kind !== "uniform") return null;
  const size = raw.size;
  if (typeof size !== "number" || !Number.isFinite(size)) return null;
  return {
    kind: "uniform",
    size: normalizeLayoutGridSize(size),
    visible: raw.visible !== false,
  };
}

export function parseLayoutGridById(value: unknown): LayoutGridById {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const grids: LayoutGridById = {};
  for (const [frameId, raw] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const grid = parseLayoutGrid(raw);
    if (grid) grids[frameId] = grid;
  }
  return grids;
}

/** The step a gesture inside `frameId` quantizes to. No grid still returns 1,
 *  so the snap stack has one path instead of an on/off branch. `frameId` is the
 *  *container* whose grid applies: a screen dragged on the board has none. */
export function resolveLayoutGridSnapStep(
  grids: LayoutGridById,
  frameId: string | null | undefined,
): number {
  if (!frameId) return WHOLE_PIXEL_SNAP_STEP;
  const grid = grids[frameId];
  if (!grid) return WHOLE_PIXEL_SNAP_STEP;
  return Math.max(WHOLE_PIXEL_SNAP_STEP, grid.size);
}
