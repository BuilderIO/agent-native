import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import {
  AI_FILTER_ACTIONS,
  AI_FILTER_LABEL,
  AI_FILTER_RULE_NAME,
  aiFilterTargetSchema,
  type AiFilterTarget,
} from "@shared/ai-filter.js";
import type { Label } from "@shared/types.js";
import { z } from "zod";

import {
  getAiFilterState,
  recordAiFilterFeedback,
  saveAiFilterState,
} from "../server/lib/ai-filter.js";
import {
  buildLabelCache,
  ensureGmailLabel,
} from "../server/lib/automation-actions.js";
import {
  createAutomationRule,
  listAutomationRules,
} from "../server/lib/automations.js";
import {
  gmailGetMessage,
  gmailModifyThread,
} from "../server/lib/google-api.js";
import { isConnected } from "../server/lib/google-auth.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "../server/lib/local-email-store.js";
import { getAccessTokens } from "./helpers.js";

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  autoFilter: z.boolean().optional(),
  autoFilterThreshold: z.number().min(0.5).max(1).optional(),
  suggestionThreshold: z.number().min(0.5).max(1).optional(),
});

const headerValue = (message: any, name: string): string => {
  const headers = message.payload?.headers ?? [];
  return (
    headers.find(
      (header: any) =>
        typeof header.name === "string" &&
        header.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
};

async function ensureLocalLabel(ownerEmail: string): Promise<void> {
  const stored = await getUserSetting(ownerEmail, "labels");
  const labels =
    stored && Array.isArray((stored as any).labels)
      ? ((stored as any).labels as Label[])
      : [];
  if (
    labels.some(
      (label) =>
        label.id === AI_FILTER_LABEL ||
        label.name.toLowerCase() === AI_FILTER_LABEL,
    )
  ) {
    return;
  }
  await putUserSetting(ownerEmail, "labels", {
    labels: [
      ...labels,
      { id: AI_FILTER_LABEL, name: AI_FILTER_LABEL, type: "user" },
    ],
  });
}

function localTarget(target: AiFilterTarget, email: any): AiFilterTarget {
  return {
    ...target,
    threadId: target.threadId ?? email.threadId ?? email.id,
    accountEmail: target.accountEmail ?? email.accountEmail,
    sender:
      target.sender ??
      (email.from?.name
        ? `${email.from.name} <${email.from.email}>`
        : (email.from?.email ?? email.from)),
    subject: target.subject ?? email.subject,
  };
}

async function ensureLearnedRule(
  ownerEmail: string,
  comment?: string,
): Promise<void> {
  const rules = await listAutomationRules(ownerEmail);
  if (
    !rules.some(
      (rule) => rule.kind === "ai-filter" && rule.name === AI_FILTER_RULE_NAME,
    )
  ) {
    await createAutomationRule(ownerEmail, {
      name: AI_FILTER_RULE_NAME,
      condition:
        "Use my confirmed examples and comments to identify unwanted email.",
      actions: AI_FILTER_ACTIONS,
      kind: "ai-filter",
    });
  }

  const normalizedComment = comment?.trim();
  if (
    normalizedComment &&
    !rules.some(
      (rule) =>
        rule.kind === "ai-filter" &&
        rule.condition.toLowerCase() === normalizedComment.toLowerCase(),
    )
  ) {
    await createAutomationRule(ownerEmail, {
      name: `Remember: ${normalizedComment.slice(0, 72)}`,
      condition: normalizedComment,
      actions: AI_FILTER_ACTIONS,
      kind: "ai-filter",
    });
  }
}

export default defineAction({
  description:
    "Filter or keep email with the reversible Mail AI filter. Filtering adds the agent-native-filtered Gmail label, archives the conversation, and learns from the decision. Keeping a message restores it to Inbox and also teaches the filter.",
  schema: z.object({
    mode: z.enum(["filter", "keep", "settings"]),
    targets: z.array(aiFilterTargetSchema).max(100).optional(),
    comment: z.string().max(500).optional(),
    settings: settingsSchema.optional(),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    if (args.mode === "settings") {
      const state = await getAiFilterState(ownerEmail);
      const next = {
        ...state,
        ...args.settings,
      };
      await saveAiFilterState(ownerEmail, next);
      await writeAppState("refresh-signal", { ts: Date.now() });
      return { changed: 0, failures: [], state: next };
    }

    const targets = args.targets ?? [];
    if (targets.length === 0) throw new Error("targets are required");

    const action = args.mode === "filter" ? "filter" : "keep";
    const succeededTargets: AiFilterTarget[] = [];
    const failures: Array<{ id: string; error: string }> = [];

    if (!(await isConnected(ownerEmail))) {
      await ensureLocalLabel(ownerEmail);
      await withLocalEmailMutationLock(ownerEmail, async () => {
        const emails = await readLocalEmails(ownerEmail);
        const requestedIds = new Set(targets.map((target) => target.id));
        const requestedThreads = new Set(
          targets.map((target) => target.threadId).filter(Boolean),
        );
        const matching = emails.filter(
          (email) =>
            requestedIds.has(email.id) ||
            requestedThreads.has(email.threadId || email.id),
        );
        if (matching.length === 0) throw new Error("No matching local emails");

        const changedThreads = new Set(
          matching.map((email) => email.threadId || email.id),
        );
        const updated = emails.map((email) => {
          const threadId = email.threadId || email.id;
          if (!changedThreads.has(threadId)) return email;
          const labelIds = new Set(email.labelIds ?? []);
          for (const label of [...labelIds]) {
            if (label.toLowerCase() === AI_FILTER_LABEL) labelIds.delete(label);
            if (action === "filter" && label.toLowerCase() === "inbox") {
              labelIds.delete(label);
            }
          }
          if (action === "filter") labelIds.add(AI_FILTER_LABEL);
          else {
            labelIds.delete(AI_FILTER_LABEL);
            labelIds.add("inbox");
          }
          return {
            ...email,
            isArchived: action === "filter" ? true : false,
            labelIds: [...labelIds],
          };
        });
        await writeLocalEmails(ownerEmail, updated);
        for (const target of targets) {
          const email = matching.find(
            (candidate) =>
              candidate.id === target.id ||
              (candidate.threadId || candidate.id) === target.threadId,
          );
          if (email) succeededTargets.push(localTarget(target, email));
        }
      });
    } else {
      const accounts = await getAccessTokens();
      if (accounts.length === 0)
        throw new Error("No Google account connected.");
      const labelCaches = new Map<string, Map<string, string>>();

      for (const target of targets) {
        const candidates = target.accountEmail
          ? accounts.filter(
              (account) =>
                account.email.toLowerCase() ===
                target.accountEmail!.toLowerCase(),
            )
          : accounts;
        const errors: string[] = [];
        let applied = false;
        for (const account of candidates) {
          try {
            const message = await gmailGetMessage(
              account.accessToken,
              target.id,
              "metadata",
            );
            const labelCache =
              labelCaches.get(account.email) ??
              (await buildLabelCache(account.accessToken));
            labelCaches.set(account.email, labelCache);
            const labelId = await ensureGmailLabel(
              account.accessToken,
              AI_FILTER_LABEL,
              labelCache,
            );
            const threadId = target.threadId ?? message.threadId ?? target.id;
            await gmailModifyThread(
              account.accessToken,
              threadId,
              action === "filter" ? [labelId] : ["INBOX"],
              action === "filter" ? ["INBOX"] : [labelId],
            );
            succeededTargets.push({
              ...target,
              threadId,
              accountEmail: account.email,
              sender: target.sender ?? headerValue(message, "From"),
              subject: target.subject ?? headerValue(message, "Subject"),
            });
            applied = true;
            break;
          } catch (error: any) {
            errors.push(error?.message ?? "Gmail update failed");
          }
        }
        if (!applied) {
          failures.push({
            id: target.id,
            error: errors.join("; ") || "Account not found",
          });
        }
      }
    }

    if (succeededTargets.length === 0) {
      throw new Error(failures.map((failure) => failure.error).join("; "));
    }

    await recordAiFilterFeedback(ownerEmail, {
      targets: succeededTargets,
      disposition: action === "filter" ? "spam" : "not_spam",
      comment: args.comment,
    });
    await ensureLearnedRule(
      ownerEmail,
      action === "filter" ? args.comment : undefined,
    );
    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      changed: succeededTargets.length,
      failures,
      state: await getAiFilterState(ownerEmail),
    };
  },
});
