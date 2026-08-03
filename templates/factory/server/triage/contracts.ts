import { z } from "zod";

export const triageSourceSchema = z.enum(["slack", "github"]);
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
]);
export type TriageItemStatus = z.infer<typeof triageItemStatusSchema>;

export const triageRiskSchema = z.enum([
  "unknown",
  "low",
  "medium",
  "high",
  "critical",
]);
export type TriageRisk = z.infer<typeof triageRiskSchema>;

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
]);
export type TriageDecisionOutcome = z.infer<typeof triageDecisionOutcomeSchema>;

export const triageRuleModeSchema = z.enum(["disabled", "shadow"]);
export type TriageRuleMode = z.infer<typeof triageRuleModeSchema>;

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
]);
export type TriageGuardCode = z.infer<typeof triageGuardCodeSchema>;

export const hardNeverAutomateGuardCodes: TriageGuardCode[] = [
  "auth",
  "session",
  "identity",
  "credentials",
  "vault",
  "migration",
  "payments",
  "security",
  "publishable_package",
];

export const triagePolicyGuardsSchema = z.object({
  allowRepositories: z.array(z.string().min(1)).default([]),
  denyPathPrefixes: z.array(z.string().min(1)).default([]),
  maxChangedFiles: z.number().int().positive().nullable().default(30),
  maxDiffLines: z.number().int().positive().nullable().default(1500),
  neverAutomate: z
    .array(triageGuardCodeSchema)
    .default(hardNeverAutomateGuardCodes),
});

export interface GuardResult {
  code: TriageGuardCode;
  passed: boolean;
  reason: string;
}

export interface TriagePolicyGuards {
  allowRepositories: string[];
  denyPathPrefixes: string[];
  maxChangedFiles: number | null;
  maxDiffLines: number | null;
  neverAutomate: TriageGuardCode[];
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

export function normalizeTriagePolicyGuards(
  value: unknown,
): TriagePolicyGuards {
  const parsed = triagePolicyGuardsSchema.parse(value);
  return {
    ...parsed,
    neverAutomate: [
      ...new Set([...hardNeverAutomateGuardCodes, ...parsed.neverAutomate]),
    ],
  };
}

export function defaultTriagePolicyGuards(): TriagePolicyGuards {
  return normalizeTriagePolicyGuards({
    allowRepositories: [],
    denyPathPrefixes: [
      ".env",
      "auth",
      "credentials",
      "migrations",
      "payments",
      "security",
      "packages/",
    ],
    maxChangedFiles: 30,
    maxDiffLines: 1500,
  });
}
