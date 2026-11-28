import { defineAction, fail } from "@agent-native/core/action";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { resolvePinnedLabels } from "../app/lib/inbox-tabs.js";
import { readGmailCooldown } from "../server/lib/gmail-quota.js";
import { hasGmailScope } from "../server/lib/gmail-scope.js";
import { statusFromRow } from "../server/lib/inbox-status.js";
import {
  inboxRowToItem,
  readCachedLabels,
  readInboxTabWindows,
  readInboxThreads,
  readInboxPushGeneration,
  readSyncAccounts,
  type InboxTabWindows,
  type InboxThreadRow,
} from "../server/lib/inbox-store.js";
import {
  buildLocalInboxItems,
  partitionInboxItems,
  resolveInboxTabs,
  resolvePageTabs,
  type ResolvedInboxTab,
} from "../server/lib/inbox-tabs-server.js";
import { readLocalEmails } from "../server/lib/local-email-store.js";
import { readSettings } from "../server/lib/mail-settings.js";
import { gmailReadState } from "../shared/gmail-freshness.js";
import {
  inboxFilterAccepts,
  inboxFilterIsReadable,
  inboxFilterParam,
  type InboxFilterFlags,
} from "../shared/inbox-filters.js";
import {
  ALL_TAB_ID,
  ALL_TAB_PARAM,
  effectiveInboxPageLimit,
  INBOX_MAX_PAGE_OFFSET,
  type InboxSyncAccountStatus,
  type InboxTab,
  type InboxTabConfig,
  type InboxTabKind,
  type InboxThreadItem,
  type ListInboxThreadsResult,
} from "../shared/inbox-threads.js";
import type { Label } from "../shared/types.js";

const TAB_PREVIEW_LIMIT = 50;

type PageAccepts = (flags: InboxFilterFlags) => boolean;

type InboxPageRequest = {
  tab?: string | undefined;
  limit: number;
  offset: number;
  accepts?: PageAccepts | undefined;
  inboxFiltered: boolean;
};

const SQL_TAB_KINDS: ReadonlySet<InboxTabKind> = new Set([
  "all",
  "inbox",
  "important",
  "other",
]);

type CachedTabCount = { total: number; unread: number };

type InboxResultWindow = {
  tabs: ResolvedInboxTab[];
  shownTabs: ResolvedInboxTab[];
  activeTabId: string;
  counts: Map<string, CachedTabCount>;
  previews: Map<string, InboxThreadItem[]>;
  pageItems: InboxThreadItem[];
  activePoolLength: number;
  offset: number;
  limit: number;
  filtered: boolean;
  labels: Label[];
  syncing: boolean;
  accounts: InboxSyncAccountStatus[];
  backfillIncomplete: boolean;
  hasLegacyClassification: boolean;
  // The sync stopped at the cap while Gmail has more: the visible pool is a
  // lower bound even when nothing is syncing.
  syncCapped?: boolean;
};

function buildInboxResult(window: InboxResultWindow): ListInboxThreadsResult {
  // A page ending at the cap with older rows behind it is a boundary the
  // client must not page past; the older rows are not reachable through the list.
  const seen = window.offset + window.pageItems.length;
  const olderRows = window.activePoolLength > seen;
  const reachedCap =
    (olderRows && window.offset + window.limit >= INBOX_MAX_PAGE_OFFSET) ||
    (Boolean(window.syncCapped) && !olderRows);
  const shownTabIds = new Set(window.shownTabs.map((tab) => tab.id));
  const resultTabs: InboxTab[] = window.tabs.map((tab) => {
    const count = window.counts.get(tab.id) ?? { total: 0, unread: 0 };
    return {
      id: tab.id,
      kind: tab.kind,
      name: tab.name,
      query: tab.query,
      total: count.total,
      unread: count.unread,
      ...(window.backfillIncomplete ? { totalIsLowerBound: true } : {}),
    };
  });
  const activeTab = resultTabs.find((tab) => tab.id === window.activeTabId);

  return {
    tabs: resultTabs.filter((tab) => shownTabIds.has(tab.id)),
    activeTabId: window.activeTabId,
    items: window.pageItems,
    tabPreviews: Object.fromEntries(
      window.shownTabs.map((tab) => [
        tab.id,
        window.previews.get(tab.id) ?? [],
      ]),
    ),
    total: activeTab?.total ?? 0,
    complete:
      !window.filtered &&
      !activeTab?.totalIsLowerBound &&
      window.offset + window.pageItems.length >= window.activePoolLength &&
      window.activePoolLength >= (activeTab?.total ?? 0),
    hasMore: olderRows && !reachedCap,
    hasLegacyClassification: window.hasLegacyClassification,
    reachedCap,
    syncing: window.syncing,
    accounts: window.accounts,
    labels: window.labels,
  };
}

