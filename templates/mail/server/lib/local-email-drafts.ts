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
import { bodyToHtml, resolveComposeAttachments } from "./outgoing-email.js";

function parseAddressList(value: string): EmailAddress[] {
  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ({ name: address, email: address }));
}

export async function updateLocalSavedDraft(args: {
  ownerEmail: string;
  draftId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyToId?: string;
  replyToThreadId?: string;
}): Promise<void> {
  await withLocalEmailMutationLock(args.ownerEmail, async () => {
    const emails = await readLocalEmails(args.ownerEmail);
    const index = emails.findIndex(
      (email) => email.id === args.draftId && email.isDraft,
    );
    if (index < 0) {
      throw new Error(
        `Local saved draft ${args.draftId} no longer exists; it was not recreated.`,
      );
    }

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
    if (!args.replyToId)
      delete (updated as EmailMessage & { replyToId?: string }).replyToId;
    if (!args.replyToThreadId) {
      delete (updated as EmailMessage & { replyToThreadId?: string })
        .replyToThreadId;
    }

    emails[index] = updated;
    await writeLocalEmails(args.ownerEmail, emails);
  });
}

/**
 * Saves a new local mailbox draft, for an owner with no Gmail account, and
 * returns its ID.
 */
export async function createLocalSavedDraft(args: {
  ownerEmail: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: ComposeAttachment[];
  replyToId?: string;
  replyToThreadId?: string;
}): Promise<string> {
  const settings = await readSettings(args.ownerEmail);
  const attachments = await resolveComposeAttachments(
    args.attachments,
    args.ownerEmail,
  );
  return withLocalEmailMutationLock(args.ownerEmail, async () => {
    const emails = await readLocalEmails(args.ownerEmail);
    const cc = parseAddressList(args.cc ?? "");
    const bcc = parseAddressList(args.bcc ?? "");
    const draft: EmailMessage = {
      id: `draft-${nanoid(8)}`,
      threadId:
        (args.replyToId
          ? emails.find((email) => email.id === args.replyToId)?.threadId
          : undefined) ?? `thread-${nanoid(8)}`,
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
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((attachment) => ({
              id: attachment.filename,
              filename: attachment.originalName,
              mimeType: attachment.mimeType,
              size: attachment.size,
              url: attachment.url,
            })),
          }
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
