import { z } from "zod";

export const BRAIN_SEARCH_INDEX_VERSION = "1";

const zoomPassageQuarantineSchema = z
  .object({
    version: z.literal(1),
    totalPassages: z.number().int().positive().max(48),
    withheldPassages: z.number().int().positive(),
  })
  .refine((receipt) => receipt.withheldPassages <= receipt.totalPassages);

export function readZoomPassageQuarantine(metadata: Record<string, unknown>) {
  if (metadata.zoomPassageQuarantine === undefined) return undefined;
  const receipt = zoomPassageQuarantineSchema.safeParse(
    metadata.zoomPassageQuarantine,
  );
  return receipt.success
    ? receipt.data
    : { version: 1 as const, totalPassages: null, withheldPassages: null };
}

export function withheldZoomPassageCount(
  metadata: Record<string, unknown>,
): number | null {
  const receipt = readZoomPassageQuarantine(metadata);
  return receipt === undefined ? 0 : receipt.withheldPassages;
}

export const BRAIN_SENSITIVITY_POLICY_VERSION = "2";

export const BRAIN_SENSITIVITY_CATEGORIES = [
  "performance",
  "discipline",
  "termination",
  "layoff-reorg",
  "compensation",
  "recruiting",
  "health-accommodation",
  "investigation",
  "privileged-legal",
  "secret-credential",
  "personal",
] as const;

export type BrainSensitivityCategory =
  (typeof BRAIN_SENSITIVITY_CATEGORIES)[number];

export const BRAIN_WORKSPACE_RULE_SCORE_KEY = "workspace-rule";

export type BrainSensitivityScoreKey =
  | BrainSensitivityCategory
  | typeof BRAIN_WORKSPACE_RULE_SCORE_KEY;

export type BrainSensitivityDisposition =
  | "allowed"
  | "suppressed"
  | "quarantined";

export interface BrainSafeSegment {
  id: string;
  authorKey?: string;
  capturedAt: string;
  sourceUrl?: string;
  text: string;
  reactionCount: number;
}

export interface BrainSensitivityDecision {
  disposition: BrainSensitivityDisposition;
  categories: BrainSensitivityCategory[];
  confidenceBand: "deterministic" | "high" | "medium" | "uncertain";
  policyVersion: string;
  safeSegments: BrainSafeSegment[];
  safeContent: string;
  classifier: "deterministic" | "approved-model" | "jev";
  categoryScores?: Partial<Record<BrainSensitivityScoreKey, number>>;
}

export interface BrainAudienceAssignment {
  audienceId: string;
  aclHash: string;
  kind: "org" | "slack-private-channel" | "meeting" | "restricted";
}

export interface BrainSearchStalenessKey {
  contentHash: string;
  indexVersion: string;
  sensitivityPolicyVersion: string;
  aclHash: string;
}

export type BrainIngestOperation =
  | "distill"
  | "sync"
  | "search-index"
  | "search-unindex"
  | "slack-thread-refresh";

export interface BrainCaptureInvalidation {
  captureId: string;
  sourceId: string;
  reason:
    | "content-changed"
    | "sensitivity-changed"
    | "access-changed"
    | "source-deleted"
    | "upstream-deleted";
  previous?: Partial<BrainSearchStalenessKey>;
  next?: Partial<BrainSearchStalenessKey>;
}
