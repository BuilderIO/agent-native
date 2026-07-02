import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  gmailGetMessage,
  gmailListLabels,
  gmailModifyThread,
} from "../server/lib/google-api.js";
import { isConnected } from "../server/lib/google-auth.js";
import { getAccessTokens } from "./helpers.js";

type GmailLabel = { id?: string; name?: string };

const SYSTEM_LABELS: Record<string, string> = {
  inbox: "INBOX",
  starred: "STARRED",
  sent: "SENT",
  drafts: "DRAFT",
  trash: "TRASH",
  important: "IMPORTANT",
  personal: "CATEGORY_PERSONAL",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  promotions: "CATEGORY_PROMOTIONS",
  forums: "CATEGORY_FORUMS",
};

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/^label:/, "")
    .replace(/_/g, " ")
    .trim();
}

function resolveLabelId(input: string, labels: GmailLabel[]): string | null {
  const normalized = normalizeLabel(input);
  if (SYSTEM_LABELS[normalized]) return SYSTEM_LABELS[normalized];

  const match = labels.find((label) => {
    if (!label.id || !label.name) return false;
    return (
      label.id === input ||
      label.name === input ||
      normalizeLabel(label.id) === normalized ||
      normalizeLabel(label.name) === normalized
    );
  });

  return match?.id ?? null;
}

export default defineAction({
  description:
    "Move one or more email threads to a Gmail label/folder. Removes Inbox and the current label by default.",
  schema: z.object({
    id: z.string().optional().describe("Email ID(s) to move, comma-separated"),
    label: z
      .string()
      .optional()
      .describe("Destination label/folder name or ID"),
    removeLabel: z
      .string()
      .optional()
      .describe("Current label to remove after applying the destination"),
  }),
  run: async (args) => {
    const ids = args.id
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const targetLabel = args.label?.trim();
    if (!ids || ids.length === 0) throw new Error("--id is required");
    if (!targetLabel) throw new Error("--label is required");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      const emails =
        data && Array.isArray((data as any).emails) ? (data as any).emails : [];
      const idSet = new Set(ids);
      const targetThreads = new Set<string>();
      for (const email of emails) {
        if (idSet.has(email.id)) targetThreads.add(email.threadId || email.id);
      }

      let changed = 0;
      const updated = emails.map((email: any) => {
        if (!targetThreads.has(email.threadId || email.id)) return email;
        changed++;
        const labelIds = new Set<string>(email.labelIds ?? []);
        labelIds.delete("inbox");
        if (args.removeLabel) labelIds.delete(args.removeLabel);
        labelIds.add(targetLabel);
        return {
          ...email,
          isArchived: true,
          labelIds: [...labelIds],
        };
      });

      await putUserSetting(ownerEmail, "local-emails", { emails: updated });
      await writeAppState("refresh-signal", { ts: Date.now() });
      return `Moved ${changed} local email(s) to ${targetLabel}`;
    }

    const accounts = await getAccessTokens();
    if (accounts.length === 0) throw new Error("No Google account connected.");

    const results: { id: string; success: boolean; error?: string }[] = [];
    for (const id of ids) {
      let success = false;
      const errors: string[] = [];
      for (const { accessToken } of accounts) {
        try {
          const msg = await gmailGetMessage(accessToken, id, "minimal");
          const labelData = await gmailListLabels(accessToken);
          const labels = (labelData.labels ?? []) as GmailLabel[];
          const addLabelId = resolveLabelId(targetLabel, labels);
          if (!addLabelId) {
            throw new Error(`Label not found: ${targetLabel}`);
          }
          const removeLabelIds = ["INBOX"];
          if (args.removeLabel) {
            const removeLabelId = resolveLabelId(args.removeLabel, labels);
            if (removeLabelId) removeLabelIds.push(removeLabelId);
          }
          await gmailModifyThread(
            accessToken,
            msg.threadId,
            [addLabelId],
            [...new Set(removeLabelIds)],
          );
          success = true;
          break;
        } catch (err: any) {
          errors.push(err?.message || "Gmail API error");
        }
      }
      results.push(
        success
          ? { id, success: true }
          : { id, success: false, error: errors.join("; ") },
      );
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      return `Moved ${succeeded}/${ids.length} email(s). Failures: ${failed
        .map((r) => `${r.id}: ${r.error}`)
        .join("; ")}`;
    }
    return `Moved ${succeeded} email(s) to ${targetLabel}`;
  },
});
