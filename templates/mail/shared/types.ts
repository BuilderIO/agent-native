export type EmailAddress = {
  name: string;
  email: string;
};

export type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url?: string;
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
  unsubscribe?: {
    url?: string;
    mailto?: string;
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
  source?: "upload" | "gmail";
  gmailMessageId?: string;
  gmailAttachmentId?: string;
  accountEmail?: string;
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
  savedDraftId?: string;
  savedDraftBackend?: "gmail" | "local";
  savedDraftAccountEmail?: string;
  accountEmail?: string;
  inline?: boolean;
  queuedDraftId?: string;
  queuedDraftRequesterEmail?: string;
  queuedDraftContext?: string;
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

export type SavedMailFilter = {
  id: string;
  name: string;
  query: string;
};

export type UserSettings = {
  name: string;
  email: string;
  avatar?: string;
  signature?: string;
  writingStyle?: string;
  autocompleteEnabled?: boolean;
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable" | "spacious";
  previewPane: "right" | "bottom" | "off";
  sendAndArchive: boolean;
  combineInbox: boolean;
  showAllTab?: boolean;
  sortMode?: "newest" | "priority";
  aiSetupCompleted?: boolean;
  undoSendDelay: number;
  pinnedLabels?: string[];
  savedFilters?: SavedMailFilter[];
  labelAliases?: Record<string, string>;
  imagePolicy?: "show" | "block-trackers" | "block-all";
  trustedSenders?: string[];
  mobileActions?: MobileActionId[];
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

export type MobileActionId =
  | "archive"
  | "aiFilter"
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
  kind?: "automation" | "ai-filter";
  name: string;
  condition: string;
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};


export type GmailFilterCriteria = {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: "smaller" | "larger" | "unspecified";
};

export type GmailFilterAction = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
};

export type ManagedGmailFilter = {
  id: string;
  accountEmail: string;
  criteria: GmailFilterCriteria;
  action: GmailFilterAction;
  criteriaSummary: string;
  actionSummary: string;
  actionLabels: Array<{
    id: string;
    name: string;
    type?: string;
    operation: "add" | "remove";
  }>;
};

export type ManagedGmailFiltersAccount = {
  accountEmail: string;
  filters: ManagedGmailFilter[];
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
