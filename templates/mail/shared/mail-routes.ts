import { inboxTabHref } from "./inbox-threads";

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

export function isKnownMailView(view: string | undefined): boolean {
  return !view || MAIL_VIEWS.has(view);
}

/**
 * Where a `/_agent-native/open` link lands. The route also hands the new tab a
 * one-shot `navigate` command, but a freshly opened inbox can settle on its
 * default tab without acting on it, so whatever the link asks to show (a
 * thread, a tab, a search) goes in this path.
 */
export function resolveMailOpenPath({
  view,
  params,
}: {
  view?: string;
  params: Record<string, string>;
}): string | null {
  const listView = view && MAIL_VIEWS.has(view) ? view : "inbox";
  if (params.threadId) {
    return `/${listView}/${encodeURIComponent(params.threadId)}`;
  }
  if (view === "draft-queue" && params.queuedDraftId) {
    return `/draft-queue?id=${encodeURIComponent(params.queuedDraftId)}`;
  }
  if (params.tab) return inboxTabHref(params.tab);
  if (params.filter) {
    return `/inbox?filter=${encodeURIComponent(params.filter)}`;
  }
  if (params.q) return `/${listView}?q=${encodeURIComponent(params.q)}`;
  return null;
}
