export const CONTRACT_STATUSES = [
  "draft",
  "review",
  "approved",
  "implementing",
  "verifying",
  "complete",
  "blocked",
] as const;

export const CONTRACT_SOURCES = [
  "claude-code",
  "codex",
  "cursor",
  "pi",
  "manual",
  "imported",
] as const;

export const CONTRACT_ITEM_TYPES = [
  "assumption",
  "decision",
  "constraint",
  "task",
  "acceptance_criterion",
  "risk",
  "deviation",
  "open_question",
  "amendment",
] as const;

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export const REVIEW_STATES = [
  "unreviewed",
  "accepted",
  "rejected",
  "corrected",
  "waived",
  "needs_evidence",
] as const;

export const ACTED_ON_STATES = ["false", "true", "unknown"] as const;

export const CREATED_BY_VALUES = [
  "agent",
  "human",
  "detector",
  "import",
] as const;

export const EVIDENCE_TYPES = [
  "command",
  "test",
  "ci_check",
  "screenshot",
  "log",
  "diff",
  "human_note",
  "artifact",
] as const;

export const EVIDENCE_SOURCES = [
  "tool_captured",
  "ci",
  "human",
  "agent_attestation",
] as const;

export const TRUST_LEVELS = [
  "high",
  "medium",
  "low",
  "human_confirmed",
] as const;

export const REDACTION_STATUSES = [
  "not_needed",
  "redacted",
  "needs_review",
] as const;

export const VERIFICATION_STATUSES = [
  "missing",
  "evidence_attached",
  "verified",
  "failed",
  "waived",
  "inconclusive",
] as const;

export const VERIFIED_BY_VALUES = [
  "deterministic_check",
  "ci",
  "human",
  "independent_verifier",
] as const;

export const FEEDBACK_KINDS = [
  "accept",
  "reject",
  "correct",
  "request_evidence",
  "ask_question",
  "approve_amendment",
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type ContractSource = (typeof CONTRACT_SOURCES)[number];
export type ContractItemType = (typeof CONTRACT_ITEM_TYPES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type ReviewState = (typeof REVIEW_STATES)[number];
export type ActedOnState = (typeof ACTED_ON_STATES)[number];
export type CreatedBy = (typeof CREATED_BY_VALUES)[number];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export type TrustLevel = (typeof TRUST_LEVELS)[number];
export type RedactionStatus = (typeof REDACTION_STATUSES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type VerifiedBy = (typeof VERIFIED_BY_VALUES)[number];
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface ContractSummary {
  id: string;
  title: string;
  goal: string;
  status: ContractStatus;
  source: ContractSource;
  repoPath?: string | null;
  currentPhase?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  itemCounts: Record<string, number>;
  reviewCount: number;
  missingEvidenceCount: number;
  verifiedCount: number;
}

export interface ContractItem {
  id: string;
  contractId: string;
  type: ContractItemType;
  title: string;
  body: string;
  status: string;
  risk: RiskLevel;
  reviewState: ReviewState;
  actedOn: ActedOnState;
  impactSummary?: string | null;
  affectedFiles: string[];
  sourceRefs: string[];
  linkedItemIds: string[];
  createdBy: CreatedBy;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  contractId: string;
  linkedItemIds: string[];
  type: EvidenceType;
  source: EvidenceSource;
  trustLevel: TrustLevel;
  summary: string;
  content?: string | null;
  rawOutputPath?: string | null;
  cwd?: string | null;
  command?: string | null;
  exitCode?: number | null;
  timestamp: string;
  redactionStatus: RedactionStatus;
  attachedBy: string;
  createdAt: string;
}

export interface Verification {
  id: string;
  contractId: string;
  criterionItemId: string;
  evidenceIds: string[];
  status: VerificationStatus;
  verifiedBy?: VerifiedBy | null;
  verifiedAt?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface Feedback {
  id: string;
  contractId: string;
  targetItemId?: string | null;
  kind: FeedbackKind;
  message: string;
  structuredPatch?: Record<string, unknown> | null;
  consumedAt?: string | null;
  createdAt: string;
}

export interface ContractEvent {
  id: string;
  contractId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown> | null;
  createdBy: string;
  createdAt: string;
}

export interface ContractBundle {
  contract: Omit<
    ContractSummary,
    "itemCounts" | "reviewCount" | "missingEvidenceCount" | "verifiedCount"
  >;
  items: ContractItem[];
  evidence: Evidence[];
  verifications: Verification[];
  feedback: Feedback[];
  events: ContractEvent[];
  reviewQueue: ContractItem[];
  summary: {
    itemCounts: Record<string, number>;
    reviewCount: number;
    missingEvidenceCount: number;
    verifiedCount: number;
  };
}
