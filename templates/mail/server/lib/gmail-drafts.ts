import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";

import type { ComposeAttachment } from "../../shared/types.js";
import {
  gmailGetAttachment,
  gmailGetMessage,
  googleFetch,
} from "./google-api.js";
import { getClientForConnectedAccount } from "./google-auth.js";
import { buildRawEmail, resolveComposeAttachments } from "./outgoing-email.js";

type GmailScopeUse = "write" | "reply" | "attachment";
function hasGmailScope(
  tokens: Record<string, unknown>,
  use: GmailScopeUse = "write",
): boolean {
  const scope = tokens.scope;
  if (typeof scope !== "string" || !scope.trim()) return true;
  const scopes = scope.split(/[\s,]+/);
  const canWrite = scopes.some(
    (value) =>
      value === "https://mail.google.com/" ||
      value === "https://www.googleapis.com/auth/gmail.compose" ||
      value === "https://www.googleapis.com/auth/gmail.modify",
  );
  const canReadAttachment = scopes.some(
    (value) =>
      value === "https://mail.google.com/" ||
      value === "https://www.googleapis.com/auth/gmail.modify" ||
      value === "https://www.googleapis.com/auth/gmail.readonly",
  );
  const canReadMessageMetadata =
    canReadAttachment ||
    scopes.includes("https://www.googleapis.com/auth/gmail.metadata");
  if (use === "write") return canWrite;
  if (use === "reply") return canWrite && canReadMessageMetadata;
  return canReadAttachment;
}

async function getAccessToken(
  accountEmail: string,
  ownerEmail: string,
): Promise<string | null> {
  const client = await getClientForConnectedAccount(ownerEmail, accountEmail);
  return client?.accessToken ?? null;
}

async function resolveAccountEmail(
  requested: string | undefined,
  ownerEmail: string,
  use: GmailScopeUse = "write",
): Promise<string | null> {
  const accounts = (
    await listOAuthAccountsByOwner("google", ownerEmail)
  ).filter((account) => hasGmailScope(account.tokens, use));
  if (requested) {
    if (!accounts.some((account) => account.accountId === requested)) {
      throw new Error("Account not owned by current user");
    }
    return requested;
  }
  return (
    accounts.find((account) => account.accountId === ownerEmail)?.accountId ??
    accounts[0]?.accountId ??
    null
  );
}

const isNotFound = (error: unknown) =>
  error instanceof Error && /\b404\b/.test(error.message);

