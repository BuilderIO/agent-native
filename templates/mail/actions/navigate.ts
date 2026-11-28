import { defineAction, fail } from "@agent-native/core/action";
import {
  navigationIntentSchema,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { getDecisionsStatus } from "@agent-native/core/decisions";
import { getRequestUserEmail } from "@agent-native/core/server";
import { viewTakesInboxFilter } from "@shared/inbox-filters.js";
import {
  MAIL_SETTINGS_SECTIONS,
  mailSettingsRoute,
} from "@shared/settings-navigation.js";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view, inbox sort, or email thread. Priority sort requires a configured decision provider. Writes a navigate command to application state which the UI reads and auto-deletes; settings opens its URL in the current tab.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (inbox, sent, drafts, archive, trash, all, draft-queue, settings). Unread and Starred are filters on inbox and all, not views: use unread or starred. Drafts also lists scheduled emails and drafts teammates requested; scheduled, and draft-queue without queuedDraftId, open Drafts. view inbox or all alone clears its filter",
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
    unread: z
      .boolean()
      .optional()
      .describe(
        "Filter to unread (true) or read (false) conversations; combine with starred, tab, or view inbox or all",
      ),
    starred: z
      .boolean()
      .optional()
      .describe(
        "Filter to starred (true) or unstarred (false) conversations; combine with unread, tab, or view inbox or all. With no view, tab, or sort, starred true opens All Mail, which keeps starred mail after it is archived; other filters open the inbox",
      ),
    threadId: z.string().optional().describe("Thread ID to open"),
    settingsSection: z
      .enum(MAIL_SETTINGS_SECTIONS)
      .optional()
      .describe(
        "Settings to open: general, a Mail › General tab (reading, drafting, snippets, rules for inbox rules, ai-filter, gmail-filters, aliases, tracking), slack for Channels › Slack, or members",
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
    intent: navigationIntentSchema,
  }),
  http: false,
  mcpTool: "search",
  run: async (args) => {
    if (args.sort === "priority") {
      const ownerEmail = getRequestUserEmail();
      const status = ownerEmail ? await getDecisionsStatus(ownerEmail) : null;
      if (
        !status ||
        !status.providers.some((provider) => provider.status === "ready")
      ) {
        fail(
          "Priority sort requires an AI decision provider for this account.",
          {
            errorCode: "jev_not_enabled",
            statusCode: status?.providers.some(
              (provider) => provider.status === "unknown",
            )
              ? 503
              : 403,
          },
        );
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
      !args.sort &&
      args.unread === undefined &&
      args.starred === undefined
    ) {
      fail(
        "At least --view, --tab, --sort, --unread, --starred, --threadId, --queuedDraftId, --composeDraftId, or --settingsSection is required.",
        { errorCode: "missing_navigation_target" },
      );
    }
    if (args.settingsSection || args.view === "settings") {
      // Settings has its own routes, so this opens the URL directly instead
      // of a command only the inbox listens for.
      const pathname = mailSettingsRoute(args.settingsSection ?? "general");
      await writeAppStateForCurrentTab("__set_url__", {
        pathname,
        hash: "",
        searchParams: {},
        mergeSearchParams: false,
        _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      return `Opening ${pathname}`;
    }
    const filtered = args.unread !== undefined || args.starred !== undefined;
    if (filtered && args.view && !viewTakesInboxFilter(args.view)) {
      fail(
        `--unread and --starred filter the inbox or all, not ${args.view}.`,
        { errorCode: "view_has_no_filter" },
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
    if (filtered) {
      nav.view =
        args.view ||
        (args.starred === true && !tab && !args.sort ? "all" : "inbox");
    }
    for (const flag of ["unread", "starred"] as const) {
      const value = args[flag];
      if (value !== undefined) nav[flag] = String(value);
    }
    if (args.sort) {
      nav.view = args.view || "inbox";
      nav.sort = args.sort;
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
    return `Navigating to ${nav.view || ""}${tab ? ` tab:${tab}` : ""}${nav.unread ? ` unread:${nav.unread}` : ""}${nav.starred ? ` starred:${nav.starred}` : ""}${args.sort ? ` sort:${args.sort}` : ""}${args.threadId ? ` thread:${args.threadId}` : ""}${args.queuedDraftId ? ` queued draft:${args.queuedDraftId}` : ""}${args.composeDraftId ? ` compose draft:${args.composeDraftId}` : ""}`;
  },
});
