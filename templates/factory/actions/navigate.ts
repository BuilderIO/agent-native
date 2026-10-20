import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a view or a URL path. A factory page is /factory?factoryId=<id> plus tab=<workflows|items|activity|settings>; with no tab it opens Workflows, and without factoryId it opens the factory list. On Workflows add workflow=<workflow id> to open that workflow's canvas, then node=<node id>, edge=<edge id>, run=<run id> (replays that run) or version=<number> (shows a saved version) to select something on it. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z.string().optional().describe("View name to navigate to"),
    path: z
      .string()
      .optional()
      .describe(
        "URL path with its query, such as /factory?factoryId=<id>&tab=settings",
      ),
    threadId: z.string().optional().describe("Chat thread ID to open"),
  }),
  http: false,
  // Setting the current view twice is the same view.
  retrySafe: true,
  run: async (args) => {
    if (!args.view && !args.path) {
      throw new Error("At least --view or --path is required.");
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.path) nav.path = args.path;
    if (args.threadId) nav.threadId = args.threadId;
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view || args.path}`;
  },
});
