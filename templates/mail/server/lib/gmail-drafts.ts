import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";

import {
  moveGmailAttachments,
  type GmailAttachmentRef,
  type MovedGmailAttachment,
} from "../../shared/compose-attachments.js";
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
import {
  buildRawEmail,
  mimeAttachmentFilename,
  resolveComposeAttachments,
  type ResolvedComposeAttachment,
} from "./outgoing-email.js";

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

  let managed: string | null = null;
  let managedError: Error | undefined;
  try {
    managed = await getManagedGmailAccountEmail(ownerEmail);
  } catch (error) {
    managedError =
      error instanceof Error
        ? error
        : new Error(
            `Could not look up the workspace's Gmail connection: ${String(error)}`,
          );
  }
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
  const account = await resolveAccount(requested, ownerEmail, use);
  return account ? account.accountId : null;
}

/** Throws unless the owner can save drafts to `accountEmail`. */
export async function assertGmailDraftAccount(
  accountEmail: string,
  ownerEmail: string,
): Promise<void> {
  await resolveAccount(accountEmail, ownerEmail);
}

const googleStatus = (error: unknown) =>
  (error as { status?: unknown } | null)?.status;

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
    const status = googleStatus(error);
    if (optional && (status === 403 || status === 404)) return null;
    throw error;
  }
}

const isNotFound = (error: unknown) => googleStatus(error) === 404;

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

const gmailDraftUrl = (draftId: string, query?: Record<string, string>) =>
  `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}${query ? `?${new URLSearchParams(query)}` : ""}`;

type GmailFilePart = {
  filename?: unknown;
  body?: { attachmentId?: unknown; size?: unknown };
};

const draftPartsQuery = {
  format: "full",
  fields: "message(id,payload(parts(filename,body(attachmentId,size))))",
};

const fitsBelow = (value: string, limit: number) =>
  Array.from(value).every((char) => char.charCodeAt(0) < limit);

function decodedFilenames(reported: string): string[] {
  const names = [reported];
  if (fitsBelow(reported, 0x100)) {
    names.push(Buffer.from(reported, "latin1").toString("utf8"));
  }
  const words = /=\?utf-8\?([bq])\?([^?]*)\?=/gi;
  if (words.test(reported)) {
    names.push(
      reported.replace(words, (_word, encoding: string, text: string) =>
        encoding.toLowerCase() === "b"
          ? Buffer.from(text, "base64").toString("utf8")
          : Buffer.from(
              text
                .replace(/_/g, " ")
                .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) =>
                  String.fromCharCode(parseInt(hex, 16)),
                ),
              "latin1",
            ).toString("utf8"),
      ),
    );
  }
  return names;
}

function isSentFilename(reported: unknown, sent: string): boolean {
  if (typeof reported !== "string") return false;
  if (reported === sent) return true;
  if (fitsBelow(sent, 0x80)) return false;
  const expected = sent.normalize("NFC");
  return decodedFilenames(reported).some(
    (name) => name.normalize("NFC") === expected,
  );
}

