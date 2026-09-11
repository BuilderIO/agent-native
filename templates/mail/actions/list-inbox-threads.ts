import { defineAction } from "@agent-native/core/action";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { resolvePinnedLabels } from "../app/lib/inbox-tabs.js";
import { isConnected } from "../server/lib/google-auth.js";
import { classifyAutomated } from "../server/lib/inbox-classify.js";
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
import { readLocalEmails } from "../server/lib/local-email-store.js";
import { readSettings } from "../server/lib/mail-settings.js";
import type {
  InboxSyncAccountStatus,
  InboxTab,
  InboxTabConfig,
  InboxThreadItem,
  ListInboxThreadsResult,
} from "../shared/inbox-threads.js";
import type { EmailMessage, Label } from "../shared/types.js";

const FRESHNESS_MAX_AGE_MS = 15_000;
const SYNC_BUDGET_MS = 6_000;

// classifyAutomated expects real Gmail CATEGORY_* label ids; local mail uses
// the app-level lowercase ids from list-labels.ts's SYSTEM_LABELS mapping.
const LOCAL_CATEGORY_TO_GMAIL_LABEL: Record<string, string> = {
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

/** Groups local mailbox messages into one `InboxThreadItem` per thread, latest-first. */
function buildLocalInboxItems(emails: EmailMessage[]): InboxThreadItem[] {
  const byThread = new Map<string, EmailMessage[]>();
  for (const email of emails) {
    if (email.isArchived || email.isTrashed || email.isDraft) continue;
    const key = email.threadId || email.id;
    const list = byThread.get(key);
    if (list) list.push(email);
    else byThread.set(key, [email]);
  }

  const items = [...byThread.values()].map((messages): InboxThreadItem => {
    const latest = messages.reduce((a, b) =>
      new Date(b.date).getTime() > new Date(a.date).getTime() ? b : a,
    );
    const labelIds = [...new Set(messages.flatMap((m) => m.labelIds))];
    const isAutomated = classifyAutomated({
      headers: [],
      labelIds: labelIds.map((l) => LOCAL_CATEGORY_TO_GMAIL_LABEL[l] ?? l),
      fromEmail: latest.from?.email ?? "",
    });
    return {
      ...latest,
      labelIds,
      messageCount: messages.length,
      unreadCount: messages.filter((m) => !m.isRead).length,
      messageIds: messages.map((m) => m.id),
      isAutomated,
    };
  });

  return items.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/** Shared tail: partition into tabs and page the active tab — identical for both backends. */
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

  return {
    tabs: resultTabs,
    activeTabId,
    items: pageSource.slice(page.offset, page.offset + page.limit),
    total: activeMembers.length,
    syncing,
    accounts,
    labels,
  };
}

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

    const page = {
      tab: args.tab,
      limit: args.limit,
      offset: args.offset,
      unreadOnly: args.unreadOnly,
    };

    // No connected Google account: mirror the synthetic local mailbox
    // instead of the synced store (see the mail-backends skill). Same check
    // list-emails.ts and list-labels.ts use to pick this fallback.
    const connectedAccounts = await listOAuthAccountsByOwner(
      "google",
      ownerEmail,
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
