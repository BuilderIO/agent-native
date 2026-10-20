import { z } from "zod";

/**
 * A provider id. The Slack, GitHub, and Sentry pollers write `slack`, `github`,
 * `github_issue`, and `sentry`; so does any other provider a workflow brings
 * items in from, such as `hubspot` or `pylon`.
 */
export const triageSourceSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_-]*$/, 'use a provider id such as "hubspot"');
export type TriageSource = z.infer<typeof triageSourceSchema>;

export const triageItemStatusSchema = z.enum([
  "received",
  "context_fetching",
  "evidence_ready",
  "classified",
  "shadow_decided",
  "needs_manual",
  "failed",
  "reconciliation_required",
  "automation_started",
  "pr_observed",
  "auto_approved",
  "merged",
  "resolved",
  "dismissed",
]);
export type TriageItemStatus = z.infer<typeof triageItemStatusSchema>;

export const triageRiskSchema = z.enum([
  "unknown",
  "negligible",
  "low",
  "medium",
  "high",
  "critical",
]);
export type TriageRisk = z.infer<typeof triageRiskSchema>;

export const triageConfidenceSchema = z.enum([
  "unknown",
  "low",
  "medium",
  "high",
]);
export type TriageConfidence = z.infer<typeof triageConfidenceSchema>;

export const triageCoverageSchema = z.enum([
  "complete",
  "partial",
  "unknown",
  "unavailable",
]);
export type TriageCoverage = z.infer<typeof triageCoverageSchema>;

export const triageDecisionOutcomeSchema = z.enum([
  "observe",
  "needs_manual",
  "propose_fix",
  "propose_review",
  "auto_approval_claimed",
  "auto_approve",
  "auto_merge",
]);
export type TriageDecisionOutcome = z.infer<typeof triageDecisionOutcomeSchema>;

export const executorStateSchema = z.enum([
  "submitted",
  "acknowledged",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "reconciliation_required",
]);
export type ExecutorState = z.infer<typeof executorStateSchema>;

export const triageGuardCodeSchema = z.enum([
  "auth",
  "session",
  "identity",
  "credentials",
  "vault",
  "migration",
  "payments",
  "security",
  "publishable_package",
  "path_denied",
  "diff_too_large",
  "unknown_change",
  "owner_owned",
  "risk_gate",
  "confidence_gate",
]);
export type TriageGuardCode = z.infer<typeof triageGuardCodeSchema>;

export interface GuardResult {
  code: TriageGuardCode;
  passed: boolean;
  reason: string;
}

export interface IngestionEnvelope {
  source: TriageSource;
  externalId: string;
  receivedAt: string;
  sourceUrl?: string;
  title: string;
  summary?: string;
  channelId?: string;
  threadTs?: string;
  repository?: string;
  pullRequestNumber?: number;
  headSha?: string;
  coverage: TriageCoverage;
  metadata?: Record<string, string | number | boolean | string[] | null>;
}

export interface ExecutorTaskContract {
  id: string;
  triageItemId: string;
  dedupeKey: string;
  state: ExecutorState;
  provider: "builder-http" | "harness" | "a2a" | "bot-tag";
  providerTaskId?: string;
  terminalReason?: string;
  observedAt: string;
}
