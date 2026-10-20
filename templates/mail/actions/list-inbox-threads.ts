import { defineAction } from "@agent-native/core/action";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { resolvePinnedLabels } from "../app/lib/inbox-tabs.js";
import { readGmailCooldown } from "../server/lib/gmail-quota.js";
import { hasGmailScope } from "../server/lib/gmail-scope.js";
import {
  aiImportantLabelIds,
  inboxRowToItem,
  readCachedLabels,
  readInboxTabWindows,
  readInboxThreads,
  readInboxPushGeneration,
  readSyncAccounts,
  type InboxTabWindows,
  type InboxThreadRow,
  type SyncAccountRow,
} from "../server/lib/inbox-store.js";
import {
  buildLocalInboxItems,
  partitionInboxItems,
  resolveActiveTabId,
  resolveInboxTabs,
  type ResolvedInboxTab,
} from "../server/lib/inbox-tabs-server.js";
import { readLocalEmails } from "../server/lib/local-email-store.js";
import { readSettings } from "../server/lib/mail-settings.js";
import { gmailReadState } from "../shared/gmail-freshness.js";
import {
  ALL_TAB_ID,
  ALL_TAB_PARAM,
  type InboxSyncAccountStatus,
  type InboxTab,
  type InboxTabConfig,
  type InboxTabKind,
  type InboxThreadItem,
  type ListInboxThreadsResult,
} from "../shared/inbox-threads.js";
import type { Label } from "../shared/types.js";

const TAB_PREVIEW_LIMIT = 50;
const SQL_TAB_KINDS: ReadonlySet<InboxTabKind> = new Set([
  "all",
  "inbox",
  "important",
  "other",
]);

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

type InboxResultWindow = {
  tabs: ResolvedInboxTab[];
  activeTabId: string;
  counts: Map<string, CachedTabCount>;
  previews: Map<string, InboxThreadItem[]>;
  pageItems: InboxThreadItem[];
  /** Rows the active tab's page is cut from: unread-only when requested. */
  activePoolLength: number;
  offset: number;
  unreadOnly?: boolean;
  labels: Label[];
  syncing: boolean;
  accounts: InboxSyncAccountStatus[];
  backfillIncomplete: boolean;
  cachedInboxTotal?: CachedTabCount;
};

function buildInboxResult(window: InboxResultWindow): ListInboxThreadsResult {
  const resultTabs: InboxTab[] = window.tabs.map((tab) => {
    const count = window.counts.get(tab.id) ?? { total: 0, unread: 0 };
    const cachedCount =
      window.backfillIncomplete && (tab.kind === "inbox" || tab.kind === "all")
        ? window.cachedInboxTotal
        : undefined;
    return {
      id: tab.id,
      kind: tab.kind,
      name: tab.name,
      query: tab.query,
      total: cachedCount?.total ?? count.total,
      unread: cachedCount?.unread ?? count.unread,
      ...(window.backfillIncomplete ? { totalIsLowerBound: true } : {}),
    };
  });
  const activeTab = resultTabs.find((tab) => tab.id === window.activeTabId);

  return {
    tabs: resultTabs,
    activeTabId: window.activeTabId,
    items: window.pageItems,
    tabPreviews: Object.fromEntries(
      window.tabs.map((tab) => [tab.id, window.previews.get(tab.id) ?? []]),
    ),
    total: activeTab?.total ?? 0,
    complete:
      !window.unreadOnly &&
      !activeTab?.totalIsLowerBound &&
      window.offset + window.pageItems.length >= window.activePoolLength &&
      window.activePoolLength >= (activeTab?.total ?? 0),
    syncing: window.syncing,
    accounts: window.accounts,
    labels: window.labels,
  };
}

function buildWindowedResult(
  windows: InboxTabWindows,
  input: {
    tabs: ResolvedInboxTab[];
    activeTabId: string;
    page: { offset: number; unreadOnly?: boolean };
    labels: Label[];
    syncing: boolean;
    accounts: InboxSyncAccountStatus[];
    backfillIncomplete: boolean;
    cachedInboxTotal?: CachedTabCount;
    rowToItem: (row: InboxThreadRow) => InboxThreadItem;
  },
): ListInboxThreadsResult {
  const activeCount = windows.counts.get(input.activeTabId);
  if (!activeCount) {
    // guard:allow-bare-error — invariant: the active tab is always one of the tabs the windows were read for
    throw new Error(`inbox windows missing counts for "${input.activeTabId}"`);
  }
  return buildInboxResult({
    tabs: input.tabs,
    activeTabId: input.activeTabId,
    counts: windows.counts,
    previews: new Map(
      [...windows.previews].map(([tabId, rows]) => [
        tabId,
        rows.map(input.rowToItem),
      ]),
    ),
    pageItems: windows.page.map(input.rowToItem),
    activePoolLength: input.page.unreadOnly
      ? activeCount.unread
      : activeCount.total,
    offset: input.page.offset,
    unreadOnly: input.page.unreadOnly,
    labels: input.labels,
    syncing: input.syncing,
    accounts: input.accounts,
    backfillIncomplete: input.backfillIncomplete,
    cachedInboxTotal: input.cachedInboxTotal,
  });
}

