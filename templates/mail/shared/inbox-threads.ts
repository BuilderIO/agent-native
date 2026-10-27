import type { GmailReadState } from "./gmail-freshness";
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
  totalIsLowerBound?: boolean;
};

/**
 * `active` — a Gmail push watch was renewed recently, so new mail arrives by
 * push and a steady account only needs an occasional sync poll.
 * `fallback` — no watch, or its renewals lapsed; the account polls on the
 * short cadence so it never goes stale silently.
 */
export type InboxPushWatch = "active" | "fallback";

/**
 * Deepest row offset the inbox list reads. Past it a page would rank every
 * row in the tab, so the list must page by a new cursor instead. Matches the
 * per-account cache cap.
 */
export const INBOX_MAX_PAGE_OFFSET = 2_000;

/**
 * Rows from index `INBOX_MAX_PAGE_OFFSET` on are not readable, so a page must
 * start below it. The last readable page ends at the cap and reports
 * `reachedCap`; the client never requests a page that starts at the cap.
 */
export function isReadableInboxPageOffset(offset: number): boolean {
  return (
    Number.isInteger(offset) && offset >= 0 && offset < INBOX_MAX_PAGE_OFFSET
  );
}

/** The rows a page actually returns: its end is clamped to the cap. */
export function effectiveInboxPageLimit(offset: number, limit: number): number {
  return Math.min(limit, INBOX_MAX_PAGE_OFFSET - offset);
}

/**
 * Sync poll cadence, shared by the server freshness gate and the client
 * poller so a steady account syncs at most once per interval.
 */
export const INBOX_SYNC_POLL_MS = {
  /** First sync, backfill, or pending push/work: keep the fast cadence. */
  pending: 3_000,
  /** Steady account with an active push watch. */
  pushActive: 60_000,
  /** Steady account without a push watch, or with a lapsed one. */
  fallback: 20_000,
} as const;

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
  backfillPending?: boolean;
  /**
   * Some threads keep failing to read from Gmail, so their cached rows may be
   * stale. The sync retries them every step; `kind` is an error class only.
   */
  degraded?: { count: number; kind: string };
  /**
   * The cached inbox stops at the cap while Gmail has more, so counts are lower
   * bounds and the list is not complete.
   */
  reachedCap?: boolean;
  pushWatch?: InboxPushWatch;
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
  tabPreviews: Record<string, InboxThreadItem[]>;
  total: number;
  complete?: boolean;
  /** Older rows exist past this page and can be paged to. */
  hasMore?: boolean;
  /**
   * The page ends at `INBOX_MAX_PAGE_OFFSET` while older rows exist. Paging
   * stops here; older mail is reached through All Mail or search.
   */
  reachedCap?: boolean;
  syncing: boolean;
  accounts: InboxSyncAccountStatus[];
  labels: Label[];
  /**
   * Rows always come from the synced store; this says whether Gmail is
   * cooling down underneath them (`cached`/`stale`) and until when.
   */
  read?: GmailReadState;
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
