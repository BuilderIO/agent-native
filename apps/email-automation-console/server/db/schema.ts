import { table, text } from "@agent-native/core/db/schema";

export const emailAutomations = table("email_automations", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  recipient: text("recipient").notNull(),
  prompt: text("prompt").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const emailAutomationRuns = table("email_automation_runs", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  automationId: text("automation_id").notNull(),
  recipient: text("recipient").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  errorMessage: text("error_message"),
  subject: text("subject").notNull(),
  previewIntro: text("preview_intro").notNull(),
  previewItems: text("preview_items").notNull(),
  promptSnapshot: text("prompt_snapshot").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});
