import { markdownPreviewSnippet } from "@shared/markdown.js";
import type {
  ComposeAttachment,
  EmailAddress,
  EmailMessage,
} from "@shared/types.js";
import { nanoid } from "nanoid";

import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";
import { readSettings } from "./mail-settings.js";
import { bodyToHtml } from "./outgoing-email.js";

function parseAddressList(value: string): EmailAddress[] {
  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ({ name: address, email: address }));
}

// What a local copy lists of each attachment. Only Mail's copy sends, so the
// bytes are read then, not on every save of this one.
function localAttachments(
  attachments: ComposeAttachment[],
): NonNullable<EmailMessage["attachments"]> {
  return attachments.map((attachment) => ({
    id: attachment.filename,
    filename: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: attachment.url,
  }));
}

/**
 * Rewrites a local mailbox draft, and returns false if it no longer exists.
 * `attachments`, when given, replace the draft's; left out, the draft keeps the
 * ones it has.
 */
export async function updateLocalSavedDraft(args: {
  ownerEmail: string;
  draftId: string;
  to: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  subject: string;
  body: string;
  attachments?: ComposeAttachment[];
  replyToId?: string | undefined;
  replyToThreadId?: string | undefined;
}): Promise<boolean> {
  return withLocalEmailMutationLock(args.ownerEmail, async () => {
    const emails = await readLocalEmails(args.ownerEmail);
    const index = emails.findIndex(
      (email) => email.id === args.draftId && email.isDraft,
    );
    if (index < 0) return false;

    const current = emails[index];
    const updated: EmailMessage = {
      ...current,
      to: parseAddressList(args.to),
      cc: parseAddressList(args.cc ?? ""),
      bcc: parseAddressList(args.bcc ?? ""),
      subject: args.subject || "(no subject)",
      snippet: markdownPreviewSnippet(args.body),
      body: args.body,
      bodyHtml: bodyToHtml(args.body),
      date: new Date().toISOString(),
      isDraft: true,
      labelIds: current.labelIds.includes("drafts")
        ? current.labelIds
        : [...current.labelIds, "drafts"],
      ...(args.replyToId ? { replyToId: args.replyToId } : {}),
      ...(args.replyToThreadId
        ? { replyToThreadId: args.replyToThreadId }
        : {}),
    };

    if (!args.cc?.trim()) updated.cc = undefined;
    if (!args.bcc?.trim()) updated.bcc = undefined;
    if (args.attachments?.length) {
      updated.attachments = localAttachments(args.attachments);
    } else if (args.attachments) {
      delete updated.attachments;
    }
    if (!args.replyToId)
      delete (updated as EmailMessage & { replyToId?: string }).replyToId;
    if (!args.replyToThreadId) {
      delete (updated as EmailMessage & { replyToThreadId?: string })
        .replyToThreadId;
    }

    emails[index] = updated;
    await writeLocalEmails(args.ownerEmail, emails);
    return true;
  });
}

/**
 * Saves a new local mailbox draft, for an owner with no Gmail account, and
 * returns its ID.
 */
export async function createLocalSavedDraft(args: {
  ownerEmail: string;
  to: string;
  cc?: string | undefined;
  bcc?: string | undefined;
  subject: string;
  body: string;
  attachments?: ComposeAttachment[];
  replyToId?: string | undefined;
  replyToThreadId?: string | undefined;
}): Promise<string> {
  const settings = await readSettings(args.ownerEmail);
  return withLocalEmailMutationLock(args.ownerEmail, async () => {
    const emails = await readLocalEmails(args.ownerEmail);
    const cc = parseAddressList(args.cc ?? "");
    const bcc = parseAddressList(args.bcc ?? "");
    const draft: EmailMessage = {
      id: `draft-${nanoid(8)}`,
      threadId:
        (args.replyToId
          ? emails.find((email) => email.id === args.replyToId)?.threadId
          : undefined) ??
        args.replyToThreadId ??
        `thread-${nanoid(8)}`,
      from: { name: settings.name, email: settings.email },
      to: parseAddressList(args.to),
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      subject: args.subject || "(no subject)",
      snippet: markdownPreviewSnippet(args.body),
      body: args.body,
      bodyHtml: bodyToHtml(args.body),
      date: new Date().toISOString(),
      isRead: true,
      isStarred: false,
      isDraft: true,
      isArchived: false,
      isTrashed: false,
      labelIds: ["drafts"],
      ...(args.attachments?.length
        ? { attachments: localAttachments(args.attachments) }
        : {}),
      ...(args.replyToId ? { replyToId: args.replyToId } : {}),
      ...(args.replyToThreadId
        ? { replyToThreadId: args.replyToThreadId }
        : {}),
    };
    emails.push(draft);
    await writeLocalEmails(args.ownerEmail, emails);
    return draft.id;
  });
}

/** Removes a local mailbox draft; one already gone counts as removed. */
export async function deleteLocalSavedDraft(args: {
  ownerEmail: string;
  draftId: string;
}): Promise<void> {
  await withLocalEmailMutationLock(args.ownerEmail, async () => {
    const emails = await readLocalEmails(args.ownerEmail);
    const remaining = emails.filter(
      (email) => !(email.id === args.draftId && email.isDraft),
    );
    if (remaining.length !== emails.length) {
      await writeLocalEmails(args.ownerEmail, remaining);
    }
  });
}