export function savedDraftAttachmentReader(
  { accountEmail, accessToken }: { accountEmail: string; accessToken: string },
  savedDraftId: string | undefined,
  attachments: unknown,
  read: (attachment: ComposeAttachment) => Promise<Buffer | null>,
): {
  readGmailAttachment: (
    attachment: ComposeAttachment,
  ) => Promise<Buffer | null>;
  moved: MovedGmailAttachment[];
} {
  const moved: MovedGmailAttachment[] = [];
  const saved = Array.isArray(attachments)
    ? (attachments as ComposeAttachment[])
    : [];
  let draft: ReturnType<typeof readDraftParts> | undefined;
  const readDraftParts = (draftId: string) =>
    withSavedGmailDraft(accessToken, draftId, (id) =>
      googleFetch(gmailDraftUrl(id, draftPartsQuery), accessToken),
    );

  const findInDraft = async (
    draftId: string,
    attachment: ComposeAttachment,
  ): Promise<Buffer | null> => {
    const { gmailMessageId, gmailAttachmentId } = attachment;
    if (!gmailMessageId || !gmailAttachmentId) return null;
    const found = await (draft ??= readDraftParts(draftId));
    const messageId: unknown = found?.result?.message?.id;
    const parts: unknown = found?.result?.message?.payload?.parts;
    if (typeof messageId !== "string" || messageId === gmailMessageId) {
      return null;
    }
    try {
      await gmailGetMessage(accessToken, gmailMessageId, "minimal");
      return null;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const sentName = mimeAttachmentFilename(attachment);
    const sameFile = (other: ComposeAttachment) =>
      mimeAttachmentFilename(other) === sentName &&
      other.size === attachment.size;
    const matches = (
      Array.isArray(parts) ? (parts as (GmailFilePart | null)[]) : []
    ).flatMap((part) => {
      const attachmentId = part?.body?.attachmentId;
      return typeof attachmentId === "string" &&
        isSentFilename(part?.filename, sentName) &&
        part?.body?.size === attachment.size
        ? [{ attachmentId, size: attachment.size }]
        : [];
    });
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match || saved.filter(sameFile).length !== 1) {
      throw new Error(
        `Mail couldn't tell which file in the Gmail draft is "${attachment.filename}".`,
      );
    }
    const result = await gmailGetAttachment(
      accessToken,
      messageId,
      match.attachmentId,
    );
    const data =
      typeof result?.data === "string"
        ? Buffer.from(result.data, "base64url")
        : null;
    if (!data || data.length !== match.size) {
      throw new Error(
        `Mail couldn't read "${attachment.filename}" from the Gmail draft.`,
      );
    }
    moved.push({
      from: { gmailMessageId, gmailAttachmentId },
      to: { gmailMessageId: messageId, gmailAttachmentId: match.attachmentId },
    });
    return data;
  };

  return {
    moved,
    readGmailAttachment: async (attachment) => {
      const draftId =
        attachment.accountEmail &&
        !sameEmail(attachment.accountEmail, accountEmail)
          ? undefined
          : savedDraftId;
      let data: Buffer | null;
      try {
        data = await read(attachment);
      } catch (error) {
        if (!draftId || !isNotFound(error)) throw error;
        data = null;
      }
      if (data || !draftId) return data;
      return findInDraft(draftId, attachment);
    },
  };
}

async function readMovedDraftAttachments(
  accessToken: string,
  draftId: string,
  attachments: ResolvedComposeAttachment[],
  moves: (attachment: ResolvedComposeAttachment) => boolean,
): Promise<MovedGmailAttachment[]> {
  const draft = await googleFetch(
    gmailDraftUrl(draftId, draftPartsQuery),
    accessToken,
  );
  const messageId: unknown = draft?.message?.id;
  const parts: unknown = draft?.message?.payload?.parts;
  const fileParts = Array.isArray(parts) ? parts.slice(1) : [];
  if (
    typeof messageId !== "string" ||
    fileParts.length !== attachments.length
  ) {
    throw new Error("its attachments don't match the ones Mail sent");
  }
  return attachments.flatMap((attachment, index) => {
    const { gmailMessageId, gmailAttachmentId } = attachment;
    if (
      attachment.source !== "gmail" ||
      !gmailMessageId ||
      !gmailAttachmentId ||
      !moves(attachment)
    ) {
      return [];
    }
    const part: GmailFilePart | undefined = fileParts[index];
    if (
      !isSentFilename(part?.filename, mimeAttachmentFilename(attachment)) ||
      part?.body?.size !== attachment.data.length ||
      typeof part.body.attachmentId !== "string"
    ) {
      throw new Error(
        `its copy of "${attachment.filename}" doesn't match the one Mail sent`,
      );
    }
    return [
      {
        from: { gmailMessageId, gmailAttachmentId },
        to: {
          gmailMessageId: messageId,
          gmailAttachmentId: part.body.attachmentId,
        },
      },
    ];
  });
}

const sameRef = (a: GmailAttachmentRef, b: GmailAttachmentRef) =>
  a.gmailMessageId === b.gmailMessageId &&
  a.gmailAttachmentId === b.gmailAttachmentId;

function followMoves(
  first: readonly MovedGmailAttachment[],
  then: readonly MovedGmailAttachment[],
): MovedGmailAttachment[] {
  return [
    ...first.map((move) => {
      const next = then.find(({ from }) => sameRef(from, move.to));
      return next ? { from: move.from, to: next.to } : move;
    }),
    ...then.filter(({ from }) => !first.some(({ to }) => sameRef(to, from))),
  ];
}

type SavedGmailDraft = {
  draftId: string;
  movedAttachments: MovedGmailAttachment[];
  attachmentsError?: Error;
};

