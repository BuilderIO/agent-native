import { table, text, integer, index } from "@agent-native/core/db/schema";

/**
 * Short-lived, owner-scoped continuation state for the external Mail
 * inventory. It intentionally contains compact metadata only; credentials,
 * bodies, HTML and attachments never enter this table.
 */
export const mailInventoryCursors = table("mail_inventory_cursors", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  queryFingerprint: text("query_fingerprint").notNull(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(1),
  claimId: text("claim_id"),
  claimedAt: integer("claimed_at"),
  expiresAt: integer("expires_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const scheduledJobs = table("scheduled_jobs", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["snooze", "send_later"] }).notNull(),
  ownerEmail: text("owner_email"),
  emailId: text("email_id"),
  threadId: text("thread_id"),
  accountEmail: text("account_email"),
  payload: text("payload").notNull(),
  runAt: integer("run_at").notNull(),
  status: text("status", {
    enum: ["pending", "processing", "done", "cancelled"],
  })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const contactFrequency = table("contact_frequency", {
  id: text("id").primaryKey(), // ownerEmail:contactEmail
  ownerEmail: text("owner_email").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactName: text("contact_name").notNull().default(""),
  sendCount: integer("send_count").notNull().default(0),
  receiveCount: integer("receive_count").notNull().default(0),
  lastContactedAt: integer("last_contacted_at").notNull(),
});

export const automationRules = table("automation_rules", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  domain: text("domain").notNull(), // "mail" | "calendar"
  kind: text("kind", { enum: ["automation", "ai-filter"] })
    .notNull()
    .default("automation"),
  name: text("name").notNull(),
  condition: text("condition").notNull(), // natural language condition
  actions: text("actions").notNull(), // JSON array of AutomationAction
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const emailTracking = table("email_tracking", {
  pixelToken: text("pixel_token").primaryKey(),
  messageId: text("message_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  sentAt: integer("sent_at").notNull(),
  opensCount: integer("opens_count").notNull().default(0),
  firstOpenedAt: integer("first_opened_at"),
  lastOpenedAt: integer("last_opened_at"),
  lastUserAgent: text("last_user_agent"),
});

export const emailLinkTracking = table("email_link_tracking", {
  clickToken: text("click_token").primaryKey(),
  pixelToken: text("pixel_token").notNull(),
  url: text("url").notNull(),
  clicksCount: integer("clicks_count").notNull().default(0),
  firstClickedAt: integer("first_clicked_at"),
  lastClickedAt: integer("last_clicked_at"),
});

export const snippets = table("snippets", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Per-account Gmail sync watermark for the inbox store. One row per
 * `${ownerEmail}:${accountEmail}`. `historyId` null means the account hasn't
 * completed its first full sync yet; the `full_sync_*` columns track a
 * resumable full-sync page walk.
 */
export const mailSyncAccounts = table(
  "mail_sync_accounts",
  {
    id: text("id").primaryKey(), // `${owner}:${account}` lowercased
    ownerEmail: text("owner_email").notNull(),
    accountEmail: text("account_email").notNull(),
    historyId: text("history_id"),
    fullSyncPageToken: text("full_sync_page_token"),
    fullSyncHistoryId: text("full_sync_history_id"),
    fullSyncStartedAt: integer("full_sync_started_at"),
    status: text("status", {
      enum: ["idle", "syncing", "error", "needs_reauth"],
    })
      .notNull()
      .default("idle"),
    lastError: text("last_error"),
    lastSyncedAt: integer("last_synced_at"),
    syncClaimId: text("sync_claim_id"),
    syncClaimedAt: integer("sync_claimed_at"),
    // Compact cached labels.list result: [{id,name,type,color?,messagesTotal?,
    // messagesUnread?,threadsTotal?,threadsUnread?}]
    labelsJson: text("labels_json"),
    labelsUpdatedAt: integer("labels_updated_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("mail_sync_accounts_owner_idx").on(t.ownerEmail)],
);

/**
 * SQL mirror of each connected account's INBOX threads, kept fresh by
 * `server/lib/inbox-sync.ts`. Metadata only — no bodies, no HTML.
 */
export const mailInboxThreads = table(
  "mail_inbox_threads",
  {
    id: text("id").primaryKey(), // `${owner}:${account}:${threadId}` lowercased owner/account
    ownerEmail: text("owner_email").notNull(),
    accountEmail: text("account_email").notNull(),
    threadId: text("thread_id").notNull(),
    historyId: text("history_id"),
    inInbox: integer("in_inbox").notNull(),
    isUnread: integer("is_unread"),
    isStarred: integer("is_starred"),
    isImportant: integer("is_important"),
    isAutomated: integer("is_automated"),
    latestDate: integer("latest_date").notNull(),
    latestMessageId: text("latest_message_id"),
    subject: text("subject"),
    snippet: text("snippet"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    toJson: text("to_json"), // JSON [{name,email}] of the classified message
    labelIdsJson: text("label_ids_json").notNull(), // JSON string[] union across non-draft messages
    messageIdsJson: text("message_ids_json").notNull(), // JSON string[] all message ids
    messageCount: integer("message_count"),
    unreadCount: integer("unread_count"),
    hasAttachments: integer("has_attachments"),
    syncedAt: integer("synced_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("mail_inbox_threads_owner_inbox_date_idx").on(
      t.ownerEmail,
      t.inInbox,
      t.latestDate,
    ),
    index("mail_inbox_threads_owner_account_idx").on(
      t.ownerEmail,
      t.accountEmail,
    ),
  ],
);

export const queuedEmailDrafts = table("queued_email_drafts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  requesterEmail: text("requester_email").notNull(),
  requesterName: text("requester_name"),
  toRecipients: text("to_recipients").notNull(),
  ccRecipients: text("cc_recipients"),
  bccRecipients: text("bcc_recipients"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  context: text("context"),
  source: text("source").notNull().default("agent"),
  sourceThreadId: text("source_thread_id"),
  accountEmail: text("account_email"),
  composeId: text("compose_id"),
  sentMessageId: text("sent_message_id"),
  sendClaimId: text("send_claim_id"),
  sendClaimedAt: integer("send_claimed_at"),
  status: text("status", {
    enum: ["queued", "in_review", "sent", "dismissed"],
  })
    .notNull()
    .default("queued"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  sentAt: integer("sent_at"),
});
