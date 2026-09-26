import type { EmailMessage, Label, SavedMailFilter } from "./types";

export const IMPORTANT_TAB_ID = "important";
export const OTHER_TAB_ID = "other";
export const ALL_TAB_ID = "__inbox_all__";
export const ALL_TAB_PARAM = ALL_TAB_ID;
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
  name: string;
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
  tab?: string;
  accountEmails?: string[];
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
};

export type ListInboxThreadsResult = {
  tabs: InboxTab[];
  activeTabId: string;
  items: InboxThreadItem[];
  total: number;
  complete?: boolean;
  syncing: boolean;
  accounts: InboxSyncAccountStatus[];
  labels: Label[];
};

export type InboxThreadItem = EmailMessage & {
  messageCount: number;
  unreadCount: number;
  messageIds: string[];
  isAutomated: boolean;
};

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
