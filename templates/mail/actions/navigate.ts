import { defineAction, fail } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import {
  getJevContextCredentials,
  getRequestUserEmail,
  isJevEnabled,
} from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view, inbox sort, or email thread. Priority sort requires Jev access. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (inbox, starred, sent, drafts, scheduled, archive, trash, draft-queue, settings)",
      ),
    tab: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe(
        'Inbox tab id to open, from list-inbox-threads\' `tabs` list — All, a pinned label id, a saved filter id, "important", or "other"',
      ),
    filter: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("Saved Mail filter ID to open — alias for --tab"),
    label: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("Pinned label tab id to open — alias for --tab"),
    sort: z
      .enum(["newest", "priority"])
      .optional()
      .describe("Inbox sort order to use"),
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
    if (args.sort === "priority") {
      const ownerEmail = getRequestUserEmail();
      const credentials = ownerEmail
        ? await getJevContextCredentials(ownerEmail)
        : null;
      if (!credentials || !(await isJevEnabled(credentials))) {
        fail("Priority sort requires Jev to be enabled for this account.", {
          errorCode: "jev_not_enabled",
          statusCode: 403,
        });
      }
    }
    const tab = args.tab || args.label || args.filter;
    if (
      !args.view &&
      !tab &&
      !args.threadId &&
      !args.queuedDraftId &&
      !args.settingsSection &&
      !args.composeDraftId &&
      !args.sort
    ) {
      throw new Error(
        "At least --view, --tab, --sort, --threadId, --queuedDraftId, --composeDraftId, or --settingsSection is required.",
      );
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (tab) {
      nav.view = args.view || "inbox";
      nav.tab = tab;
      if (args.filter) nav.filter = args.filter;
    }
    if (args.threadId) nav.threadId = args.threadId;
    if (args.sort) {
      nav.view = args.view || "inbox";
      nav.sort = args.sort;
    }
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
    return `Navigating to ${nav.view || ""}${tab ? ` tab:${tab}` : ""}${args.sort ? ` sort:${args.sort}` : ""}${args.threadId ? ` thread:${args.threadId}` : ""}${args.queuedDraftId ? ` queued draft:${args.queuedDraftId}` : ""}${args.composeDraftId ? ` compose draft:${args.composeDraftId}` : ""}${args.settingsSection ? ` settings:${args.settingsSection}` : ""}`;
  },
});
