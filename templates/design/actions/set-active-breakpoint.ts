import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Set the active breakpoint for a design editor session. " +
    "The active breakpoint controls which responsive frame new edits target. " +
    "The default desktop-down scope applies to that frame and smaller widths; " +
    "the optional 'only' scope confines the override to that frame's range. " +
    "Persists to application state so the agent and UI always agree on the active scope.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    breakpointId: z
      .string()
      .describe(
        "Id of the BreakpointDefinition to activate, or the literal string 'auto' " +
          "to reset to a single-frame (all-breakpoints) view.",
      ),
    editScope: z
      .enum(["cascade-smaller", "only"])
      .optional()
      .default("cascade-smaller")
      .describe(
        "How edits at a responsive frame cascade: 'cascade-smaller' applies to this breakpoint and smaller widths; 'only' confines edits to this breakpoint's range.",
      ),
  }),
  run: async ({ designId, breakpointId, editScope }) => {
    await assertAccess("design", designId, "editor");

    // Persist as application state so view-screen returns it and the UI reflects it.
    await writeAppState(`design-active-breakpoint:${designId}`, {
      designId,
      activeBreakpointId: breakpointId,
      responsiveEditScope: editScope,
      setAt: new Date().toISOString(),
    });

    return {
      designId,
      activeBreakpointId: breakpointId,
      responsiveEditScope: editScope,
    };
  },
});
