import { fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  gmailGetMessage,
  gmailListLabels,
  gmailModifyThread,
} from "./google-api.js";
import { isConnected } from "./google-auth.js";
import { syncInboxLabelDelta } from "./inbox-store-sync.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";

type GmailLabel = { id?: string; name?: string };

export const emailLabelChangeOutputSchema = z.object({
  status: z.enum(["complete", "partial"]),
  requested: z.array(z.string()),
  succeeded: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), error: z.string() })),
  targetLabel: z.string(),
});

export type EmailLabelChangeResult = z.infer<
  typeof emailLabelChangeOutputSchema
>;

const SYSTEM_LABELS = new Map<string, string>([
  ["inbox", "INBOX"],
  ["starred", "STARRED"],
  ["sent", "SENT"],
  ["drafts", "DRAFT"],
  ["trash", "TRASH"],
  ["important", "IMPORTANT"],
  ["personal", "CATEGORY_PERSONAL"],
  ["social", "CATEGORY_SOCIAL"],
  ["updates", "CATEGORY_UPDATES"],
  ["promotions", "CATEGORY_PROMOTIONS"],
  ["forums", "CATEGORY_FORUMS"],
]);

export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/^label:/, "")
    .replace(/_/g, " ")
    .trim();
}

export function isSystemLabelName(value: string): boolean {
  return SYSTEM_LABELS.has(normalizeLabel(value));
}

