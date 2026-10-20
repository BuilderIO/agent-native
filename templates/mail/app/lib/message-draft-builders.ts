import type {
  ComposeAttachment,
  ComposeState,
  EmailMessage,
} from "@shared/types";

function findReplyAccount(
  message: EmailMessage,
  ownerEmails: ReadonlySet<string>,
): string | undefined {
  if (message.accountEmail) return message.accountEmail;
  const recipients = [
    ...message.to.map((recipient) => recipient.email.toLowerCase()),
    ...(message.cc ?? []).map((recipient) => recipient.email.toLowerCase()),
  ];
  return recipients.find((email) => ownerEmails.has(email));
}

function quoteReply(message: EmailMessage): string {
  return `\n\n\n\n— On ${new Date(message.date).toLocaleDateString()}, ${message.from.name || message.from.email} wrote:\n\n${message.body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;
}

function subjectWithPrefix(subject: string, prefix: "Re:" | "Fwd:") {
  return subject.startsWith(prefix) ? subject : `${prefix} ${subject}`;
}

function originalAttachments(message: EmailMessage): ComposeAttachment[] {
  return (message.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    originalName: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: `/api/attachments?messageId=${encodeURIComponent(message.id)}&id=${encodeURIComponent(attachment.id)}&mimeType=${encodeURIComponent(attachment.mimeType)}`,
    source: "gmail" as const,
    gmailMessageId: message.id,
    gmailAttachmentId: attachment.id,
    accountEmail: message.accountEmail,
  }));
}

export function buildReplyDraft(
  message: EmailMessage,
  ownerEmails: ReadonlySet<string>,
  {
    replyAll = false,
    inline = false,
  }: { replyAll?: boolean; inline?: boolean } = {},
): Omit<ComposeState, "id"> {
  const fromOwner = ownerEmails.has(message.from.email.toLowerCase());
  let recipients: string[];
  if (replyAll) {
    const allRecipients = [
      ...(fromOwner ? [] : [message.from.email]),
      ...message.to.map((recipient) => recipient.email),
      ...(message.cc ?? []).map((recipient) => recipient.email),
    ];
    recipients = [
      ...new Set(
        allRecipients
          .map((email) => email.toLowerCase())
          .filter((email) => !ownerEmails.has(email)),
      ),
    ];
  } else {
    recipients = [
      fromOwner
        ? (message.to[0]?.email ?? message.from.email)
        : message.from.email,
    ];
  }

  const draft: Omit<ComposeState, "id"> = {
    to: recipients.join(", "),
    subject: subjectWithPrefix(message.subject, "Re:"),
    body: quoteReply(message),
    mode: "reply",
    replyToId: message.id,
    replyToThreadId: message.threadId,
    accountEmail: findReplyAccount(message, ownerEmails),
  };
  if (inline) draft.inline = true;
  return draft;
}

export function buildForwardDraft(
  message: EmailMessage,
  ownerEmails: ReadonlySet<string>,
  { inline = false }: { inline?: boolean } = {},
): Omit<ComposeState, "id"> {
  const draft: Omit<ComposeState, "id"> = {
    to: "",
    subject: subjectWithPrefix(message.subject, "Fwd:"),
    body: `\n\n\n\n— Forwarded message —\nFrom: ${message.from.name} <${message.from.email}>\n\n${message.body}`,
    mode: "forward",
    replyToId: message.id,
    replyToThreadId: message.threadId,
    accountEmail: findReplyAccount(message, ownerEmails),
    attachments: originalAttachments(message),
  };
  if (inline) draft.inline = true;
  return draft;
}
