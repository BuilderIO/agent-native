import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { isInboxScopedAppLabel } from "@shared/gmail-labels.js";
import { z } from "zod";

import { gmailListLabels } from "../server/lib/google-api.js";
import { getConnectedAccounts } from "../server/lib/google-auth.js";
import { readCachedLabels } from "../server/lib/inbox-store.js";
import { readLocalEmails } from "../server/lib/local-email-store.js";
import type { Label } from "../shared/types.js";
import { getAccessTokens } from "./helpers.js";

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

const CATEGORY_NAMES: Record<string, string> = {
  important: "Important",
  "note-to-self": "Note to Self",
  promotions: "Promotions",
  social: "Social",
  updates: "Updates",
  forums: "Forums",
};

function recomputeLocalCounts(labels: Label[], emails: any[]): Label[] {
  return labels.map((label) => {
    const inboxScoped = label.id === "inbox" || isInboxScopedAppLabel(label.id);
    const active = emails.filter(
      (email) =>
        !email.isTrashed &&
        (!inboxScoped || !email.isArchived) &&
        email.labelIds.includes(label.id),
    );
    return {
      ...label,
      unreadCount: active.filter((email) => !email.isRead).length,
      totalCount: active.length,
    };
  });
}

// Same bound + redaction shape as list-emails.ts's inventoryError: never let
// a token leak into a surfaced error, and cap length so one bad message
// can't blow up the response.
function boundedErrorMessage(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Provider request failed";
  return message
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(access_token|refresh_token|id_token|token)=([^\s&]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 240);
}

function mergeGmailLabels(
  labelsById: Map<string, Label>,
  rawLabels: Array<{
    id?: string;
    name?: string;
    threadsTotal?: number;
    threadsUnread?: number;
    messagesTotal?: number;
    messagesUnread?: number;
  }>,
): void {
  for (const label of rawLabels) {
    if (!label.id || !label.name) continue;
    const systemLabel = SYSTEM_LABELS[label.id];
    const id = systemLabel?.id ?? label.name.toLowerCase().replace(/_/g, " ");
    const current = labelsById.get(id);
    const next: Label = {
      id,
      name: systemLabel?.name ?? label.name.replace(/_/g, " "),
      type: label.id.startsWith("Label_") ? "user" : "system",
      unreadCount:
        Number(label.threadsUnread ?? label.messagesUnread ?? 0) || 0,
      totalCount: Number(label.threadsTotal ?? label.messagesTotal ?? 0) || 0,
    };
    labelsById.set(
      id,
      current
        ? {
            ...current,
            unreadCount: (current.unreadCount ?? 0) + (next.unreadCount ?? 0),
            totalCount: (current.totalCount ?? 0) + (next.totalCount ?? 0),
          }
        : next,
    );
  }
}

export default defineAction({
  description:
    "List labels for the connected Gmail accounts, returning stable ids, names, types, and message counts for move-email or provider API calls. Served from the synced inbox cache; an account with no cache yet falls back to a live Gmail call. Returns `{ labels, errors }`: a single account's failed live fetch never fails the whole read, but is reported in `errors` (accountEmail + bounded message) instead of silently returning an incomplete label list that looks complete.",
  schema: z.object({
    accountEmails: z
      .array(z.string().email())
      .optional()
      .describe("Optional connected Gmail accounts to include"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ accountEmails }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const requested = accountEmails?.length
      ? new Set(accountEmails.map((email) => email.toLowerCase()))
      : undefined;

    // getConnectedAccounts is the single "which accounts exist" source —
    // OAuth rows with Gmail scope, else a managed workspace grant's email.
    const connectedEmails = (await getConnectedAccounts(ownerEmail))
      .map((email) => email.toLowerCase())
      .filter((email) => !requested || requested.has(email));

    if (connectedEmails.length === 0) {
      const local = await getUserSetting(ownerEmail, "labels");
      const labels = Array.isArray((local as any)?.labels)
        ? ((local as any).labels as Label[])
        : [];
      return {
        labels: recomputeLocalCounts(labels, await readLocalEmails(ownerEmail)),
        errors: [],
      };
    }

    const labelsById = new Map<string, Label>();

    // Cache-first: readCachedLabels never throws, and its label id/name
    // normalization matches gmailListLabels' below exactly (see inbox-store's
    // comment), so a cached label and a freshly-fetched one for a different
    // account merge under the same id.
    const { labels: cachedLabels, labelMapByAccount } = await readCachedLabels(
      ownerEmail,
      [...connectedEmails],
    );
    const cachedEmails = new Set(
      [...labelMapByAccount.entries()]
        .filter(([, map]) => map.size > 0)
        .map(([email]) => email),
    );
    for (const label of cachedLabels) labelsById.set(label.id, label);

    const uncachedEmails = connectedEmails.filter(
      (email) => !cachedEmails.has(email),
    );
    const errors: Array<{ accountEmail: string; error: string }> = [];
    if (uncachedEmails.length > 0) {
      const accounts = (await getAccessTokens()).filter(({ email }) =>
        uncachedEmails.includes(email.toLowerCase()),
      );
      for (const { email, accessToken } of accounts) {
        try {
          const result = await gmailListLabels(accessToken);
          mergeGmailLabels(labelsById, result.labels ?? []);
        } catch (err) {
          // An account with neither a cache nor a live fetch contributes no
          // labels for this call — reported here instead of swallowed, so
          // callers can tell an incomplete inventory from a complete one.
          errors.push({ accountEmail: email, error: boundedErrorMessage(err) });
        }
      }
    }

    for (const [id, name] of Object.entries(CATEGORY_NAMES)) {
      const label = labelsById.get(id);
      if (label) {
        label.name = name;
      } else {
        labelsById.set(id, {
          id,
          name,
          type: "system",
          unreadCount: 0,
          totalCount: 0,
        });
      }
    }

    return { labels: [...labelsById.values()], errors };
  },
});
