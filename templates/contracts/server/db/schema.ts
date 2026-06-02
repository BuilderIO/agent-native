import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import {
  ACTED_ON_STATES,
  CONTRACT_ITEM_TYPES,
  CONTRACT_SOURCES,
  CONTRACT_STATUSES,
  CREATED_BY_VALUES,
  EVIDENCE_SOURCES,
  EVIDENCE_TYPES,
  FEEDBACK_KINDS,
  REDACTION_STATUSES,
  REVIEW_STATES,
  RISK_LEVELS,
  TRUST_LEVELS,
  VERIFICATION_STATUSES,
  VERIFIED_BY_VALUES,
} from "../../shared/types.js";

export const contracts = table("contracts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  status: text("status", { enum: CONTRACT_STATUSES })
    .notNull()
    .default("draft"),
  source: text("source", { enum: CONTRACT_SOURCES })
    .notNull()
    .default("manual"),
  repoPath: text("repo_path"),
  currentPhase: text("current_phase"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  approvedAt: text("approved_at"),
  ...ownableColumns(),
});

export const contractItems = table("contract_items", {
  id: text("id").primaryKey(),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  type: text("type", { enum: CONTRACT_ITEM_TYPES }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("open"),
  risk: text("risk", { enum: RISK_LEVELS }).notNull().default("medium"),
  reviewState: text("review_state", { enum: REVIEW_STATES })
    .notNull()
    .default("unreviewed"),
  actedOn: text("acted_on", { enum: ACTED_ON_STATES })
    .notNull()
    .default("unknown"),
  impactSummary: text("impact_summary"),
  affectedFiles: text("affected_files").notNull().default("[]"),
  sourceRefs: text("source_refs").notNull().default("[]"),
  linkedItemIds: text("linked_item_ids").notNull().default("[]"),
  createdBy: text("created_by", { enum: CREATED_BY_VALUES })
    .notNull()
    .default("agent"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const contractEvidence = table("contract_evidence", {
  id: text("id").primaryKey(),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  linkedItemIds: text("linked_item_ids").notNull().default("[]"),
  type: text("type", { enum: EVIDENCE_TYPES }).notNull(),
  source: text("source", { enum: EVIDENCE_SOURCES })
    .notNull()
    .default("agent_attestation"),
  trustLevel: text("trust_level", { enum: TRUST_LEVELS })
    .notNull()
    .default("low"),
  summary: text("summary").notNull(),
  content: text("content"),
  rawOutputPath: text("raw_output_path"),
  cwd: text("cwd"),
  command: text("command"),
  exitCode: integer("exit_code"),
  timestamp: text("timestamp").notNull(),
  redactionStatus: text("redaction_status", { enum: REDACTION_STATUSES })
    .notNull()
    .default("not_needed"),
  attachedBy: text("attached_by").notNull().default("agent"),
  createdAt: text("created_at").notNull(),
});

export const contractVerifications = table("contract_verifications", {
  id: text("id").primaryKey(),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  criterionItemId: text("criterion_item_id")
    .notNull()
    .references(() => contractItems.id),
  evidenceIds: text("evidence_ids").notNull().default("[]"),
  status: text("status", { enum: VERIFICATION_STATUSES })
    .notNull()
    .default("missing"),
  verifiedBy: text("verified_by", { enum: VERIFIED_BY_VALUES }),
  verifiedAt: text("verified_at"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});

export const contractFeedback = table("contract_feedback", {
  id: text("id").primaryKey(),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  targetItemId: text("target_item_id").references(() => contractItems.id),
  kind: text("kind", { enum: FEEDBACK_KINDS }).notNull(),
  message: text("message").notNull(),
  structuredPatch: text("structured_patch"),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
});

export const contractEvents = table("contract_events", {
  id: text("id").primaryKey(),
  contractId: text("contract_id")
    .notNull()
    .references(() => contracts.id),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: text("payload"),
  createdBy: text("created_by").notNull().default("agent"),
  createdAt: text("created_at").notNull(),
});

export const contractShares = createSharesTable("contract_shares");
