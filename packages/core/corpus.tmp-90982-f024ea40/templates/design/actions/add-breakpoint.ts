import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import type {
  BreakpointDefinition,
  BreakpointSet,
} from "../shared/design-state.js";
import { widthToPrefix } from "../shared/responsive-classes.js";

/**
 * Read the active breakpoint set from designs.data, or return a fresh one.
 * Breakpoint sets are stored inline in `designs.data.breakpointSet` rather
 * than a dedicated table (simplest additive storage for v1; a dedicated table
 * can be added later if per-screen sets are needed).
 *
 * Follow-up: if per-screen breakpoint sets become necessary, add a
 * `design_breakpoint_set` table keyed by (design_id, file_id) and migrate
 * this in-data storage to it.
 */
function readBreakpointSet(
  designData: DesignDataRecord,
  fallbackId: string,
): BreakpointSet {
  if (
    designData.breakpointSet &&
    typeof designData.breakpointSet === "object"
  ) {
    return designData.breakpointSet as BreakpointSet;
  }
  return { id: fallbackId, breakpoints: [] };
}

export default defineAction({
  description:
    "Add a breakpoint frame to the design's breakpoint set. " +
    "The breakpoint set is stored in designs.data and controls which side-by-side " +
    "device widths are shown in the overview canvas and the editor's breakpoint bar " +
    "(Framer defaults: Phone 390 / Tablet 810 / Desktop 1200, or a custom width). " +
    "Every frame renders the SAME document at its own viewport width (Framer model); " +
    "edits made at a narrower active frame persist as width-scoped overrides that " +
    "cascade down (see the responsive-breakpoints skill). The legacy Tailwind prefix " +
    "is derived automatically from the width. Duplicate widths are silently ignored.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    label: z
      .string()
      .min(1)
      .describe(
        "Human-readable label shown in the canvas header (e.g. 'Mobile', 'Tablet', 'Desktop').",
      ),
    widthPx: z
      .number()
      .int()
      .min(320)
      .max(3840)
      .describe(
        "Frame width in pixels. Snaps semantics to the nearest Tailwind min-width threshold " +
          "(sm:640 / md:768 / lg:1024 / xl:1280 / 2xl:1536); the exact pixel value is preserved " +
          "for the frame geometry.",
      ),
    id: z
      .string()
      .optional()
      .describe("Optional pre-generated id. Omit to auto-generate."),
  }),
  run: async ({ designId, label, widthPx, id: providedId }) => {
    await assertAccess("design", designId, "editor");

    const breakpointId = providedId ?? nanoid();
    const breakpointSetId = nanoid();
    const prefix = widthToPrefix(widthPx);
    const newBreakpoint: BreakpointDefinition = {
      id: breakpointId,
      label,
      widthPx,
      prefix,
    };

    const persisted = await mutateDesignData({
      designId,
      mutate: (current, { updatedAt }) => {
        const set = readBreakpointSet(current, breakpointSetId);
        if (set.breakpoints.some((bp) => bp.widthPx === widthPx)) {
          return current;
        }
        // Insert sorted by widthPx ascending (Mobile → Tablet → Desktop).
        const breakpoints = [...set.breakpoints, newBreakpoint].sort(
          (a, b) => a.widthPx - b.widthPx,
        );
        return {
          ...current,
          breakpointSet: { ...set, breakpoints },
          breakpointSetUpdatedAt: updatedAt,
        };
      },
      isApplied: (current) =>
        readBreakpointSet(current, breakpointSetId).breakpoints.some(
          (breakpoint) => breakpoint.widthPx === widthPx,
        ),
    });
    const updatedSet = readBreakpointSet(persisted.data, breakpointSetId);
    const added = updatedSet.breakpoints.find(
      (breakpoint) => breakpoint.id === breakpointId,
    );

    if (!added) {
      return {
        ignored: true,
        reason: `A breakpoint with width ${widthPx}px already exists.`,
        breakpointSet: updatedSet,
      };
    }

    return {
      added,
      breakpointSet: updatedSet,
    };
  },
});
