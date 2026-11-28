import {
  inboxFilterParam,
  inboxFilterParamFor,
  withInboxFilter,
  type InboxFilterFlags,
} from "./inbox-filters";
import { inboxTabHref } from "./inbox-threads";
import { mailSettingsRoute } from "./settings-navigation";

const MAIL_VIEWS = new Set([
  "inbox",
  "unread",
  "starred",
  "snoozed",
  "scheduled",
  "sent",
  "drafts",
  "archive",
  "trash",
  "all",
]);

const FILTER_VIEWS = new Map<string, Partial<InboxFilterFlags>>([
  ["unread", { unread: true }],
  ["starred", { starred: true }],
]);

export const UNREAD_INBOX_PATH = withInboxFilter(
  "/inbox",
  inboxFilterParamFor({ unread: true }),
);

export const STARRED_INBOX_PATH = withInboxFilter(
  "/inbox",
  inboxFilterParamFor({ starred: true }),
);

export function isKnownMailView(view: string | undefined): boolean {
  return !view || MAIL_VIEWS.has(view);
}

export function filteredInboxPathForView(
  view: string | undefined,
  search: string,
  threadId?: string,
): string | null {
  const flags = view ? FILTER_VIEWS.get(view) : undefined;
  if (!flags) return null;
  const path = threadId ? `/inbox/${encodeURIComponent(threadId)}` : "/inbox";
  return withInboxFilter(`${path}${search}`, inboxFilterParamFor(flags));
}

/** A thread's path under its list view, or the Inbox's for any other view. */
export function openThreadPath(view: string | undefined, threadId: string) {
  const listView = view && MAIL_VIEWS.has(view) ? view : "inbox";
  return `/${listView}/${encodeURIComponent(threadId)}`;
}

/**
 * Where a `/_agent-native/open` link lands. The route also hands the new tab a
 * one-shot `navigate` command, but a freshly opened inbox can settle on its
 * default tab without acting on it, so whatever the link asks to show (a
 * thread, a tab, a search) goes in this path. The checks run in the order
 * InboxPage acts on the command, so both reach the same page.
 */
export function resolveMailOpenPath({
  view,
  params,
}: {
  view?: string;
  params: Record<string, string>;
}): string | null {
  if (view === "draft-queue") {
    return params.queuedDraftId
      ? `/draft-queue?id=${encodeURIComponent(params.queuedDraftId)}`
      : null;
  }
  if (view === "settings") {
    return mailSettingsRoute(params.settingsSection || "general");
  }
  const inboxFilter = params.inboxFilter
    ? inboxFilterParam(params.inboxFilter)
    : "";
  if (params.tab) return withInboxFilter(inboxTabHref(params.tab), inboxFilter);
  if (params.filter) {
    return `/inbox?filter=${encodeURIComponent(params.filter)}`;
  }
  if (inboxFilter && !params.threadId) {
    return withInboxFilter("/inbox", inboxFilter);
  }
  if (params.threadId) return openThreadPath(view, params.threadId);
  if (params.q && isKnownMailView(view)) {
    return `/${view || "inbox"}?q=${encodeURIComponent(params.q)}`;
  }
  return null;
}