/** Tabs with a pinned-label or saved-filter query need every row to partition. */
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
  const activeMembers = byTab.get(activeTabId) ?? [];
  const pageSource = page.unreadOnly
    ? activeMembers.filter((item) => item.unreadCount > 0)
    : activeMembers;

  return buildInboxResult({
    tabs,
    activeTabId,
    counts: new Map(
      tabs.map((tab) => {
        const members = byTab.get(tab.id) ?? [];
        return [
          tab.id,
          {
            total: members.length,
            unread: members.filter((item) => item.unreadCount > 0).length,
          },
        ];
      }),
    ),
    previews: new Map(
      tabs.map((tab) => [
        tab.id,
        (byTab.get(tab.id) ?? []).slice(0, TAB_PREVIEW_LIMIT),
      ]),
    ),
    pageItems: pageSource.slice(page.offset, page.offset + page.limit),
    activePoolLength: pageSource.length,
    offset: page.offset,
    unreadOnly: page.unreadOnly,
    labels,
    syncing,
    accounts,
    backfillIncomplete,
    cachedInboxTotal,
  });
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

    const [settings, { labels, labelMapByAccount }] = await Promise.all([
      readSettings(ownerEmail),
      readCachedLabels(ownerEmail, connectedAccounts),
    ]);
    const rowToItem = (row: InboxThreadRow) =>
      inboxRowToItem(row, labelMapByAccount.get(row.accountEmail));

    const config: InboxTabConfig = {
      pinnedLabels: resolvePinnedLabels(settings.pinnedLabels, true),
      savedFilters: settings.savedFilters ?? [],
      labelAliases: settings.labelAliases ?? {},
      combineInbox: settings.combineInbox,
      showAllTab: settings.showAllTab,
    };
    const labelNameById = new Map(labels.map((l) => [l.id, l.name]));
    const tabs = resolveInboxTabs(config, labelNameById);
    const activeTabId = resolveActiveTabId(page.tab, tabs);
    // Built-in tabs are SQL-expressible; a pinned label or saved filter is not,
    // so those accounts fall back to reading every row.
    const sqlTabs = tabs.every((tab) => SQL_TAB_KINDS.has(tab.kind));
    const rowSource = sqlTabs
      ? {
          kind: "windows" as const,
          windows: await readInboxTabWindows({
            ownerEmail,
            accountEmails: connectedAccounts,
            tabs,
            aiLabelIdsByAccount: new Map(
              connectedAccounts.map((accountEmail) => [
                accountEmail,
                aiImportantLabelIds(labelMapByAccount.get(accountEmail)),
              ]),
            ),
            pageTabId: activeTabId,
            pageOffset: page.offset,
            pageLimit: page.limit,
            pageUnreadOnly: page.unreadOnly === true,
            previewLimit: TAB_PREVIEW_LIMIT,
          }),
        }
      : {
          kind: "rows" as const,
          rows: await readInboxThreads(ownerEmail, {
            accountEmails: connectedAccounts,
          }),
        };
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
    const now = Date.now();
    const cooldown = await readGmailCooldown(connectedAccounts, now);
    const syncedTimes = statuses.map((status) => status.lastSyncedAt);
    const syncing = statuses.some(
      (status) =>
        status.state === "initial" ||
        (status as InboxSyncAccountStatus & { pushPending?: boolean })
          .pushPending,
    );
    const result =
      rowSource.kind === "windows"
        ? buildWindowedResult(rowSource.windows, {
            tabs,
            activeTabId,
            page,
            labels,
            syncing,
            accounts: statuses,
            backfillIncomplete,
            cachedInboxTotal: cachedAllInboxCount,
            rowToItem,
          })
        : paginateIntoResult(
            rowSource.rows.map(rowToItem),
            config,
            labelNameById,
            labels,
            page,
            syncing,
            statuses,
            backfillIncomplete,
            cachedAllInboxCount,
          );
    return {
      ...result,
      read: gmailReadState(
        cooldown,
        syncedTimes.some((time) => time == null)
          ? null
          : Math.min(...(syncedTimes as number[])),
        now,
      ),
    };
  },
});
