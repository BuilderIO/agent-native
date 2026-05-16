import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the Migration Workbench UI to a run, goal state, artifact, or path.",
  schema: z.object({
    view: z.string().optional().describe("View name to navigate to"),
    runId: z.string().optional().describe("Migration run ID to open"),
    path: z.string().optional().describe("URL path to navigate to"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path && !args.runId) {
      return "Error: At least --view, --runId, or --path is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.runId) nav.runId = args.runId;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.runId || args.view || args.path}`;
  },
});
