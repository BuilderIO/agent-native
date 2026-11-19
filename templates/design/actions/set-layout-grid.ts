import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { isOverviewScreenFile } from "../shared/design-files.js";
import {
  DEFAULT_LAYOUT_GRID,
  MAX_LAYOUT_GRID_SIZE,
  MIN_LAYOUT_GRID_SIZE,
  parseLayoutGridById,
} from "../shared/layout-grid.js";

const errors = defineActionErrors("screen_not_found");

export default defineAction({
  description:
    "Set or clear one screen's layout grid: a uniform grid that every position " +
    "inside that screen is quantized to. Pass `size` to add or resize it (8 is the " +
    "default rhythm), `visible` to show or hide its lines without changing whether " +
    "it snaps, or `remove: true` to drop it entirely. A screen with no grid still " +
    "lands on whole pixels. When placing elements into a screen that has a grid, " +
    "use left/top values that are multiples of its size so agent-authored layout " +
    "matches what dragging produces.",
  errors,
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

    const files = await getDb()
      .select({
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, screenId),
          eq(schema.designFiles.designId, designId),
        ),
      )
      .limit(1);
    const isScreen = files.some(isOverviewScreenFile);

    const persisted = await mutateDesignData({
      designId,
      mutate: (current) => {
        const grids = parseLayoutGridById(current.layoutGrids);
        // A grid keyed to a non-screen is an orphan from an earlier wrong id;
        // removing it stays allowed so it can be cleaned up.
        const hasGrid = Object.keys(grids).includes(screenId);
        if (!isScreen && !(remove && hasGrid)) {
          return errors.noWrite(
            `Screen not found in this design: ${screenId}. Pass a screen's file id as reported by view-screen, not the design id or a filename.`,
            "screen_not_found",
            { statusCode: 404 },
          );
        }
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
