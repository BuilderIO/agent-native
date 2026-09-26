import { AI_IMPORTANT_LABEL } from "@shared/ai-priority";
import {
  isInboxScopedAppLabel,
  mailLabelsInclude,
  mailLabelsIncludeAny,
} from "@shared/gmail-labels";
import { ALL_TAB_PARAM } from "@shared/inbox-threads";
import { emailMessageMatchesSearch } from "@shared/search";
import { isSelfAddressedThread } from "@shared/self-notes";
import type { EmailMessage, SavedMailFilter } from "@shared/types";


export const COLLAPSIBLE_VIEW_IDS = [
  "unread",
  "starred",
  "sent",
  "drafts",
  "archive",
  "trash",
] as const;

export const OTHER_INBOX_TAB_ID = "__inbox_other__";
export const OTHER_INBOX_TAB_PARAM = "other";

export function inboxThreadKey(
  email: Pick<EmailMessage, "accountEmail" | "threadId" | "id">,
): string {
  return `${email.accountEmail?.trim().toLowerCase() ?? ""}:${email.threadId || email.id}`;
}

export function resolvePinnedLabels(
  userPinnedLabels: readonly string[] | undefined,
  isGoogleConnected: boolean,
): string[] {
  if (userPinnedLabels === undefined) {
    return isGoogleConnected ? ["important"] : [];
  }
  return [...userPinnedLabels];
}

export function labelTabHref(labelId: string): string {
  const view = isInboxScopedAppLabel(labelId) ? "inbox" : "all";
  return `/${view}?label=${encodeURIComponent(labelId)}`;
}

export function resolveDefaultMailHref(opts: {
  combineInbox?: boolean;
  showAllTab?: boolean;
  pinnedLabels?: readonly string[];
  isGoogleConnected?: boolean;
  savedFilters?: readonly Pick<SavedMailFilter, "id">[];
}): string {
  if (opts.combineInbox) return "/inbox";
  if (opts.showAllTab !== false) return `/inbox?tab=${ALL_TAB_PARAM}`;
  const resolved = resolvePinnedLabels(
    opts.pinnedLabels,
    opts.isGoogleConnected ?? true,
  );
  if (resolved.length > 0) {
    const firstId = resolved[0];
    if ((COLLAPSIBLE_VIEW_IDS as readonly string[]).includes(firstId)) {
      return `/${firstId}`;
    }
    return labelTabHref(firstId);
  }
  if (opts.savedFilters && opts.savedFilters.length > 0) {
    return `/inbox?filter=${encodeURIComponent(opts.savedFilters[0].id)}`;
  }
  return "/inbox";
}

export function pinnedTriageLabels(pinnedLabels: readonly string[]): string[] {
  return pinnedLabels.filter(
    (id) => !(COLLAPSIBLE_VIEW_IDS as readonly string[]).includes(id),
  );
}

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

export function qualifiesForInboxTab(
  latestLabelIds: readonly string[],
  tab: string | null,
  triageLabels: readonly string[],
): boolean {
  if (tab === null) {
    return (
      !mailLabelsIncludeAny(latestLabelIds, triageLabels) &&
      !mailLabelsInclude(latestLabelIds, AI_IMPORTANT_LABEL)
    );
  }
  const isImportant =
    mailLabelsInclude(latestLabelIds, tab) ||
    (tab === "important" &&
      mailLabelsInclude(latestLabelIds, AI_IMPORTANT_LABEL));
  if (!isImportant) return false;
  if (tab === "important") {
    const others = triageLabels.filter((l) => l !== "important");
    if (mailLabelsIncludeAny(latestLabelIds, others)) return false;
  }
  return true;
}

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
      (!savedFilterThreads.has(key) &&
        qualifiesForInboxTab(latestMsg.labelIds, tab, triage)) ||
      (tab === "important" &&
        mailLabelsInclude(latestMsg.labelIds, AI_IMPORTANT_LABEL))
    ) {
      qualified.add(key);
    }
  }
  return emails.filter((e) => qualified.has(inboxThreadKey(e)));
}
