import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
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
    filter: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("Saved Mail filter ID to open"),
    threadId: z.string().optional().describe("Thread ID to open"),
    settingsSection: z
      .string()
      .optional()
      .describe(
        "Settings section to open, such as drafting, automations, ai-filter, gmail-filters, aliases, tracking, slack, or team",
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
      !args.filter &&
      !args.threadId &&
      !args.queuedDraftId &&
      !args.settingsSection &&
      !args.composeDraftId
    ) {
      throw new Error(
        "At least --view, --filter, --threadId, --queuedDraftId, --composeDraftId, or --settingsSection is required.",
      );
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.filter) {
      nav.view = args.view || "inbox";
      nav.filter = args.filter;
    }
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
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${nav.view || ""}${args.filter ? ` filter:${args.filter}` : ""}${args.threadId ? ` thread:${args.threadId}` : ""}${args.queuedDraftId ? ` queued draft:${args.queuedDraftId}` : ""}${args.composeDraftId ? ` compose draft:${args.composeDraftId}` : ""}${args.settingsSection ? ` settings:${args.settingsSection}` : ""}`;
  },
});
