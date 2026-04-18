import { table, text, integer } from "@agent-native/core/db/schema";

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
