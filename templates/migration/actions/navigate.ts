import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the Migration Workbench UI to a run, goal state, artifact, or path.",
  schema: z.object({
    view: z.string().optional().describe("View name to navigate to"),
    runId: z.string().optional().describe("Migration run ID to open"),
    extensionId: z.string().optional().describe("Extension ID to open"),
    path: z.string().optional().describe("URL path to navigate to"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path && !args.runId && !args.extensionId) {
      return "Error: At least --view, --runId, --extensionId, or --path is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.runId) nav.runId = args.runId;
    if (args.extensionId) nav.extensionId = args.extensionId;
    if (args.path) nav.path = args.path;
    await writeAppState("navigate", nav);
    return `Navigating to ${
      args.runId || args.view || args.extensionId || args.path
    }`;
  },
});
