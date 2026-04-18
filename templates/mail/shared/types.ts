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
  accountEmail?: string;
  /** Parsed List-Unsubscribe header info */
  unsubscribe?: {
    /** HTTPS URL for unsubscribe page */
    url?: string;
    /** mailto: address for unsubscribe */
    mailto?: string;
    /** Whether RFC 8058 one-click unsubscribe is supported */
    oneClick?: boolean;
  };
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
  totalCount?: number;
};

export type ComposeAttachment = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
};

export type ComposeState = {
  id: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  mode: "compose" | "reply" | "forward";
  replyToId?: string;
  replyToThreadId?: string;
  attachments?: ComposeAttachment[];
  /** ID of the persistent draft email (for updating existing drafts) */
  savedDraftId?: string;
  /** Which connected account to send from (for multi-inbox reply) */
  accountEmail?: string;
  /** When true, render inline in the thread view instead of the popout composer */
  inline?: boolean;
};

export type MailboxView =
  | "inbox"
  | "starred"
  | "sent"
  | "drafts"
  | "snoozed"
  | "scheduled"
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
  pinnedLabels?: string[];
  /** Display aliases for label tabs — maps label ID to custom short name */
  labelAliases?: Record<string, string>;
  /** "show" = load all images, "block-trackers" = block known trackers only, "block-all" = block all remote images */
  imagePolicy?: "show" | "block-trackers" | "block-all";
  /** Senders whose images are always loaded even when imagePolicy is "block-all" */
  trustedSenders?: string[];
  /** Actions shown in the mobile bottom action bar (detail view). Order matters. */
  mobileActions?: MobileActionId[];
  /** Email tracking preferences — opens and link clicks on sent messages */
  tracking?: { opens: boolean; clicks: boolean };
};

export type EmailTrackingStats = {
  opens: number;
  firstOpenedAt?: number;
  lastOpenedAt?: number;
  linkClicks: {
    url: string;
    count: number;
    firstClickedAt?: number;
    lastClickedAt?: number;
  }[];
  totalClicks: number;
};

/** Identifiers for actions available in the mobile bottom bar */
export type MobileActionId =
  | "archive"
  | "trash"
  | "star"
  | "reply"
  | "replyAll"
  | "forward"
  | "markUnread"
  | "prev"
  | "next";

export type Alias = {
  id: string;
  name: string;
  emails: string[];
  createdAt: string;
  updatedAt: string;
};

// ─── Automation types ─────────────────────────────────────────────────────────

export type AutomationAction =
  | { type: "label"; labelName: string }
  | { type: "archive" }
  | { type: "mark_read" }
  | { type: "star" }
  | { type: "trash" };

export type AutomationRule = {
  id: string;
  ownerEmail: string;
  domain: "mail" | "calendar";
  name: string;
  condition: string;
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ApolloPersonResult = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  photo_url?: string;
  linkedin_url?: string;
  twitter_url?: string;
  github_url?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone_numbers?: { raw_number: string; type?: string }[];
  employment_history?: {
    organization_name?: string;
    title?: string;
    start_date?: string;
    end_date?: string;
    current?: boolean;
  }[];
  organization?: {
    name?: string;
    website_url?: string;
    linkedin_url?: string;
    logo_url?: string;
    industry?: string;
    estimated_num_employees?: number;
    short_description?: string;
    founded_year?: number;
  };
};
