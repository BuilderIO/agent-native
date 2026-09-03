import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  DEFAULT_LAYOUT_GRID,
  MAX_LAYOUT_GRID_SIZE,
  MIN_LAYOUT_GRID_SIZE,
  parseLayoutGridById,
} from "../shared/layout-grid.js";

export default defineAction({
  description:
    "Set or clear one screen's layout grid: a uniform grid that every position " +
    "inside that screen is quantized to. Pass `size` to add or resize it (8 is the " +
    "default rhythm), `visible` to show or hide its lines without changing whether " +
    "it snaps, or `remove: true` to drop it entirely. A screen with no grid still " +
    "lands on whole pixels. When placing elements into a screen that has a grid, " +
    "use left/top values that are multiples of its size so agent-authored layout " +
    "matches what dragging produces.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    screenId: z
      .string()
      .describe(
        "The screen/file id the grid belongs to. Grids are per-screen, so this is " +
          "the same id `view-screen` reports, not the design id.",
      ),
    size: z
      .number()
      .int()
      .min(MIN_LAYOUT_GRID_SIZE)
      .max(MAX_LAYOUT_GRID_SIZE)
      .optional()
      .describe(
        `Cell edge in the screen's own content pixels. Defaults to ${DEFAULT_LAYOUT_GRID.size} when adding a grid.`,
      ),
    visible: z
      .boolean()
      .optional()
      .describe(
        "Whether the grid lines are drawn. Snapping does not depend on this — the " +
          "grid's existence is what turns snapping on.",
      ),
    remove: z
      .boolean()
      .optional()
      .describe("Remove this screen's grid entirely instead of setting one."),
  }),
  run: async ({ designId, screenId, size, visible, remove }) => {
    await assertAccess("design", designId, "editor");

    const persisted = await mutateDesignData({
      designId,
      mutate: (current) => {
        const grids = parseLayoutGridById(current.layoutGrids);
        if (remove) {
          if (!grids[screenId]) return current;
          const { [screenId]: _removed, ...rest } = grids;
          return { ...current, layoutGrids: rest };
        }
        const existing = grids[screenId];
        return {
          ...current,
          layoutGrids: {
            ...grids,
            [screenId]: {
              kind: "uniform" as const,
              size: size ?? existing?.size ?? DEFAULT_LAYOUT_GRID.size,
              visible:
                visible ?? existing?.visible ?? DEFAULT_LAYOUT_GRID.visible,
            },
          },
        };
      },
      // Intent-based, so a sibling writer adding an unrelated key right after
      // our commit is not mistaken for a lost write.
      isApplied: (current) => {
        const grid = parseLayoutGridById(current.layoutGrids)[screenId];
        if (remove) return !grid;
        if (!grid) return false;
        if (size !== undefined && grid.size !== size) return false;
        return visible === undefined || grid.visible === visible;
      },
    });

    const grid = parseLayoutGridById(persisted.data.layoutGrids)[screenId];
    return remove
      ? { screenId, grid: null, removed: true }
      : { screenId, grid: grid ?? null, removed: false };
  },
});
