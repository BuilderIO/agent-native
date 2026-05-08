import { isInboxScopedAppLabel } from "@shared/gmail-labels.js";

export const VIEW_QUERIES: Record<string, string> = {
  inbox: "in:inbox -in:sent",
  unread: "is:unread in:inbox -in:sent",
  starred: "is:starred",
  sent: "in:sent",
  drafts: "in:drafts",
  archive: "-in:inbox -in:sent -in:drafts -in:trash",
  trash: "in:trash",
  all: "",
};

export function gmailLabelSearchClause(label: string): string {
  const value = label.trim().replace(/\s+/g, "-").replace(/"/g, '\\"');
  if (!value) return "";
  return /[/"()]/.test(value) ? `label:"${value}"` : `label:${value}`;
}

export function gmailAppLabelSearchClause(label: string): string {
  const id = label.toLowerCase();
  const categoryIds = new Set([
    "personal",
    "social",
    "updates",
    "promotions",
    "forums",
  ]);
  if (categoryIds.has(id)) {
    return `category:${id === "personal" ? "primary" : id}`;
  }
  if (id === "important") return "is:important";
  if (id === "note-to-self") return "from:me";
  return gmailLabelSearchClause(label);
}

function viewSearchClauseForLabelTab(view: string, label: string): string {
  if (view === "all") return "";
  if (!isInboxScopedAppLabel(label)) {
    return VIEW_QUERIES[view] ?? "";
  }
  if (view === "inbox" && label.toLowerCase() === "note-to-self") {
    // Self-sent notes can carry both INBOX and SENT. Keep them in this inbox
    // tab while still excluding sent-only/archive-only results.
    return "in:inbox";
  }
  return VIEW_QUERIES[view] ?? `label:${view}`;
}

export function buildGmailEmailSearchQuery({
  view = "inbox",
  q,
  label,
}: {
  view?: string;
  q?: string;
  label?: string;
}): string {
  const trimmedQuery = q?.trim();

  if (label) {
    const labelClause = gmailAppLabelSearchClause(label);
    const viewClause = viewSearchClauseForLabelTab(view, label);
    return [viewClause, labelClause, trimmedQuery].filter(Boolean).join(" ");
  }

  const viewQuery = VIEW_QUERIES[view] ?? `label:${view}`;
  return [viewQuery, trimmedQuery].filter(Boolean).join(" ");
}
