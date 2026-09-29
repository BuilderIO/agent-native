import { defineAction } from "@agent-native/core/action";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { resolvePinnedLabels } from "../app/lib/inbox-tabs.js";
import { hasGmailScope } from "../server/lib/gmail-scope.js";
import {
  inboxRowToItem,
  readCachedLabels,
  readInboxThreads,
  readInboxPushGeneration,
  readSyncAccounts,
  type SyncAccountRow,
} from "../server/lib/inbox-store.js";
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

const TAB_PREVIEW_LIMIT = 50;

type CachedTabCount = { total: number; unread: number };

function cachedInboxCount(
  accounts: SyncAccountRow[],
  accountEmails: string[],
): CachedTabCount | undefined {
  const selected = new Set(accountEmails.map((email) => email.toLowerCase()));
  if (selected.size === 0) return undefined;
  let total = 0;
  let unread = 0;
  for (const account of accounts) {
    if (!selected.has(account.accountEmail.toLowerCase())) continue;
    selected.delete(account.accountEmail.toLowerCase());
    const inbox = account.labels?.find(
      (label) => label.id.toUpperCase() === "INBOX",
    );
    if (inbox?.threadsTotal == null || inbox.threadsUnread == null)
      return undefined;
    const accountTotal = Number(inbox.threadsTotal);
    const accountUnread = Number(inbox.threadsUnread);
    if (!Number.isFinite(accountTotal) || !Number.isFinite(accountUnread))
      return undefined;
    total += accountTotal;
    unread += accountUnread;
  }
  if (selected.size > 0) return undefined;
  return { total, unread };
}

function paginateIntoResult(
  items: InboxThreadItem[],
  config: InboxTabConfig,
  labelNameById: Map<string, string>,
  labels: Label[],
  page: { tab?: string; limit: number; offset: number; unreadOnly?: boolean },
  syncing: boolean,
  accounts: InboxSyncAccountStatus[],
  backfillIncomplete = false,
  cachedInboxTotal?: CachedTabCount,
): ListInboxThreadsResult {
  const tabs = resolveInboxTabs(config, labelNameById);
  const byTab = partitionInboxItems(items, tabs);
  const activeTabId = resolveActiveTabId(page.tab, tabs);

  const resultTabs: InboxTab[] = tabs.map((tab) => {
    const members = byTab.get(tab.id) ?? [];
    const cachedCount =
      backfillIncomplete && (tab.kind === "inbox" || tab.kind === "all")
        ? cachedInboxTotal
        : undefined;
    return {
      id: tab.id,
      kind: tab.kind,
      name: tab.name,
      query: tab.query,
      total: cachedCount?.total ?? members.length,
      unread:
        cachedCount?.unread ??
        members.filter((item) => item.unreadCount > 0).length,
      ...(backfillIncomplete ? { totalIsLowerBound: true } : {}),
    };
  });

  const activeMembers = byTab.get(activeTabId) ?? [];
  const pageSource = page.unreadOnly
    ? activeMembers.filter((item) => item.unreadCount > 0)
    : activeMembers;
  const pageItems = pageSource.slice(page.offset, page.offset + page.limit);
  const activeTab = resultTabs.find((tab) => tab.id === activeTabId);

  return {
    tabs: resultTabs,
    activeTabId,
    items: pageItems,
    tabPreviews: Object.fromEntries(
      tabs.map((tab) => [
        tab.id,
        (byTab.get(tab.id) ?? []).slice(0, TAB_PREVIEW_LIMIT),
      ]),
    ),
    total: resultTabs.find((tab) => tab.id === activeTabId)?.total ?? 0,
    complete:
      !page.unreadOnly &&
      !activeTab?.totalIsLowerBound &&
      page.offset + pageItems.length >= pageSource.length &&
      pageSource.length >= (activeTab?.total ?? 0),
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

    const [oauthAccounts, managedConnection, syncAccounts] = await Promise.all([
      listOAuthAccountsByOwner("google", ownerEmail),
      resolveWorkspaceConnectionForApp({
        appId: "mail",
        provider: "gmail",
        requireConnected: true,
      }),
      readSyncAccounts(ownerEmail),
    ]);
    const connectedAccounts = [
      ...new Set([
        ...oauthAccounts
          .filter((account) => hasGmailScope(account.tokens))
          .map((account) => account.accountId.toLowerCase()),
        ...(managedConnection.available &&
        managedConnection.connection?.status === "connected" &&
        managedConnection.connection.accountId
          ? [managedConnection.connection.accountId.toLowerCase()]
          : []),
      ]),
    ].filter((accountEmail) =>
      args.accountEmails?.length
        ? args.accountEmails.some(
            (requested) => requested.toLowerCase() === accountEmail,
          )
        : true,
    );
    if (connectedAccounts.length === 0) {
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

    const [settings, rows, { labels, labelMapByAccount }] = await Promise.all([
      readSettings(ownerEmail),
      readInboxThreads(ownerEmail, { accountEmails: connectedAccounts }),
      readCachedLabels(ownerEmail, connectedAccounts),
    ]);
    const items = rows.map((row) =>
      inboxRowToItem(row, labelMapByAccount.get(row.accountEmail)),
    );

    const config: InboxTabConfig = {
      pinnedLabels: resolvePinnedLabels(settings.pinnedLabels, true),
      savedFilters: settings.savedFilters ?? [],
      labelAliases: settings.labelAliases ?? {},
      combineInbox: settings.combineInbox,
      showAllTab: settings.showAllTab,
    };
    const labelNameById = new Map(labels.map((l) => [l.id, l.name]));
    const rowByAccount = new Map(
      syncAccounts.map((account) => [account.accountEmail, account]),
    );
    const statuses = await Promise.all(
      connectedAccounts.map(async (accountEmail) => {
        const row = rowByAccount.get(accountEmail);
        const pushGeneration = await readInboxPushGeneration(
          ownerEmail,
          accountEmail,
        );
        const state =
          row?.status === "needs_reauth" || row?.status === "error"
            ? row.status
            : row?.historyId == null || row?.status === "syncing"
              ? "initial"
              : "ready";
        return {
          accountEmail,
          state,
          lastSyncedAt: row?.lastSyncedAt ?? null,
          ...(row?.lastError ? { error: row.lastError } : {}),
          ...(row?.fullSyncPageToken || row?.fullSyncPhase === "reconcile"
            ? { backfillPending: true }
            : {}),
          ...(pushGeneration > (row?.lastPushGeneration ?? 0)
            ? { pushPending: true }
            : {}),
        } satisfies InboxSyncAccountStatus & { pushPending?: boolean };
      }),
    );
    const backfillIncomplete = statuses.some(
      (status) => status.state === "initial" || status.backfillPending,
    );
    const cachedAllInboxCount = cachedInboxCount(
      syncAccounts,
      connectedAccounts,
    );
    return paginateIntoResult(
      items,
      config,
      labelNameById,
      labels,
      page,
      statuses.some(
        (status) =>
          status.state === "initial" ||
          (status as InboxSyncAccountStatus & { pushPending?: boolean })
            .pushPending,
      ),
      statuses,
      backfillIncomplete,
      cachedAllInboxCount,
    );
  },
});