function buildWindowedResult(
  windows: InboxTabWindows,
  input: {
    tabs: ResolvedInboxTab[];
    shownTabs: ResolvedInboxTab[];
    activeTabId: string;
    page: InboxPageRequest;
    labels: Label[];
    syncing: boolean;
    accounts: InboxSyncAccountStatus[];
    backfillIncomplete: boolean;
    syncCapped?: boolean;
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
    shownTabs: input.shownTabs,
    activeTabId: input.activeTabId,
    counts: windows.counts,
    previews: new Map(
      [...windows.previews].map(([tabId, rows]) => [
        tabId,
        rows.map(input.rowToItem),
      ]),
    ),
    pageItems: windows.page.map(input.rowToItem),
    activePoolLength: windows.pageTotal,
    offset: input.page.offset,
    limit: input.page.limit,
    filtered: input.page.accepts !== undefined,
    labels: input.labels,
    syncing: input.syncing,
    accounts: input.accounts,
    backfillIncomplete: input.backfillIncomplete || windows.hasUnclassified,
    hasLegacyClassification: windows.hasLegacyClassification,
    syncCapped: input.syncCapped,
  });
}

/** Tabs with a pinned-label or saved-filter query need every row to partition. */
function paginateIntoResult(
  items: InboxThreadItem[],
  config: InboxTabConfig,
  labelNameById: Map<string, string>,
  labels: Label[],
  page: InboxPageRequest,
  syncing: boolean,
  accounts: InboxSyncAccountStatus[],
  backfillIncomplete = false,
  syncCapped = false,
): ListInboxThreadsResult {
  const shownTabs = resolveInboxTabs(config, labelNameById);
  const { pageTabs: tabs, activeTabId } = resolvePageTabs(
    shownTabs,
    page.tab,
    page.inboxFiltered,
  );
  const byTab = partitionInboxItems(items, tabs);
  const activeMembers = byTab.get(activeTabId) ?? [];
  const accepts = page.accepts;
  const pageSource = accepts
    ? activeMembers.filter((item) =>
        accepts({ unread: item.unreadCount > 0, starred: item.isStarred }),
      )
    : activeMembers;

  return buildInboxResult({
    tabs,
    shownTabs,
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
    limit: page.limit,
    filtered: accepts !== undefined,
    labels,
    syncing,
    accounts,
    backfillIncomplete:
      backfillIncomplete || items.some((item) => item.isAutomated === null),
    hasLegacyClassification: items.some(
      (item) => item.classificationNeedsRefresh === true,
    ),
    syncCapped,
  });
}

