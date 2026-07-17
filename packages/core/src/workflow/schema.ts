import { integer, table, text } from "../db/schema.js";

export const workflowEvents = table("workflow_events", {
  id: text("id").primaryKey(),
  eventSequence: integer("event_sequence").notNull(),
  topic: text("topic").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  subjectKey: text("subject_key").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  payload: text("payload").notNull(),
  actorContext: text("actor_context").notNull(),
  causalEventId: text("causal_event_id"),
  occurredAt: integer("occurred_at").notNull(),
  availableAt: integer("available_at").notNull(),
  createdAt: integer("created_at").notNull(),
  materializedAt: integer("materialized_at"),
});

export const workflowMaterializationBacklog = table(
  "workflow_materialization_backlog",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    subscriptionVersion: integer("subscription_version").notNull(),
    subjectKey: text("subject_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
);

export const workflowSubscriptions = table("workflow_subscriptions", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["deterministic", "agentic"] }).notNull(),
  eventPattern: text("event_pattern").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  config: text("config").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const workflowSubscriptionVersions = table(
  "workflow_subscription_versions",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").notNull(),
    version: integer("version").notNull(),
    kind: text("kind", { enum: ["deterministic", "agentic"] }).notNull(),
    eventPattern: text("event_pattern").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    config: text("config").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    activeAfterSequence: integer("active_after_sequence").notNull(),
    activeAt: integer("active_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
);

export const workflowSequenceCounters = table("workflow_sequence_counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull(),
});

export const workflowVirtualProviderState = table(
  "workflow_virtual_provider_state",
  {
    providerId: text("provider_id").primaryKey(),
    evaluationStartSequence: integer("evaluation_start_sequence").notNull(),
    createdAt: integer("created_at").notNull(),
  },
);

export const workflowExecutions = table("workflow_executions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  subscriptionId: text("subscription_id").notNull(),
  subscriptionVersion: integer("subscription_version"),
  subjectKey: text("subject_key").notNull(),
  status: text("status", {
    enum: [
      "pending",
      "running",
      "succeeded",
      "failed",
      "retrying",
      "unknown",
      "acknowledged",
    ],
  }).notNull(),
  attempt: integer("attempt").notNull(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: integer("lease_expires_at"),
  fenceVersion: integer("fence_version").notNull(),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
});

export const workflowScheduledWork = table("workflow_scheduled_work", {
  id: text("id").primaryKey(),
  workType: text("work_type").notNull(),
  subjectKey: text("subject_key").notNull(),
  eventId: text("event_id"),
  subscriptionId: text("subscription_id"),
  payload: text("payload").notNull(),
  dedupeKey: text("dedupe_key"),
  dueAt: integer("due_at").notNull(),
  status: text("status", {
    enum: [
      "pending",
      "running",
      "completed",
      "cancelled",
      "failed",
      "dead_letter",
    ],
  }).notNull(),
  attempt: integer("attempt").notNull(),
  leaseToken: text("lease_token"),
  leaseExpiresAt: integer("lease_expires_at"),
  fenceVersion: integer("fence_version").notNull(),
  errorMessage: text("error_message"),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const workflowEffects = table("workflow_effects", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").notNull(),
  kind: text("kind").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status", {
    enum: [
      "delivered",
      "failed",
      "retrying",
      "unknown",
      "skipped",
      "suppressed",
      "coalesced",
    ],
  }).notNull(),
  result: text("result"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const workflowRuntimeControls = table("workflow_runtime_controls", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id").notNull(),
  domain: text("domain").notNull(),
  scope: text("scope", { enum: ["global", "resource"] }).notNull(),
  scopeId: text("scope_id").notNull(),
  evaluatorPaused: integer("evaluator_paused", { mode: "boolean" }).notNull(),
  effectsPaused: integer("effects_paused", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const notificationDeliveryAttempts = table(
  "notification_delivery_attempts",
  {
    id: text("id").primaryKey(),
    effectId: text("effect_id").notNull(),
    notificationId: text("notification_id"),
    channel: text("channel").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status", {
      enum: ["delivered", "failed", "retrying", "unknown", "skipped"],
    }).notNull(),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
);

export const workflowSchema = {
  workflowSequenceCounters,
  workflowVirtualProviderState,
  workflowEvents,
  workflowSubscriptions,
  workflowSubscriptionVersions,
  workflowExecutions,
  workflowScheduledWork,
  workflowEffects,
  workflowRuntimeControls,
  notificationDeliveryAttempts,
};
