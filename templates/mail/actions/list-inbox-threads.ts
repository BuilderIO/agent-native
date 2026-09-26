import { defineAction } from "@agent-native/core/action";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { resolvePinnedLabels } from "../app/lib/inbox-tabs.js";
import {
  getConnectedAccountsWithErrors,
  isConnected,
} from "../server/lib/google-auth.js";
import {
  inboxRowToItem,
  readCachedLabels,
  readInboxThreads,
} from "../server/lib/inbox-store.js";
import { ensureInboxFresh } from "../server/lib/inbox-sync.js";
import {
  buildLocalInboxItems,
  partitionInboxItems,
  resolveActiveTabId,
  resolveInboxTabs,
} from "../server/lib/inbox-tabs-server.js";
import { readLocalEmails } from "../server/lib/local-email-store.js";
import { readSettings } from "../server/lib/mail-settings.js";
import {
  ALL_TAB_ID,
  ALL_TAB_PARAM,
  type InboxSyncAccountStatus,
  type InboxTab,
  type InboxTabConfig,
  type InboxThreadItem,
  type ListInboxThreadsResult,
} from "../shared/inbox-threads.js";
import type { Label } from "../shared/types.js";

const FRESHNESS_MAX_AGE_MS = 15_000;
const SYNC_BUDGET_MS = 6_000;

function paginateIntoResult(
  items: InboxThreadItem[],
  config: InboxTabConfig,
  labelNameById: Map<string, string>,
  labels: Label[],
  page: { tab?: string; limit: number; offset: number; unreadOnly?: boolean },
  syncing: boolean,
  accounts: InboxSyncAccountStatus[],
): ListInboxThreadsResult {
  const tabs = resolveInboxTabs(config, labelNameById);
  const byTab = partitionInboxItems(items, tabs);
  const activeTabId = resolveActiveTabId(page.tab, tabs);

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
  const pageSource = page.unreadOnly
    ? activeMembers.filter((item) => item.unreadCount > 0)
    : activeMembers;
  const pageItems = pageSource.slice(page.offset, page.offset + page.limit);

  return {
    tabs: resultTabs,
    activeTabId,
    items: pageItems,
    total: activeMembers.length,
    complete:
      !page.unreadOnly && page.offset + pageItems.length >= pageSource.length,
    syncing,
    accounts,
    labels,
  };
}

export default defineAction({
  description:
    'Read the human\'s inbox exactly as the UI shows it: the tab bar (All, Important, pinned labels, saved filters, and Other — or one combined Inbox tab when the user has turned on "combine inbox"), each tab\'s total/unread counts, and the active tab\'s rows. All three come from one partition over the synced inbox store, so a tab\'s badge can never disagree with the rows returned for it, and this read is always fast — never a live Gmail call. `tab` accepts any id from the returned `tabs` list (All, a pinned label id, a saved filter id, "important", "other", or "inbox"); an unrecognized or omitted id falls back to the first tab. This is the inbox view specifically; for Sent, Archive, Trash, All Mail, or an ad hoc query, use `list-emails` or `search-emails` instead.',
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
    const requestedTab = typeof args?.tab === "string" ? args.tab : undefined;
    const tab = requestedTab === ALL_TAB_ID ? ALL_TAB_PARAM : requestedTab;
    return {
      url: buildDeepLink({ app: "mail", view: "inbox", params: { tab } }),
      label: "Open inbox in Mail",
      view: "inbox",
    };
  },
  run: async (args): Promise<ListInboxThreadsResult> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const page = {
      tab: args.tab,
      limit: args.limit,
      offset: args.offset,
      unreadOnly: args.unreadOnly,
    };

    const { accounts: connectedAccounts, errors: accountErrors } =
      await getConnectedAccountsWithErrors(ownerEmail);
    if (connectedAccounts.length === 0) {
      if (accountErrors.length > 0) {
        throw new Error(accountErrors.map(({ error }) => error).join("; "));
      }
      const [emails, settings, localSetting] = await Promise.all([
        readLocalEmails(ownerEmail),
        readSettings(ownerEmail),
        getUserSetting(ownerEmail, "labels"),
      ]);
      const labels = Array.isArray((localSetting as any)?.labels)
        ? ((localSetting as any).labels as Label[])
        : [];
      const items = buildLocalInboxItems(emails);
      const config: InboxTabConfig = {
        pinnedLabels: resolvePinnedLabels(settings.pinnedLabels, false),
        savedFilters: settings.savedFilters ?? [],
        labelAliases: settings.labelAliases ?? {},
        combineInbox: settings.combineInbox,
        showAllTab: settings.showAllTab,
      };
      const labelNameById = new Map(labels.map((l) => [l.id, l.name]));
      return paginateIntoResult(
        items,
        config,
        labelNameById,
        labels,
        page,
        false,
        [],
      );
    }

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
      showAllTab: settings.showAllTab,
    };
    const labelNameById = new Map(labels.map((l) => [l.id, l.name]));
    return paginateIntoResult(
      items,
      config,
      labelNameById,
      labels,
      page,
      statuses.some((status) => status.state === "initial"),
      statuses,
    );
  },
});
