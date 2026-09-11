import { defineAction } from "@agent-native/core/action";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { resolvePinnedLabels } from "../app/lib/inbox-tabs.js";
import { isConnected } from "../server/lib/google-auth.js";
import {
  inboxRowToItem,
  readCachedLabels,
  readInboxThreads,
} from "../server/lib/inbox-store.js";
import { ensureInboxFresh } from "../server/lib/inbox-sync.js";
import {
  partitionInboxItems,
  resolveActiveTabId,
  resolveInboxTabs,
} from "../server/lib/inbox-tabs-server.js";
import { readSettings } from "../server/lib/mail-settings.js";
import type {
  InboxTab,
  InboxTabConfig,
  ListInboxThreadsResult,
} from "../shared/inbox-threads.js";

const FRESHNESS_MAX_AGE_MS = 15_000;
const SYNC_BUDGET_MS = 6_000;

export default defineAction({
  description:
    'Read the human\'s inbox exactly as the UI shows it: the tab bar (Important, pinned labels, saved filters, and Other — or one combined Inbox tab when the user has turned on "combine inbox"), each tab\'s total/unread counts, and the active tab\'s rows. All three come from one partition over the synced inbox store, so a tab\'s badge can never disagree with the rows returned for it, and this read is always fast — never a live Gmail call. `tab` accepts any id from the returned `tabs` list (a pinned label id, a saved filter id, "important", "other", or "inbox"); an unrecognized or omitted id falls back to the first tab. This is the inbox view specifically; for Sent, Archive, Trash, All Mail, or an ad hoc query, use `list-emails` or `search-emails` instead.',
  schema: z.object({
    tab: z
      .string()
      .optional()
      .describe(
        "Tab id to read, from a prior result's `tabs` list; defaults to the first tab",
      ),
    accountEmails: z
      .array(z.string().email())
      .optional()
      .describe(
        "Restrict to these connected accounts; defaults to all connected accounts",
      ),
    limit: z.coerce
      .number()
      .min(1)
      .max(200)
      .default(50)
      .describe("Max rows to return, 1-200 (default 50)"),
    offset: z.coerce
      .number()
      .min(0)
      .default(0)
      .describe("Row offset for pagination (default 0)"),
    unreadOnly: z.coerce
      .boolean()
      .optional()
      .describe(
        "Return only unread rows for this page; tab counts are unaffected",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ args }) => {
    const tab = typeof args?.tab === "string" ? args.tab : undefined;
    return {
      url: buildDeepLink({ app: "mail", view: "inbox", params: { tab } }),
      label: "Open inbox in Mail",
      view: "inbox",
    };
  },
  run: async (args): Promise<ListInboxThreadsResult> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    // Keeps the store within the freshness window without ever blocking on a
    // full Gmail listing — a per-account failure surfaces in `accounts`
    // instead of failing this read.
    const statuses = await ensureInboxFresh(ownerEmail, {
      accountEmails: args.accountEmails,
      maxAgeMs: FRESHNESS_MAX_AGE_MS,
      budgetMs: SYNC_BUDGET_MS,
    });

    const googleConnected = await isConnected(ownerEmail);
    const settings = await readSettings(ownerEmail);
    const [rows, { labels, labelMapByAccount }] = await Promise.all([
      readInboxThreads(ownerEmail, { accountEmails: args.accountEmails }),
      readCachedLabels(ownerEmail, args.accountEmails),
    ]);
    const items = rows.map((row) =>
      inboxRowToItem(row, labelMapByAccount.get(row.accountEmail)),
    );

    const config: InboxTabConfig = {
      pinnedLabels: resolvePinnedLabels(settings.pinnedLabels, googleConnected),
      savedFilters: settings.savedFilters ?? [],
      labelAliases: settings.labelAliases ?? {},
      combineInbox: settings.combineInbox,
    };
    const labelNameById = new Map(labels.map((l) => [l.id, l.name]));
    const tabs = resolveInboxTabs(config, labelNameById);
    const byTab = partitionInboxItems(items, tabs);
    const activeTabId = resolveActiveTabId(args.tab, tabs);

    const resultTabs: InboxTab[] = tabs.map((tab) => {
      const members = byTab.get(tab.id) ?? [];
      return {
        id: tab.id,
        kind: tab.kind,
        name: tab.name,
        query: tab.query,
        total: members.length,
        unread: members.filter((item) => item.unreadCount > 0).length,
      };
    });

    const activeMembers = byTab.get(activeTabId) ?? [];
    const pageSource = args.unreadOnly
      ? activeMembers.filter((item) => item.unreadCount > 0)
      : activeMembers;

    return {
      tabs: resultTabs,
      activeTabId,
      items: pageSource.slice(args.offset, args.offset + args.limit),
      total: activeMembers.length,
      syncing: statuses.some((status) => status.state === "initial"),
      accounts: statuses,
      labels,
    };
  },
});
