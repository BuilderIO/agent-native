export type BrainSourceProvider =
  | "manual"
  | "generic"
  | "clips"
  | "slack"
  | "granola"
  | "github"
  | "zoom"
  | "google_calendar"
  | "gmail"
  | "google_drive";
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
  note?: string | undefined;
  sourceUrl?: string | undefined;
  /** @deprecated use sourceUrl */
  url?: string | undefined;
  timestampMs?: number | undefined;
}

export interface BrainEvidence extends BrainEvidenceInput {
  sourceId: string;
  captureTitle: string;
  capturedAt?: string | undefined;
  capturedAtSource?: "manual-markdown" | undefined;
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
  privacyClassifier?: "jev" | "model" | "deterministic";
  privacyClassifierModel?: string;
  privacyClassifierEngine?: string;
  sensitivityCustomInstructions?: string;
  publicChannelExclusionPatterns?: string[];
  quarantineRetentionHours?: number;
  connectorPollMinutes: number;
  requireCitations?: boolean;
  autoArchiveResolved?: boolean;
  notifyOnSourceErrors?: boolean;
}

export const COMPANY_CONTEXT_INTAKE_KEY = "companyContextIntake";
export const COMPANY_CONTEXT_SOURCE_ID_PREFIX = "company-context-";

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
  privacyClassifier: "jev",
  privacyClassifierModel: "",
  privacyClassifierEngine: "",
  sensitivityCustomInstructions: "",
  publicChannelExclusionPatterns: [],
  quarantineRetentionHours: 72,
  connectorPollMinutes: 60,
  requireCitations: true,
  autoArchiveResolved: true,
  notifyOnSourceErrors: true,
};
