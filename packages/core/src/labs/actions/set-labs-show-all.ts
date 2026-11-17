import { z } from "zod";

import { defineAction } from "../../action.js";
import { syncLabsAppState } from "../app-state.js";
import { labsCaller } from "../caller.js";
import { setUserLabsShowAll } from "../store.js";

export default defineAction({
  description:
    "Turn on or off every registered lab the current user hasn't chosen for. A lab the user set on its own keeps their choice. Labs may expose new or unstable features.",
  schema: z.object({
    enabled: z.boolean().describe("Whether to show all Labs features."),
  }),
  outputSchema: z.object({
    enabled: z.boolean(),
    states: z.record(
      z.string(),
      z.union([
        z.object({
          enabled: z.boolean(),
          source: z.enum(["choice", "legacy", "default", "host", "all"]),
          legacyValues: z.record(z.string(), z.boolean()).optional(),
          mixed: z.boolean(),
        }),
        z.object({ error: z.enum(["invalid-choice", "legacy-unavailable"]) }),
      ]),
    ),
  }),
  // In-app only: the switch lives in Settings › Labs, and an outside agent has
  // no reason to widen the experimental features a person opted into.
  mcpTool: false,
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args, ctx) => {
    const { email, scope } = labsCaller(ctx);
    const states = await setUserLabsShowAll(email, args.enabled, scope);
    await syncLabsAppState(states, args.enabled);
    return { enabled: args.enabled, states };
  },
});
