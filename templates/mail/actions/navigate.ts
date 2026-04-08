import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Navigate the UI to a specific view or email thread. Writes a navigate command to application state which the UI reads and auto-deletes.",
  parameters: {
    view: {
      type: "string",
      description:
        "View to navigate to (inbox, starred, sent, drafts, archive, trash)",
    },
    threadId: { type: "string", description: "Thread ID to open" },
  },
  http: false,
  run: async (args) => {
    if (!args.view && !args.threadId) {
      return "Error: At least --view or --threadId is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.threadId) nav.threadId = args.threadId;
    await writeAppState("navigate", nav);
    return `Navigating to ${args.view || ""}${args.threadId ? ` thread:${args.threadId}` : ""}`;
  },
});
