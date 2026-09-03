import { defineAction } from "@agent-native/core/action";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { gmailListLabels } from "../server/lib/google-api.js";
import { readLocalEmails } from "../server/lib/local-email-store.js";
import { isInboxScopedAppLabel } from "../shared/gmail-labels.js";
import type { EmailMessage, Label } from "../shared/types.js";
import { getAccessTokens, resolveOwnerEmail } from "./helpers.js";

type AccountLabel = Label & { accountEmail: string };

const SYSTEM_LABELS: Record<string, { id: string; name: string }> = {
  INBOX: { id: "inbox", name: "Inbox" },
  STARRED: { id: "starred", name: "Starred" },
  SENT: { id: "sent", name: "Sent" },
  DRAFT: { id: "drafts", name: "Drafts" },
  TRASH: { id: "trash", name: "Trash" },
  IMPORTANT: { id: "important", name: "Important" },
  CATEGORY_PERSONAL: { id: "personal", name: "Primary" },
  CATEGORY_SOCIAL: { id: "social", name: "Social" },
  CATEGORY_UPDATES: { id: "updates", name: "Updates" },
  CATEGORY_PROMOTIONS: { id: "promotions", name: "Promotions" },
  CATEGORY_FORUMS: { id: "forums", name: "Forums" },
};

function normalizeGmailLabels(
  labels: readonly {
    id?: string | null;
    name?: string | null;
    type?: string | null;
    messagesUnread?: number | null;
    messagesTotal?: number | null;
    threadsUnread?: number | null;
    threadsTotal?: number | null;
  }[],
  accountEmail: string,
): AccountLabel[] {
  const byId = new Map<string, AccountLabel>();
  for (const label of labels) {
    if (!label.id || !label.name) continue;
    const system = SYSTEM_LABELS[label.id];
    const id = system?.id ?? label.name.toLowerCase().replace(/_/g, " ");
    const existing = byId.get(id);
    const unreadCount =
      Number(label.threadsUnread ?? label.messagesUnread ?? 0) || 0;
    const totalCount =
      Number(label.threadsTotal ?? label.messagesTotal ?? 0) || 0;
    if (existing) {
      existing.unreadCount = (existing.unreadCount ?? 0) + unreadCount;
      existing.totalCount = (existing.totalCount ?? 0) + totalCount;
      continue;
    }
    byId.set(id, {
      id,
      name: system?.name ?? label.name.replace(/_/g, " "),
      type: system ? "system" : "user",
      unreadCount,
      totalCount,
      accountEmail,
    });
  }
  return [...byId.values()];
}

async function listLocalLabels(): Promise<Label[]> {
  const ownerEmail = await resolveOwnerEmail();
  const stored = await getUserSetting(ownerEmail, "labels");
  const labels =
    stored && typeof stored === "object" && "labels" in stored
      ? (stored as { labels?: unknown }).labels
      : undefined;
  if (!Array.isArray(labels)) return [];
  const emails = await readLocalEmails(ownerEmail);
  return (labels as Label[]).map((label) => {
    const active = emails.filter(
      (email: EmailMessage) =>
        !email.isTrashed &&
        (!isInboxScopedAppLabel(label.id) || !email.isArchived) &&
        email.labelIds.includes(label.id),
    );
    return {
      ...label,
      unreadCount: active.filter((email) => !email.isRead).length,
      totalCount: active.length,
    };
  });
}

export default defineAction({
  description: "List Gmail labels across the user's connected accounts.",
  schema: z.object({}),
  readOnly: true,
  run: async () => {
    const accounts = await getAccessTokens();
    if (accounts.length === 0) return listLocalLabels();
    const labels: AccountLabel[] = [];
    for (const account of accounts) {
      const response = await gmailListLabels(account.accessToken);
      labels.push(
        ...normalizeGmailLabels(response.labels ?? [], account.email).map(
          (label) => ({ ...label, accountEmail: account.email }),
        ),
      );
    }
    return labels;
  },
});
