export type EmailAddress = {
  name: string;
  email: string;
};

export type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type EmailMessage = {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  snippet: string;
  body: string;
  bodyHtml?: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
  isDraft?: boolean;
  isSent?: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  labelIds: string[];
  attachments?: Attachment[];
};

export type EmailThread = {
  id: string;
  subject: string;
  messages: EmailMessage[];
  participants: EmailAddress[];
  snippet: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  labelIds: string[];
  messageCount: number;
};

export type Label = {
  id: string;
  name: string;
  color?: string;
  type: "system" | "user";
  unreadCount?: number;
};

export type ComposeData = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyToId?: string;
  replyToThreadId?: string;
};

export type MailboxView =
  | "inbox"
  | "starred"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "all"
  | `label:${string}`;

export type UserSettings = {
  name: string;
  email: string;
  avatar?: string;
  signature?: string;
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable" | "spacious";
  previewPane: "right" | "bottom" | "off";
  sendAndArchive: boolean;
  undoSendDelay: number;
};
