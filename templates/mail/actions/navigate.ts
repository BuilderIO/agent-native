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
        "View to navigate to (inbox, starred, sent, drafts, scheduled, archive, trash, draft-queue, settings)",
      ),
    threadId: z.string().optional().describe("Thread ID to open"),
    settingsSection: z
      .string()
      .optional()
      .describe(
        "Settings section to open, such as drafting, automations, gmail-filters, aliases, tracking, slack, or team",
      ),
    queuedDraftId: z
      .string()
      .optional()
      .describe("Queued draft ID to select when navigating to draft-queue"),
    composeDraftId: z
      .string()
      .optional()
      .describe(
        "Compose draft ID to reopen — opens the inbox so the compose panel auto-shows the matching compose-<id> draft",
      ),
  }),
  http: false,
  run: async (args) => {
    if (
      !args.view &&
      !args.threadId &&
      !args.queuedDraftId &&
      !args.settingsSection &&
      !args.composeDraftId
    ) {
      return "Error: At least --view, --threadId, --queuedDraftId, --composeDraftId, or --settingsSection is required.";
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.threadId) nav.threadId = args.threadId;
    if (args.settingsSection) {
      nav.view = args.view || "settings";
      nav.settingsSection = args.settingsSection;
    }
    if (args.queuedDraftId) {
      nav.view = args.view || "draft-queue";
      nav.queuedDraftId = args.queuedDraftId;
    }
    if (args.composeDraftId) {
      nav.view = args.view || "inbox";
      nav.composeDraftId = args.composeDraftId;
    }
    await writeAppState("navigate", nav);
    return `Navigating to ${nav.view || ""}${args.threadId ? ` thread:${args.threadId}` : ""}${args.queuedDraftId ? ` queued draft:${args.queuedDraftId}` : ""}${args.composeDraftId ? ` compose draft:${args.composeDraftId}` : ""}${args.settingsSection ? ` settings:${args.settingsSection}` : ""}`;
  },
});
