import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";

import type { ComposeAttachment } from "../../shared/types.js";
import {
  gmailGetAttachment,
  gmailGetMessage,
  googleFetch,
} from "./google-api.js";
import {
  getClientForConnectedAccount,
  getManagedGmailAccountEmail,
} from "./google-auth.js";
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

type GmailAccount = { accountId: string; tokens: Record<string, unknown> };

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The owner's Gmail account to use: `requested` when it's theirs, else the one
 * with the owner's address, else the first. An OAuth account counts only when
 * its grant covers `use`. A workspace's shared Gmail connection has no grant
 * here to check, so it counts for every use; it's looked up only when no OAuth
 * account settles the choice.
 */
async function resolveAccount(
  requested: string | undefined,
  ownerEmail: string,
  use: GmailScopeUse = "write",
): Promise<GmailAccount | null> {
  const accounts = (
    await listOAuthAccountsByOwner("google", ownerEmail)
  ).filter((account) => hasGmailScope(account.tokens, use));
  const wanted = requested ?? ownerEmail;
  const match = accounts.find((account) =>
    sameEmail(account.accountId, wanted),
  );
  if (match) return match;

  let managedError: unknown;
  const managed = await getManagedGmailAccountEmail(ownerEmail).catch(
    (error: unknown) => {
      managedError = error;
      return null;
    },
  );
  if (managed && sameEmail(managed, wanted)) {
    return { accountId: managed, tokens: {} };
  }
  if (requested) {
    throw managedError ?? new Error("Account not owned by current user");
  }
  if (accounts[0]) return accounts[0];
  if (managedError) throw managedError;
  return managed ? { accountId: managed, tokens: {} } : null;
}

async function resolveAccountEmail(
  requested: string | undefined,
  ownerEmail: string,
  use: GmailScopeUse = "write",
): Promise<string | null> {
  return (await resolveAccount(requested, ownerEmail, use))?.accountId ?? null;
}

/**
 * Reads the message a reply draft answers, for its reply headers and thread.
 * When `optional`, a message Mail may not read (403) or that's gone (404)
 * comes back null instead of failing the save.
 */
async function readRepliedMessage(
  accessToken: string,
  messageId: string,
  optional: boolean,
) {
  try {
    return await gmailGetMessage(accessToken, messageId, "metadata");
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (optional && (status === 403 || status === 404)) return null;
    throw error;
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

    try {
      await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(args.draftId)}`,
        accessToken,
      );
      return account.accountId;
    } catch (error) {
      if (!(error instanceof Error) || !/\b404\b/.test(error.message)) {
        throw error;
      }
    }
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
  /**
   * A reply draft normally needs to read the message it answers, for its reply
   * headers and thread. With this, one that can't is saved outside the thread
   * instead of not at all, as Mail's composer has always saved drafts.
   */
  replyHeadersOptional?: boolean;
}): Promise<{
  draftId: string;
  accountEmail: string;
  created: boolean;
  updated?: boolean;
} | null> {
  const replyHeadersOptional = args.replyHeadersOptional === true;
  const account = await resolveAccount(
    args.accountEmail,
    args.ownerEmail,
    args.replyToId && !replyHeadersOptional ? "reply" : "write",
  );
  if (!account) return null;
  const accountEmail = account.accountId;
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
  const original = !args.replyToId
    ? null
    : hasGmailScope(account.tokens, "reply")
      ? await readRepliedMessage(
          accessToken,
          args.replyToId,
          replyHeadersOptional,
        )
      : null;
  // Gmail keeps a draft in a thread only with its reply headers, so without
  // them the thread ID is left off too, as the composer's saves always were.
  if (args.replyToId && !original) threadId = undefined;
  if (original) {
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
    try {
      const updated = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${args.draftId}`,
        accessToken,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        },
      );
      return {
        draftId: updated.id,
        accountEmail,
        created: false,
        updated: true,
      };
    } catch (error) {
      if (!(error instanceof Error) || !/\b404\b/.test(error.message)) {
        throw error;
      }
      // A deleted Gmail draft is safe to replace with a new one.
    }
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

  try {
    await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${args.draftId}`,
      accessToken,
      { method: "DELETE" },
    );
  } catch (error) {
    if (!(error instanceof Error) || !/\b404\b/.test(error.message)) {
      throw error;
    }
  }
}
