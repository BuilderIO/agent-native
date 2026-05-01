import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view or email thread. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (inbox, starred, sent, drafts, archive, trash, draft-queue)",
      ),
    threadId: z.string().optional().describe("Thread ID to open"),
    queuedDraftId: z
      .string()
      .optional()
      .describe("Queued draft ID to select when navigating to draft-queue"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.threadId && !args.queuedDraftId) {
      return "Error: At least --view, --threadId, or --queuedDraftId is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.threadId) nav.threadId = args.threadId;
    if (args.queuedDraftId) {
      nav.view = args.view || "draft-queue";
      nav.queuedDraftId = args.queuedDraftId;
    }
    await writeAppState("navigate", nav);
    return `Navigating to ${nav.view || ""}${args.threadId ? ` thread:${args.threadId}` : ""}${args.queuedDraftId ? ` queued draft:${args.queuedDraftId}` : ""}`;
  },
});
