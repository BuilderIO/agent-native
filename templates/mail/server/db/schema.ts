import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["snooze", "send_later"] }).notNull(),
  emailId: text("email_id"),
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
