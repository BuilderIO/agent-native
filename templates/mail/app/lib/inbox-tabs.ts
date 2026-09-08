import { mailLabelsInclude, mailLabelsIncludeAny } from "@shared/gmail-labels";
import { emailMessageMatchesSearch } from "@shared/search";
import { isSelfAddressedThread } from "@shared/self-notes";
import type { EmailMessage } from "@shared/types";

/**
 * Single source of truth for partitioning the loaded inbox into the top-bar
 * tabs (Important / pinned triage labels / "Other").
 *
 * The badge counts (AppLayout) and the rendered list (InboxPage) BOTH go
 * through these helpers so a tab's number can never disagree with the emails
 * it shows. Before this existed, the badge sliced the loaded inbox query
 * client-side while the list fired a separate Gmail `label:` search with a
 * different membership rule, so e.g. a tab could read "7" yet list nothing.
 */

/** System views that render as their own collapsible sections, not triage
 * tabs that partition inbox mail. */
export const COLLAPSIBLE_VIEW_IDS = [
  "unread",
  "starred",
  "sent",
  "drafts",
  "archive",
  "trash",
] as const;

// Keep the synthetic remainder tab's UI identity separate from user-label IDs.
// Its public URL remains `tab=other` for existing links and agent commands.
export const OTHER_INBOX_TAB_ID = "__inbox_other__";
export const OTHER_INBOX_TAB_PARAM = "other";

export function inboxThreadKey(
  email: Pick<EmailMessage, "accountEmail" | "threadId" | "id">,
): string {
  return `${email.accountEmail?.trim().toLowerCase() ?? ""}:${email.threadId || email.id}`;
}

/** Use the default Important tab only before the user has saved pin choices. */
export function resolvePinnedLabels(
  userPinnedLabels: readonly string[] | undefined,
  isGoogleConnected: boolean,
): string[] {
  if (userPinnedLabels === undefined) {
    return isGoogleConnected ? ["important"] : [];
  }
  return [...userPinnedLabels];
}

/** Pinned labels that act as inbox triage tabs (drop system views). */
export function pinnedTriageLabels(pinnedLabels: readonly string[]): string[] {
  return pinnedLabels.filter(
    (id) => !(COLLAPSIBLE_VIEW_IDS as readonly string[]).includes(id),
  );
}

/**
 * Self-addressed threads get a virtual "note-to-self" label when that tab is
 * pinned. Other self-sent mail still gets virtual "important" so it lands in
 * the matching triage tab. Both the count and the list apply this so they
 * agree on self-authored threads.
 */
export function augmentSelfSentLabels(
  emails: EmailMessage[],
  opts: {
    isGoogleConnected: boolean;
    connectedEmails: Set<string>;
    hasNoteToSelf: boolean;
  },
): EmailMessage[] {
  if (!opts.isGoogleConnected) return emails;

  const selfNoteThreads = new Set<string>();
  if (opts.hasNoteToSelf) {
    const threads = new Map<string, EmailMessage[]>();
    for (const e of emails) {
      const key = inboxThreadKey(e);
      const thread = threads.get(key) ?? [];
      thread.push(e);
      threads.set(key, thread);
    }
    for (const [key, thread] of threads) {
      if (isSelfAddressedThread(thread, opts.connectedEmails)) {
        selfNoteThreads.add(key);
      }
    }
  }

  return emails.map((e) => {
    const key = inboxThreadKey(e);
    const isSelfSent = opts.connectedEmails.has(e.from.email.toLowerCase());
    const virtualLabel = opts.hasNoteToSelf
      ? selfNoteThreads.has(key)
        ? "note-to-self"
        : isSelfSent
          ? "important"
          : null
      : isSelfSent
        ? "important"
        : null;
    if (!virtualLabel) return e;
    if (e.labelIds.includes(virtualLabel)) return e;
    let labelIds = [...e.labelIds];
    if (virtualLabel === "note-to-self") {
      labelIds = labelIds.filter((l) => l !== "important");
    }
    if (!labelIds.includes(virtualLabel)) labelIds.push(virtualLabel);
    return { ...e, labelIds };
  });
}

/**
 * Does a thread (represented by its latest message's labels) belong to the
 * given top-bar tab?
 *
 * - `tab === null` → the "Other" remainder: latest message carries none of the
 *   pinned triage labels.
 * - otherwise → latest message carries `tab`. "important" is exclusive: a
 *   thread that also matches another pinned tab belongs to that tab instead.
 */
export function qualifiesForInboxTab(
  latestLabelIds: readonly string[],
  tab: string | null,
  triageLabels: readonly string[],
): boolean {
  if (tab === null) {
    return !mailLabelsIncludeAny(latestLabelIds, triageLabels);
  }
  if (!mailLabelsInclude(latestLabelIds, tab)) return false;
  if (tab === "important") {
    const others = triageLabels.filter((l) => l !== "important");
    if (mailLabelsIncludeAny(latestLabelIds, others)) return false;
  }
  return true;
}

/** Latest message per thread, by date. */
function latestByThread(emails: EmailMessage[]): Map<string, EmailMessage> {
  const map = new Map<string, EmailMessage>();
  for (const e of emails) {
    const key = inboxThreadKey(e);
    const existing = map.get(key);
    if (!existing || new Date(e.date) > new Date(existing.date)) {
      map.set(key, e);
    }
  }
  return map;
}

/** Threads claimed by saved query tabs, with Gmail's thread-level membership. */
export function savedFilterThreadIds(
  emails: EmailMessage[],
  savedFilterQueries: readonly string[] = [],
): Set<string> {
  const queries = savedFilterQueries
    .map((query) => query.trim())
    .filter(Boolean);
  const matched = new Set<string>();
  for (const email of emails) {
    if (queries.some((query) => emailMessageMatchesSearch(email, query))) {
      matched.add(inboxThreadKey(email));
    }
  }
  return matched;
}

/**
 * Filter a flat inbox message list down to the messages of every thread that
 * belongs to `tab` (or the "Other" remainder when `tab` is null). Returns all
 * messages of qualifying threads so thread grouping/detail stays intact.
 *
 * This is the list-side counterpart of {@link qualifiesForInboxTab} — the same
 * latest-message rule the badge counts use.
 */
export function filterInboxTabEmails(
  emails: EmailMessage[],
  tab: string | null,
  pinnedLabels: readonly string[],
  savedFilterQueries: readonly string[] = [],
): EmailMessage[] {
  const triage = pinnedTriageLabels(pinnedLabels);
  const latest = latestByThread(emails);
  const savedFilterThreads = savedFilterThreadIds(emails, savedFilterQueries);
  const qualified = new Set<string>();
  for (const [key, latestMsg] of latest) {
    if (
      !savedFilterThreads.has(key) &&
      qualifiesForInboxTab(latestMsg.labelIds, tab, triage)
    ) {
      qualified.add(key);
    }
  }
  return emails.filter((e) => qualified.has(inboxThreadKey(e)));
}