export default defineAction({
  description:
    'Read the human\'s inbox exactly as the UI shows it: the tab bar (All, Important, pinned labels, saved filters, and Other — or one combined Inbox tab when the user has turned on "combine inbox"), each tab\'s total/unread counts, and the active tab\'s rows. All three come from one partition over the synced inbox store, and this read is always fast — never a live Gmail call. Tab badges always count the whole tab; `unreadOnly` and `inboxFilter` narrow the returned rows, never the counts. `tab` accepts any id from the returned `tabs` list (All, a pinned label id, a saved filter id, "important", "other", or "inbox"); an unrecognized or omitted id falls back to the first tab, except that an `inboxFilter` read with no tab covers the whole inbox even when the All tab is hidden. This is the inbox view specifically; for Sent, Archive, Trash, All Mail, or an ad hoc query, use `list-emails` or `search-emails` instead.',
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
      .int()
      .min(0)
      .max(INBOX_MAX_PAGE_OFFSET - 1)
      .default(0)
      .describe(
        `Row offset for pagination (default 0; a page must start below ${INBOX_MAX_PAGE_OFFSET})`,
      ),
    unreadOnly: z.coerce
      .boolean()
      .optional()
      .describe(
        "Return only unread rows for this page; tab counts are unaffected",
      ),
    inboxFilter: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe(
        'The inbox Filter menu\'s rules in their URL form, as `navigation.inboxFilter` reports them: "r=unread:is_checked" (unread), "r=starred:is_checked" (starred), "r=unread:is_unchecked" (read), several `r=` joined with "&" for all of them, plus "match=any" for any of them. Narrows the page like unreadOnly; tab counts are unaffected',
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ args }) => {
    const requestedTab = typeof args?.tab === "string" ? args.tab : undefined;
    const tab = requestedTab === ALL_TAB_ID ? ALL_TAB_PARAM : requestedTab;
    const inboxFilter =
      typeof args.inboxFilter === "string"
        ? inboxFilterParam(args.inboxFilter) || undefined
        : undefined;
    return {
      url: buildDeepLink({
        app: "mail",
        view: "inbox",
        params: { tab, inboxFilter },
      }),
      label: "Open inbox in Mail",
      view: "inbox",
    };
  },
  mcpTool: "search",
  run: async (args): Promise<ListInboxThreadsResult> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const filterAccepts = args.inboxFilter
      ? inboxFilterAccepts(args.inboxFilter)
      : null;
    if (
      args.inboxFilter &&
      (!filterAccepts || !inboxFilterIsReadable(args.inboxFilter))
    ) {
      fail(
        `inboxFilter "${args.inboxFilter}" holds a rule the inbox cannot read; use r=unread:is_checked, r=starred:is_checked, or their is_unchecked forms.`,
        { errorCode: "invalid_inbox_filter" },
      );
    }
    const page: InboxPageRequest = {
      tab: args.tab,
      limit: effectiveInboxPageLimit(args.offset, args.limit),
      offset: args.offset,
      inboxFiltered: filterAccepts !== null,
      accepts:
        args.unreadOnly || filterAccepts
          ? (flags) =>
              (!args.unreadOnly || flags.unread) &&
              (!filterAccepts || filterAccepts(flags))
          : undefined,
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
      const items = buildLocalInboxItems(emails, ownerEmail);
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
    const shownTabs = resolveInboxTabs(config, labelNameById);
    const { pageTabs: tabs, activeTabId } = resolvePageTabs(
      shownTabs,
      page.tab,
      page.inboxFiltered,
    );
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
            pageTabId: activeTabId,
            pageOffset: page.offset,
            pageLimit: page.limit,
            pageAccepts: page.accepts,
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
        const base: InboxSyncAccountStatus = row
          ? statusFromRow(row)
          : {
              accountEmail,
              state: "initial",
              lastSyncedAt: null,
              pushWatch: "fallback",
            };
        return {
          ...base,
          accountEmail,
          ...(row?.lastError ? { error: row.lastError } : {}),
          ...(pushGeneration > (row?.lastPushGeneration ?? 0)
            ? { pushPending: true }
            : {}),
        } satisfies InboxSyncAccountStatus & { pushPending?: boolean };
      }),
    );
    // A capped account holds only the newest slice of Gmail's inbox, so its
    // totals are lower bounds even when nothing is syncing.
    const syncCapped = statuses.some((status) => status.reachedCap);
    // Failing ids (due or waiting out a backoff) and unreadable stored state
    // mean some threads may be stale or missing, so the list is not complete.
    const backfillIncomplete =
      syncCapped ||
      statuses.some(
        (status) =>
          status.state === "initial" ||
          status.backfillPending ||
          status.degraded,
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
            shownTabs,
            activeTabId,
            page,
            labels,
            syncing,
            accounts: statuses,
            backfillIncomplete,
            syncCapped,
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
            syncCapped,
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