async function findGmailDraftIdForMessage(
  accessToken: string,
  messageId: string,
): Promise<string | null> {
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      maxResults: "500",
      fields: "drafts(id,message/id),nextPageToken",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts?${params}`,
      accessToken,
    );
    const draft = (
      page?.drafts as { id?: string; message?: { id?: string } }[] | undefined
    )?.find((candidate) => candidate.message?.id === messageId);
    if (draft?.id) return draft.id;
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return null;
}

/**
 * Runs `request` on the Gmail draft `savedDraftId` names, or returns null when
 * Gmail has no such draft. Mail lists Gmail drafts as messages, so a draft
 * reopened from that list names its message ID, which Gmail's drafts API
 * answers with a 404; that ID stands for the draft holding the message.
 */
export async function withSavedGmailDraft<T>(
  accessToken: string,
  savedDraftId: string,
  request: (draftId: string) => Promise<T>,
): Promise<{ result: T } | null> {
  try {
    return { result: await request(savedDraftId) };
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const draftId = await findGmailDraftIdForMessage(accessToken, savedDraftId);
  if (!draftId) return null;
  try {
    return { result: await request(draftId) };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return null;
  }
}

export async function findGmailDraftAccount(args: {
  ownerEmail: string;
  accountEmail?: string;
  draftId: string;
}): Promise<string | null> {
  const accounts = (
    await listOAuthAccountsByOwner("google", args.ownerEmail)
  ).filter((account) => hasGmailScope(account.tokens));
  const candidates = args.accountEmail
    ? accounts.filter((account) => account.accountId === args.accountEmail)
    : [
        ...accounts.filter((account) => account.accountId === args.ownerEmail),
        ...accounts.filter((account) => account.accountId !== args.ownerEmail),
      ];

  if (args.accountEmail && candidates.length === 0) {
    throw new Error("Account not owned by current user");
  }

  let unavailableAccount: string | undefined;
  for (const account of candidates) {
    const accessToken = await getAccessToken(
      account.accountId,
      args.ownerEmail,
    );
    if (!accessToken) {
      unavailableAccount = account.accountId;
      continue;
    }

    const found = await withSavedGmailDraft(
      accessToken,
      args.draftId,
      (draftId) =>
        googleFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
          accessToken,
        ),
    );
    if (found) return account.accountId;
  }

  if (unavailableAccount) {
    throw new Error(
      `Could not verify saved Gmail draft ownership for ${unavailableAccount}.`,
    );
  }
  return null;
}

export async function saveGmailDraft(args: {
  ownerEmail: string;
  accountEmail?: string;
  draftId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: ComposeAttachment[];
  replyToId?: string;
  replyToThreadId?: string;
}): Promise<{
  draftId: string;
  accountEmail: string;
  created: boolean;
  updated?: boolean;
} | null> {
  const accountEmail = await resolveAccountEmail(
    args.accountEmail,
    args.ownerEmail,
    args.replyToId ? "reply" : "write",
  );
  if (!accountEmail) return null;
  const accessToken = await getAccessToken(accountEmail, args.ownerEmail);
  if (!accessToken) return null;

  const attachments = await resolveComposeAttachments(
    args.attachments,
    args.ownerEmail,
    {
      readGmailAttachment: async (attachment) => {
        const attachmentAccountEmail = await resolveAccountEmail(
          attachment.accountEmail ?? accountEmail,
          args.ownerEmail,
          "attachment",
        );
        if (!attachmentAccountEmail) return null;
        const attachmentAccessToken =
          attachmentAccountEmail === accountEmail
            ? accessToken
            : await getAccessToken(attachmentAccountEmail, args.ownerEmail);
        if (!attachmentAccessToken) return null;
        const result = await gmailGetAttachment(
          attachmentAccessToken,
          attachment.gmailMessageId!,
          attachment.gmailAttachmentId!,
        );
        return typeof result?.data === "string"
          ? Buffer.from(result.data, "base64url")
          : null;
      },
    },
  );

  let threadId = args.replyToThreadId;
  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (args.replyToId) {
    const original = await gmailGetMessage(
      accessToken,
      args.replyToId,
      "metadata",
    );
    threadId = original.threadId ?? threadId;
    const headers = Array.isArray(original.payload?.headers)
      ? original.payload.headers
      : [];
    const headerValue = (name: string) =>
      headers.find(
        (header: { name?: string }) =>
          header.name?.toLowerCase() === name.toLowerCase(),
      )?.value;
    inReplyTo = headerValue("message-id");
    references = [headerValue("references"), inReplyTo]
      .filter((value): value is string => Boolean(value))
      .join(" ");
  }

  const raw = buildRawEmail({
    from: accountEmail,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject || "(no subject)",
    body: args.body,
    inReplyTo,
    references,
    attachments,
  });
  const message = {
    raw,
    ...(threadId ? { threadId } : {}),
  };
  if (args.draftId) {
    const updated = await withSavedGmailDraft(
      accessToken,
      args.draftId,
      (draftId) =>
        googleFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
          accessToken,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          },
        ),
    );
    if (updated) {
      return {
        draftId: updated.result.id,
        accountEmail,
        created: false,
        updated: true,
      };
    }
    // A deleted Gmail draft is safe to replace with a new one.
  }
  const created = await googleFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
  return { draftId: created.id, accountEmail, created: true };
}

export async function deleteGmailDraft(args: {
  ownerEmail: string;
  accountEmail?: string;
  draftId: string;
}): Promise<void> {
  const accountEmail = await resolveAccountEmail(
    args.accountEmail,
    args.ownerEmail,
  );
  if (!accountEmail) {
    throw new Error(
      "Gmail draft could not be deleted because the account is not connected.",
    );
  }
  const accessToken = await getAccessToken(accountEmail, args.ownerEmail);
  if (!accessToken) {
    throw new Error(
      "Gmail draft could not be deleted because the account is not connected.",
    );
  }

  await withSavedGmailDraft(accessToken, args.draftId, (draftId) =>
    googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`,
      accessToken,
      { method: "DELETE" },
    ),
  );
}
