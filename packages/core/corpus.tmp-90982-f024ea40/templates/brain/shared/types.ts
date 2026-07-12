export type BrainSourceProvider =
  | "manual"
  | "generic"
  | "clips"
  | "slack"
  | "granola"
  | "github";
export type BrainSourceStatus = "active" | "paused" | "archived" | "error";
export type BrainCaptureKind =
  | "transcript"
  | "note"
  | "message"
  | "document"
  | "generic";
export type BrainCaptureStatus =
  | "queued"
  | "distilling"
  | "distilled"
  | "ignored";
export type BrainKnowledgeStatus =
  | "draft"
  | "published"
  | "redacted"
  | "archived";
export type BrainKnowledgeKind =
  | "decision"
  | "rationale"
  | "how-it-works"
  | "fact"
  | "open-question"
  | "process"
  | "risk"
  | "policy";
export type BrainPublishTier = "private" | "team" | "company";
export type BrainProposalStatus = "pending" | "approved" | "rejected";
export type BrainProposalAction = "create" | "update" | "archive";

export interface BrainEvidenceInput {
  captureId: string;
  quote: string;
  note?: string;
  sourceUrl?: string;
  /** @deprecated use sourceUrl */
  url?: string;
  timestampMs?: number;
}

export interface BrainEvidence extends BrainEvidenceInput {
  sourceId: string;
  captureTitle: string;
}

export interface BrainSettings {
  companyName?: string;
  assistantName?: string;
  assistantTone?: "direct" | "friendly" | "formal" | "technical";
  sourcePolicy?: "strict" | "balanced" | "exploratory";
  requireApprovalForCompanyKnowledge: boolean;
  autoRedactEmails: boolean;
  defaultPublishTier: BrainPublishTier;
  distillationInstructions: string;
  captureSanitizationEnabled?: boolean;
  captureSanitizationModel?: string;
  captureSanitizationInstructions?: string;
  connectorPollMinutes: number;
  requireCitations?: boolean;
  autoArchiveResolved?: boolean;
  notifyOnSourceErrors?: boolean;
}

export const DEFAULT_BRAIN_SETTINGS: BrainSettings = {
  companyName: "",
  assistantName: "Brain",
  assistantTone: "direct",
  sourcePolicy: "balanced",
  requireApprovalForCompanyKnowledge: true,
  autoRedactEmails: true,
  defaultPublishTier: "company",
  distillationInstructions:
    "Distill durable, reusable institutional knowledge. Preserve short direct quotes as evidence.",
  captureSanitizationEnabled: true,
  captureSanitizationModel: "",
  captureSanitizationInstructions:
    "Keep durable company-relevant information and remove personal, recruiting, hiring, candidate-evaluation, sensitive, or casual content before storage.",
  connectorPollMinutes: 60,
  requireCitations: true,
  autoArchiveResolved: true,
  notifyOnSourceErrors: true,
};