export function resolveLabelId(
  input: string,
  labels: GmailLabel[],
): string | null {
  const normalized = normalizeLabel(input);
  const systemLabel = SYSTEM_LABELS.get(normalized);
  if (systemLabel) return systemLabel;

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

export const emailLabelChangeSchema = {
  id: z.string().optional().describe("Email ID(s), comma-separated"),
  label: z.string().optional().describe("Label name or ID"),
  accountEmail: z
    .string()
    .optional()
    .describe("Specific connected account to use"),
  accountEmails: z
    .string()
    .optional()
    .describe(
      "Per-id account emails, comma-separated and positionally matched to --id (bulk UI calls only)",
    ),
  threadId: z
    .string()
    .optional()
    .describe("Thread ID hint to skip an extra Gmail API round-trip"),
  threadIds: z
    .string()
    .optional()
    .describe(
      "Per-id thread ID hints, comma-separated and positionally matched to --id (bulk UI calls only)",
    ),
};

export type EmailLabelChangeArgs = {
  id?: string | undefined;
  label?: string | undefined;
  accountEmail?: string | undefined;
  accountEmails?: string | undefined;
  threadId?: string | undefined;
  threadIds?: string | undefined;
};

export async function runEmailLabelChange(
  args: EmailLabelChangeArgs,
  opts: {
    remove: string[];
    errorCode: string;
    failMessage: string;
    getAccounts: (
      ownerEmail: string,
    ) => Promise<Array<{ email: string; accessToken: string }>>;
  },
): Promise<EmailLabelChangeResult> {
  const ids = [
    ...new Set(
      args.id
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const targetLabel = args.label?.trim();
  if (ids.length === 0) throw new Error("--id is required");
  if (!targetLabel) throw new Error("--label is required");

  const remove = [...new Set(opts.remove.filter(Boolean))];
  const leavesInbox = remove.some((label) => normalizeLabel(label) === "inbox");
  const threadIdList = args.threadIds?.split(",").map((s) => s.trim());
  const accountEmailList = args.accountEmails?.split(",").map((s) => s.trim());
  const threadIdFor = (i: number) => threadIdList?.[i] || args.threadId;
  const accountEmailFor = (i: number) =>
    (accountEmailList?.[i] || args.accountEmail)?.trim() || undefined;

  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");

  if (!(await isConnected(ownerEmail))) {
    const changed = await withLocalEmailMutationLock(ownerEmail, async () => {
      const emails = await readLocalEmails(ownerEmail);
      const idSet = new Set(ids);
      const targetThreads = new Set<string>();
      for (const email of emails) {
        if (idSet.has(email.id)) targetThreads.add(email.threadId || email.id);
      }

      const succeeded: string[] = [];
      const updated = emails.map((email) => {
        if (!targetThreads.has(email.threadId || email.id)) return email;
        if (idSet.has(email.id)) succeeded.push(email.id);
        const labelIds = new Set<string>(email.labelIds);
        for (const label of remove) labelIds.delete(label);
        labelIds.add(targetLabel);
        return {
          ...email,
          ...(leavesInbox ? { isArchived: true } : {}),
          labelIds: [...labelIds],
        };
      });

      await writeLocalEmails(ownerEmail, updated);
      return succeeded;
    });
    const succeededIds = new Set(changed);
    const failed = ids
      .filter((id) => !succeededIds.has(id))
      .map((id) => ({ id, error: "Email not found in the local mailbox" }));
    if (changed.length > 0)
      await writeAppState("refresh-signal", { ts: Date.now() });
    if (changed.length === 0) {
      fail("No requested emails were found in the local mailbox", {
        errorCode: opts.errorCode,
        details: { requested: ids, failed },
      });
    }
    return {
      status: failed.length > 0 ? "partial" : "complete",
      requested: ids,
      succeeded: changed,
      failed,
      targetLabel,
    };
  }

  const accounts = await opts.getAccounts(ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected.");

  const results: { id: string; success: boolean; error?: string }[] = [];
  const labelsByAccount = new Map<string, GmailLabel[]>();
  for (const [index, id] of ids.entries()) {
    const requestedAccount = accountEmailFor(index);
    const candidateAccounts = requestedAccount
      ? accounts.filter(
          ({ email }) => email.toLowerCase() === requestedAccount.toLowerCase(),
        )
      : accounts;

    if (requestedAccount && candidateAccounts.length === 0) {
      results.push({
        id,
        success: false,
        error: `Account ${requestedAccount} is not connected for this user`,
      });
      continue;
    }

    let success = false;
    const errors: string[] = [];
    for (const { email, accessToken } of candidateAccounts) {
      try {
        const resolvedThreadId =
          threadIdFor(index) ??
          (await gmailGetMessage(accessToken, id, "minimal")).threadId;
        if (!resolvedThreadId) throw new Error("Thread not found");

        const accountKey = email.toLowerCase();
        let labels = labelsByAccount.get(accountKey);
        if (!labels) {
          const labelData = await gmailListLabels(accessToken);
          labels = (labelData.labels ?? []) as GmailLabel[];
          labelsByAccount.set(accountKey, labels);
        }
        const addLabelId = resolveLabelId(targetLabel, labels);
        if (!addLabelId) {
          throw new Error(`Label not found: ${targetLabel}`);
        }
        const removeLabelIds = [
          ...new Set(
            remove
              .map((label) => resolveLabelId(label, labels))
              .filter((labelId): labelId is string => !!labelId),
          ),
        ];
        const updated = (await gmailModifyThread(
          accessToken,
          resolvedThreadId,
          [addLabelId],
          removeLabelIds,
        )) as { historyId?: string } | undefined;
        await syncInboxLabelDelta(ownerEmail, email, [resolvedThreadId], {
          add: [addLabelId],
          remove: removeLabelIds,
          ...(updated?.historyId
            ? { providerHistoryId: updated.historyId }
            : {}),
        });
        success = true;
        break;
      } catch (err) {
        errors.push(
          err instanceof Error && err.message ? err.message : "Gmail API error",
        );
      }
    }
    results.push(
      success
        ? { id, success: true }
        : { id, success: false, error: errors.join("; ") },
    );
  }

  const succeeded = results
    .filter((result) => result.success)
    .map((result) => result.id);
  const failed = results
    .filter((result) => !result.success)
    .map((result) => ({
      id: result.id,
      error: result.error ?? "Unknown error",
    }));
  if (succeeded.length > 0)
    await writeAppState("refresh-signal", { ts: Date.now() });
  if (succeeded.length === 0) {
    fail(opts.failMessage, {
      errorCode: opts.errorCode,
      statusCode: 502,
      details: { requested: ids, failed, targetLabel },
    });
  }

  return {
    status: failed.length > 0 ? "partial" : "complete",
    requested: ids,
    succeeded,
    failed,
    targetLabel,
  };
}
