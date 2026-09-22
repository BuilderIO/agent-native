export const BRAIN_SEARCH_INDEX_VERSION = "1";
// Stamped on every new decision and on the quarantine event's conflict key, so
// a bump keeps v2 verdicts from colliding with v1 ones. It does NOT retroactively
// re-screen: `indexSnapshotMatches` compares a capture against its own artifact,
// not against this constant, so captures decided under an older policy stay
// indexed until they are re-screened. Run the `resanitize-captures` action to
// migrate an existing corpus; that is deliberate, because re-deciding and
// re-embedding every capture on deploy is a bulk cost, not a startup task.
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

/**
 * Reserved score key for a workspace's own `sensitivityCustomInstructions`.
 * Workspace rules may only tighten, so a hit quarantines without claiming one
 * of the eleven policy categories.
 */
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
  /** Per-category probabilities, when the classifier reports calibrated scores. */
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
