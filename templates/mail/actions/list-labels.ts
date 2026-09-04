import { defineAction, fail } from "@agent-native/core/action";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { isInboxScopedAppLabel } from "@shared/gmail-labels.js";
import { z } from "zod";

import { gmailListLabels } from "../server/lib/google-api.js";
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

export default defineAction({
  description:
    "List labels for the connected Gmail accounts, returning stable ids, names, types, and message counts for move-email or provider API calls.",
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

    // Ground truth for "is a Gmail account connected/requested at all",
    // independent of whether its token currently resolves. getAccessTokens()
    // silently drops an account whose refresh fails, which would otherwise be
    // indistinguishable from "no Google account connected" and fall through
    // to local labels as if the mailbox were complete.
    const connectedEmails = (
      await listOAuthAccountsByOwner("google", ownerEmail)
    )
      .map((account) => account.accountId.toLowerCase())
      .filter((email) => !requested || requested.has(email));

    if (connectedEmails.length === 0) {
      const local = await getUserSetting(ownerEmail, "labels");
      const labels = Array.isArray((local as any)?.labels)
        ? ((local as any).labels as Label[])
        : [];
      return recomputeLocalCounts(labels, await readLocalEmails(ownerEmail));
    }

    const accounts = (await getAccessTokens()).filter(
      ({ email }) => !requested || requested.has(email.toLowerCase()),
    );
    const resolvedEmails = new Set(
      accounts.map(({ email }) => email.toLowerCase()),
    );
    const unresolved = connectedEmails.filter(
      (email) => !resolvedEmails.has(email),
    );
    if (unresolved.length > 0) {
      fail(
        `Unable to load Gmail labels for ${unresolved.join(", ")}: the account's Google connection needs to be reconnected.`,
        { errorCode: "labels_account_unavailable" },
      );
    }

    const labelsById = new Map<string, Label>();
    const failures: string[] = [];
    for (const { accessToken } of accounts) {
      try {
        const result = await gmailListLabels(accessToken);
        for (const label of result.labels ?? []) {
          if (!label.id || !label.name) continue;
          const systemLabel = SYSTEM_LABELS[label.id];
          const id =
            systemLabel?.id ?? label.name.toLowerCase().replace(/_/g, " ");
          const current = labelsById.get(id);
          const next: Label = {
            id,
            name: systemLabel?.name ?? label.name.replace(/_/g, " "),
            type: label.id.startsWith("Label_") ? "user" : "system",
            unreadCount:
              Number(label.threadsUnread ?? label.messagesUnread ?? 0) || 0,
            totalCount:
              Number(label.threadsTotal ?? label.messagesTotal ?? 0) || 0,
          };
          labelsById.set(
            id,
            current
              ? {
                  ...current,
                  unreadCount:
                    (current.unreadCount ?? 0) + (next.unreadCount ?? 0),
                  totalCount:
                    (current.totalCount ?? 0) + (next.totalCount ?? 0),
                }
              : next,
          );
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length > 0) {
      fail(
        `Unable to load Gmail labels for ${failures.length} account(s). Please retry.`,
        { errorCode: "labels_fetch_failed", statusCode: 503 },
      );
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

    return [...labelsById.values()];
  },
});
