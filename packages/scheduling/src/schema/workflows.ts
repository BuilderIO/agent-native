/**
 * Workflows — trigger-based automations ("email attendee 1h before event").
 *
 * Each workflow has a trigger + ordered steps. Steps run on a schedule via
 * the framework's recurring-jobs mechanism: when a booking fires a trigger,
 * we materialize scheduled reminders; a job processes them when due.
 */
import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const workflows = table("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  trigger: text("trigger", {
    enum: [
      "new-booking",
      "before-event",
      "after-event",
      "reschedule",
      "cancellation",
      "no-show",
    ],
  }).notNull(),
  teamId: text("team_id"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  /** JSON array of eventTypeIds this workflow runs on. Empty = none. */
  activeOnEventTypeIds: text("active_on_event_type_ids")
    .notNull()
    .default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const workflowSteps = table("workflow_steps", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull(),
  order: integer("order").notNull().default(0),
  action: text("action", {
    enum: [
      "email-host",
      "email-attendee",
      "email-address",
      "sms-attendee",
      "sms-host",
      "sms-number",
      "webhook",
    ],
  }).notNull(),
  /** Offset in minutes from the trigger. Negative = before (for before-event). */
  offsetMinutes: integer("offset_minutes").notNull().default(0),
  /** Target email / phone / url depending on action */
  sendTo: text("send_to"),
  emailSubject: text("email_subject"),
  emailBody: text("email_body"),
  smsBody: text("sms_body"),
  webhookUrl: text("webhook_url"),
  /** Named template key (e.g. "default-reminder") */
  template: text("template"),
  createdAt: text("created_at").notNull(),
});

/**
 * Materialized reminders waiting to fire.
 * Written by the booking-service hook when a trigger occurs.
 * Drained by a recurring job that processes due rows.
 */
export const scheduledReminders = table("scheduled_reminders", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  workflowStepId: text("workflow_step_id").notNull(),
  method: text("method", {
    enum: ["email", "sms", "webhook"],
  }).notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  sent: integer("sent", { mode: "boolean" }).notNull().default(false),
  sentAt: text("sent_at"),
  failed: integer("failed", { mode: "boolean" }).notNull().default(false),
  failureReason: text("failure_reason"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

/** Outgoing webhook subscriptions. */
export const webhooks = table("webhooks", {
  id: text("id").primaryKey(),
  name: text("name"),
  subscriberUrl: text("subscriber_url").notNull(),
  secret: text("secret"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** JSON array of trigger keys */
  eventTriggers: text("event_triggers").notNull().default("[]"),
  teamId: text("team_id"),
  eventTypeId: text("event_type_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const webhookDeliveries = table("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id").notNull(),
  triggeredAt: text("triggered_at").notNull(),
  payload: text("payload").notNull(),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  success: integer("success", { mode: "boolean" }).notNull().default(false),
  attempts: integer("attempts").notNull().default(0),
});

/** API keys for programmatic access. */
export const apiKeys = table("api_keys", {
  id: text("id").primaryKey(),
  hashedKey: text("hashed_key").notNull().unique(),
  note: text("note"),
  userEmail: text("user_email"),
  teamId: text("team_id"),
  expiresAt: text("expires_at"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
});

export const workflowShares = createSharesTable("workflow_shares");
