import type { DbExec } from "../db/client.js";

export const WORKFLOW_SUBSCRIPTION_KINDS = [
  "deterministic",
  "agentic",
] as const;
export type WorkflowSubscriptionKind =
  (typeof WORKFLOW_SUBSCRIPTION_KINDS)[number];

export const WORKFLOW_EXECUTION_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "retrying",
  "unknown",
  "acknowledged",
] as const;
export type WorkflowExecutionStatus =
  (typeof WORKFLOW_EXECUTION_STATUSES)[number];

export const WORKFLOW_DELIVERY_STATUSES = [
  "delivered",
  "failed",
  "retrying",
  "unknown",
  "skipped",
] as const;
export type WorkflowDeliveryStatus =
  (typeof WORKFLOW_DELIVERY_STATUSES)[number];

export const WORKFLOW_EFFECT_STATUSES = [
  ...WORKFLOW_DELIVERY_STATUSES,
  "suppressed",
  "coalesced",
] as const;
export type WorkflowEffectStatus = (typeof WORKFLOW_EFFECT_STATUSES)[number];

export const WORKFLOW_SCHEDULED_WORK_STATUSES = [
  "pending",
  "running",
  "completed",
  "cancelled",
  "failed",
  "dead_letter",
] as const;
export type WorkflowScheduledWorkStatus =
  (typeof WORKFLOW_SCHEDULED_WORK_STATUSES)[number];

export interface WorkflowEventInput {
  id?: string;
  /** Durable commit order. Domain transactions allocate this from core. */
  eventSequence?: number;
  topic: string;
  subjectType: string;
  subjectId: string;
  ownerEmail: string;
  orgId?: string | null;
  payload?: Record<string, unknown>;
  actorContext?: Record<string, unknown>;
  causalEventId?: string | null;
  occurredAt?: number;
  availableAt?: number;
}

export interface WorkflowEvent {
  id: string;
  eventSequence: number;
  topic: string;
  subjectType: string;
  subjectId: string;
  subjectKey: string;
  ownerEmail: string;
  orgId: string | null;
  payload: Record<string, unknown>;
  actorContext: Record<string, unknown>;
  causalEventId: string | null;
  occurredAt: number;
  availableAt: number;
  createdAt: number;
}

export interface WorkflowSubscriptionInput {
  id: string;
  kind: WorkflowSubscriptionKind;
  eventPattern: string;
  ownerEmail: string;
  orgId?: string | null;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export type WorkflowRuntimeControlScope = "global" | "resource";

export interface WorkflowRuntimeControlValue {
  evaluatorPaused: boolean;
  effectsPaused: boolean;
}

export interface WorkflowRuntimeControlTarget {
  ownerEmail: string;
  orgId?: string | null;
  domain: string;
  scope: WorkflowRuntimeControlScope;
  resourceId?: string | null;
}

export interface WorkflowRuntimeControlContext {
  ownerEmail: string;
  orgId?: string | null;
  domain: string;
  resourceId?: string | null;
}

export interface WorkflowRuntimeControls {
  global: WorkflowRuntimeControlValue;
  resource: WorkflowRuntimeControlValue;
  effective: WorkflowRuntimeControlValue;
}

export interface WorkflowSubscription extends WorkflowSubscriptionInput {
  version: number;
  orgId: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ClaimedWorkflowExecution {
  id: string;
  eventId: string;
  subscriptionId: string;
  subscriptionVersion: number;
  status: "running";
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: number;
  fenceVersion: number;
  event: WorkflowEvent;
  subscription: WorkflowSubscription;
}

export interface WorkflowStoreOptions {
  db?: DbExec;
  now?: number;
}

export interface WorkflowWake {
  topic: "workflow.event.available" | "workflow.scheduled-work.available";
  rowId: string;
}
