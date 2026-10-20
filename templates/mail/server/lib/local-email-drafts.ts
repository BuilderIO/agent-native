import { markdownPreviewSnippet } from "@shared/markdown.js";
import type { EmailAddress, EmailMessage } from "@shared/types.js";

import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";
import { bodyToHtml } from "./outgoing-email.js";

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
