import type { EmailMessage, Label, SavedMailFilter } from "./types";

/**
 * Contract between the synced inbox store (server) and the inbox UI.
 *
 * The inbox is mirrored into SQL (`mail_inbox_threads`) by an incremental
 * Gmail history sync. Tabs, counts and the rendered list are all computed
 * server-side from that one table with one predicate per tab, so a tab's
 * badge can never disagree with the rows it shows and no page load waits on
 * Gmail. Anything outside the inbox (starred, sent, archive, search, All Mail)
 * still goes through the live Gmail list path.
 */

/** Built-in ids are reserved; remaining ids are pinned labels or saved filters. */
export const IMPORTANT_TAB_ID = "important";
export const OTHER_TAB_ID = "other";
/** The unfiltered inbox tab; distinct from a Gmail label or saved-filter id. */
export const ALL_TAB_ID = "__inbox_all__";
export const ALL_TAB_PARAM = ALL_TAB_ID;
/** The whole inbox, no split (used when `combineInbox` is on). */
export const ALL_INBOX_TAB_ID = "inbox";

export type InboxTabKind =
  | "all"
  | "important"
  | "other"
  | "inbox"
  | "label"
  | "filter";

export type InboxTab = {
  id: string;
  kind: InboxTabKind;
  /** Display name; label aliases already applied. */
  name: string;
  /** Gmail-style query for label/filter tabs, shown in the tab tooltip. */
  query?: string;
  total: number;
  unread: number;
};

export type InboxSyncAccountStatus = {
  accountEmail: string;
  /**
   * `initial` — first full sync still running; counts are partial.
   * `ready` — history sync is caught up (within the freshness window).
   * `error` — last sync attempt failed; rows may be stale. `error` is the
   * message.
   * `needs_reauth` — refresh token dead; user must reconnect.
   */
  state: "initial" | "ready" | "error" | "needs_reauth";
  lastSyncedAt: number | null;
  error?: string;
};

export type ListInboxThreadsInput = {
  /** Tab id. Defaults to the first configured tab. */
  tab?: string;
  /** Restrict to these connected accounts (the account filter chips). */
  accountEmails?: string[];
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
};

export type ListInboxThreadsResult = {
  /** Ordered exactly as the tab bar renders them. */
  tabs: InboxTab[];
  activeTabId: string;
  /**
   * One `EmailMessage` per thread — the thread's latest non-draft message,
   * with `labelIds` being the union across the thread and thread-level
   * `messageCount` / `unreadCount` populated. Sorted newest first.
   */
  items: InboxThreadItem[];
  total: number;
  /** True when this page, or the loaded offset range, covers the full tab. */
  complete?: boolean;
  /** True while any selected account is still in its initial full sync. */
  syncing: boolean;
  accounts: InboxSyncAccountStatus[];
  /** Labels for the selected accounts, from the sync cache (never throws). */
  labels: Label[];
};

export type InboxThreadItem = EmailMessage & {
  messageCount: number;
  unreadCount: number;
  /** Every Gmail message id in the thread, for batchModify. */
  messageIds: string[];
  /** Superhuman-style classification of the latest received message. */
  isAutomated: boolean;
};

/**
 * Tab configuration as stored in `mail-settings`. Pinned labels become
 * `label:` tabs and saved filters become query tabs; Important and Other are
 * the remainder tabs. All is inclusive, so each inbox thread appears there
 * while keeping its existing label/filter/Important/Other membership.
 */
export type InboxTabConfig = {
  pinnedLabels: string[];
  savedFilters: SavedMailFilter[];
  labelAliases: Record<string, string>;
  combineInbox: boolean;
  showAllTab?: boolean;
};

export function inboxTabHref(tabId: string): string {
  const param = tabId === ALL_TAB_ID ? ALL_TAB_PARAM : tabId;
  return `/inbox?tab=${encodeURIComponent(param)}`;
}
