import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import type { BreakpointSet } from "../shared/design-state.js";

function readBreakpointSet(designData: DesignDataRecord): BreakpointSet | null {
  if (
    designData.breakpointSet &&
    typeof designData.breakpointSet === "object"
  ) {
    return designData.breakpointSet as BreakpointSet;
  }
  return null;
}

export default defineAction({
  description:
    "Remove a breakpoint frame from the design's breakpoint set by its id. " +
    "If the active breakpoint (stored in application state) matches the removed " +
    "breakpoint, the UI should reset to the first remaining breakpoint or 'auto'.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    breakpointId: z
      .string()
      .describe("Id of the BreakpointDefinition to remove."),
  }),
  run: async ({ designId, breakpointId }) => {
    await assertAccess("design", designId, "editor");

    let sawSet = false;
    let removedBreakpoint: BreakpointSet["breakpoints"][number] | undefined;
    const persisted = await mutateDesignData({
      designId,
      mutate: (current, { updatedAt }) => {
        const set = readBreakpointSet(current);
        if (!set) return current;
        sawSet = true;
        const removed = set.breakpoints.find((bp) => bp.id === breakpointId);
        if (!removed) return current;
        removedBreakpoint = removed;
        return {
          ...current,
          breakpointSet: {
            ...set,
            breakpoints: set.breakpoints.filter((bp) => bp.id !== breakpointId),
          },
          breakpointSetUpdatedAt: updatedAt,
        };
      },
      isApplied: (current) =>
        !readBreakpointSet(current)?.breakpoints.some(
          (breakpoint) => breakpoint.id === breakpointId,
        ),
    });
    const updatedSet = readBreakpointSet(persisted.data);

    if (!sawSet && !updatedSet) {
      return {
        removed: false,
        reason: "No breakpoint set found for this design.",
      };
    }
    if (!removedBreakpoint) {
      return {
        removed: false,
        reason: `Breakpoint '${breakpointId}' not found in the set.`,
      };
    }

    return {
      removed: true,
      removedBreakpoint,
      breakpointSet: updatedSet!,
    };
  },
});
