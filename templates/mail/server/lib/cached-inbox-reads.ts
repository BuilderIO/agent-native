import { mailLabelMatches } from "@shared/gmail-labels.js";
import type { EmailMessage } from "@shared/types.js";

import { filterInboxScopedThreadMessages } from "./gmail-query.js";
import {
  inboxRowToItem,
  readCachedLabels,
  readInboxThreads,
  readSyncAccounts,
} from "./inbox-store.js";
import { getSnoozedThreadIds } from "./jobs.js";

/** Views the synced inbox store holds in full: threads currently in INBOX. */
const CACHEABLE_VIEWS = new Set(["inbox", "unread"]);

export interface CachedInboxRead {
  /** First page only: later pages need a live Gmail cursor. */
  emails: EmailMessage[];
  totalEstimate: number;
  /** Oldest last-sync time across the accounts the rows came from. */
  syncedAt: number;
}

export function canServeFromInboxStore(params: {
  view: string;
  q?: string;
  label?: string;
}): boolean {
  return (
    CACHEABLE_VIEWS.has(params.view) &&
    !params.q &&
    // Derived from sender/recipient, not from a stored label.
    params.label?.toLowerCase() !== "note-to-self"
  );
}

/**
 * Serves an inbox-scoped view from the synced inbox store, the same rows the
 * inbox tabs read. Returns null, never an empty page, when the store cannot
 * stand in for Gmail: an unsupported view/query, or an account that has not
 * finished its first sync (its rows are absent, not empty).
 */
export async function readCachedInboxEmails(params: {
  ownerEmail: string;
  view: string;
  label?: string;
  q?: string;
  accountEmails: readonly string[];
  limit: number;
}): Promise<CachedInboxRead | null> {
  const { ownerEmail, view, label, limit } = params;
  if (!canServeFromInboxStore({ view, q: params.q, label })) return null;
  const accountEmails = params.accountEmails.map((email) =>
    email.toLowerCase(),
  );
  if (accountEmails.length === 0) return null;

  const [syncAccounts, rows, { labelMapByAccount }] = await Promise.all([
    readSyncAccounts(ownerEmail),
    readInboxThreads(ownerEmail, { accountEmails }),
    readCachedLabels(ownerEmail, accountEmails),
  ]);
  const syncByAccount = new Map(
    syncAccounts.map((account) => [account.accountEmail, account]),
  );
  let syncedAt = Number.POSITIVE_INFINITY;
  for (const accountEmail of accountEmails) {
    const sync = syncByAccount.get(accountEmail);
    if (!sync || sync.historyId == null || sync.lastSyncedAt == null) {
      return null;
    }
    syncedAt = Math.min(syncedAt, sync.lastSyncedAt);
  }

  let emails: EmailMessage[] = rows
    .filter((row) => view !== "unread" || row.isUnread)
    .map((row) => inboxRowToItem(row, labelMapByAccount.get(row.accountEmail)));
  if (label) {
    emails = filterInboxScopedThreadMessages(
      emails.filter((email) =>
        email.labelIds.some((labelId) => mailLabelMatches(labelId, label)),
      ),
      view,
      label,
      new Set(accountEmails),
    );
  }
  const snoozedIds = await getSnoozedThreadIds(ownerEmail);
  if (snoozedIds.size > 0) {
    emails = emails.filter(
      (email) => !snoozedIds.has(email.threadId) && !snoozedIds.has(email.id),
    );
  }

  return {
    emails: emails.slice(0, limit),
    totalEstimate: emails.length,
    syncedAt,
  };
}
