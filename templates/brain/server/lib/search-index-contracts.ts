export const BRAIN_SEARCH_INDEX_VERSION = "1";
export const BRAIN_SENSITIVITY_POLICY_VERSION = "1";

export type BrainSensitivityCategory =
  | "performance"
  | "discipline"
  | "termination"
  | "layoff-reorg"
  | "compensation"
  | "recruiting"
  | "health-accommodation"
  | "investigation"
  | "privileged-legal"
  | "secret-credential"
  | "personal";

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
  classifier: "deterministic" | "approved-model";
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