async function savedWithMoves(
  accessToken: string,
  draftId: string,
  attachments: ResolvedComposeAttachment[],
  found: readonly MovedGmailAttachment[],
  moves: (attachment: ResolvedComposeAttachment) => boolean,
): Promise<SavedGmailDraft> {
  if (
    !attachments.some(
      (attachment) => attachment.source === "gmail" && moves(attachment),
    )
  ) {
    return { draftId, movedAttachments: [...found] };
  }
  try {
    return {
      draftId,
      movedAttachments: followMoves(
        found,
        await readMovedDraftAttachments(
          accessToken,
          draftId,
          attachments,
          moves,
        ),
      ),
    };
  } catch (error) {
    return {
      draftId,
      movedAttachments: [],
      attachmentsError: new Error(
        `Gmail saved the draft, but Mail couldn't confirm where its attachments moved (${error instanceof Error ? error.message : String(error)}). Saving the draft again finds them.`,
      ),
    };
  }
}

export async function updateSavedGmailDraft(
  accessToken: string,
  savedDraftId: string,
  message: { raw: string; threadId?: string },
  attachments: ResolvedComposeAttachment[],
  found: readonly MovedGmailAttachment[] = [],
): Promise<SavedGmailDraft | null> {
  const readsGmail = attachments.some(
    (attachment) => attachment.source === "gmail",
  );
  const updated = await withSavedGmailDraft(
    accessToken,
    savedDraftId,
    async (draftId) => {
      const replacedMessageId: unknown = readsGmail
        ? (
            await googleFetch(
              gmailDraftUrl(draftId, {
                format: "minimal",
                fields: "message/id",
              }),
              accessToken,
            )
          )?.message?.id
        : undefined;
      const draft = await googleFetch(gmailDraftUrl(draftId), accessToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      return { draftId: draft.id as string, replacedMessageId };
    },
  );
  if (!updated) return null;
  const { draftId, replacedMessageId } = updated.result;
  if (typeof replacedMessageId !== "string") {
    return { draftId, movedAttachments: [...found] };
  }
  return savedWithMoves(
    accessToken,
    draftId,
    attachments,
    found,
    (attachment) => attachment.gmailMessageId === replacedMessageId,
  );
}

export async function createGmailDraft(
  accessToken: string,
  accountEmail: string,
  message: { raw: string; threadId?: string },
  replacing?: {
    attachments: ResolvedComposeAttachment[];
    found: readonly MovedGmailAttachment[];
  },
): Promise<SavedGmailDraft> {
  const created = await googleFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
  const draftId = created.id as string;
  if (!replacing) return { draftId, movedAttachments: [] };
  return savedWithMoves(
    accessToken,
    draftId,
    replacing.attachments,
    replacing.found,
    (attachment) =>
      !attachment.accountEmail ||
      sameEmail(attachment.accountEmail, accountEmail),
  );
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
  accountEmail?: string | undefined;
  draftId?: string;
  to: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  subject: string;
  body: string;
  attachments?: ComposeAttachment[];
  replyToId?: string | undefined;
  replyToThreadId?: string | undefined;
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
  movedAttachments?: MovedGmailAttachment[];
  attachmentsError?: Error;
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

  const reader = savedDraftAttachmentReader(
    { accountEmail, accessToken },
    args.draftId,
    args.attachments,
    async (attachment) => {
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
      const { gmailMessageId, gmailAttachmentId } = attachment;
      if (!attachmentAccessToken || !gmailMessageId || !gmailAttachmentId) {
        return null;
      }
      const result = await gmailGetAttachment(
        attachmentAccessToken,
        gmailMessageId,
        gmailAttachmentId,
      );
      return typeof result?.data === "string"
        ? Buffer.from(result.data, "base64url")
        : null;
    },
  );
  const attachments = moveGmailAttachments(
    await resolveComposeAttachments(args.attachments, args.ownerEmail, {
      readGmailAttachment: reader.readGmailAttachment,
    }),
    reader.moved,
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
    const updated = await updateSavedGmailDraft(
      accessToken,
      args.draftId,
      message,
      attachments,
      reader.moved,
    );
    if (updated) {
      return {
        draftId: updated.draftId,
        accountEmail,
        created: false,
        updated: true,
        ...(updated.movedAttachments.length
          ? { movedAttachments: updated.movedAttachments }
          : {}),
        ...(updated.attachmentsError
          ? { attachmentsError: updated.attachmentsError }
          : {}),
      };
    }
  }
  const created = await createGmailDraft(
    accessToken,
    accountEmail,
    message,
    args.draftId ? { attachments, found: reader.moved } : undefined,
  );
  return {
    draftId: created.draftId,
    accountEmail,
    created: true,
    ...(created.movedAttachments.length
      ? { movedAttachments: created.movedAttachments }
      : {}),
    ...(created.attachmentsError
      ? { attachmentsError: created.attachmentsError }
      : {}),
  };
}

export async function deleteGmailDraft(args: {
  ownerEmail: string;
  accountEmail?: string | undefined;
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
