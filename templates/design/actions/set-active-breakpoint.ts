import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Set the active breakpoint for a design editor session. " +
    "The active breakpoint controls which frame is the current edit scope: " +
    "editing a layer while 'base' is active writes unprefixed Tailwind classes; " +
    "editing while 'md' is active writes md: prefixed classes. " +
    "Persists to application state so the agent and UI always agree on the active scope.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    breakpointId: z
      .string()
      .describe(
        "Id of the BreakpointDefinition to activate, or the literal string 'auto' " +
          "to reset to a single-frame (all-breakpoints) view.",
      ),
  }),
  run: async ({ designId, breakpointId }) => {
    await assertAccess("design", designId, "editor");

    // Persist as application state so view-screen returns it and the UI reflects it.
    await writeAppState(`design-active-breakpoint:${designId}`, {
      designId,
      activeBreakpointId: breakpointId,
      setAt: new Date().toISOString(),
    });

    return {
      designId,
      activeBreakpointId: breakpointId,
    };
  },
});
