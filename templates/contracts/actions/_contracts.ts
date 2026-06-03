import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
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
  type ContractBundle,
  type ContractEvent,
  type ContractItem,
  type ContractSummary,
  type Evidence,
  type Feedback,
  type Verification,
} from "../shared/types.js";

export const contractStatusSchema = z.enum(CONTRACT_STATUSES);
export const contractSourceSchema = z.enum(CONTRACT_SOURCES);
export const contractItemTypeSchema = z.enum(CONTRACT_ITEM_TYPES);
export const riskLevelSchema = z.enum(RISK_LEVELS);
export const reviewStateSchema = z.enum(REVIEW_STATES);
export const actedOnSchema = z.enum(ACTED_ON_STATES);
export const createdBySchema = z.enum(CREATED_BY_VALUES);
export const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export const evidenceSourceSchema = z.enum(EVIDENCE_SOURCES);
export const trustLevelSchema = z.enum(TRUST_LEVELS);
export const redactionStatusSchema = z.enum(REDACTION_STATUSES);
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const verifiedBySchema = z.enum(VERIFIED_BY_VALUES);
export const feedbackKindSchema = z.enum(FEEDBACK_KINDS);

export const itemInputSchema = z.object({
  id: z.string().optional(),
  type: contractItemTypeSchema,
  title: z.string().min(1),
  body: z.string().optional().default(""),
  status: z.string().optional().default("open"),
  risk: riskLevelSchema.optional().default("medium"),
  reviewState: reviewStateSchema.optional().default("unreviewed"),
  actedOn: actedOnSchema.optional().default("unknown"),
  impactSummary: z.string().optional(),
  affectedFiles: z.array(z.string()).optional().default([]),
  sourceRefs: z.array(z.string()).optional().default([]),
  linkedItemIds: z.array(z.string()).optional().default([]),
  createdBy: createdBySchema.optional().default("agent"),
});

export const feedbackInputSchema = z.object({
  id: z.string().optional(),
  targetItemId: z.string().optional(),
  kind: feedbackKindSchema,
  message: z.string().min(1),
  structuredPatch: z.record(z.string(), z.any()).optional(),
});

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function contractPath(id: string): string {
  return planPath(id);
}

export function planPath(id: string): string {
  return `/plans/${encodeURIComponent(id)}`;
}

export function contractDeepLink(id: string): string {
  return planDeepLink(id);
}

export function planDeepLink(id: string): string {
  return buildDeepLink({
    app: "contracts",
    view: "plan",
    to: planPath(id),
    params: { contractId: id },
  });
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function toItem(
  row: typeof schema.contractItems.$inferSelect,
): ContractItem {
  return {
    id: row.id,
    contractId: row.contractId,
    type: row.type,
    title: row.title,
    body: row.body,
    status: row.status,
    risk: row.risk,
    reviewState: row.reviewState,
    actedOn: row.actedOn,
    impactSummary: row.impactSummary,
    affectedFiles: parseJsonArray(row.affectedFiles),
    sourceRefs: parseJsonArray(row.sourceRefs),
    linkedItemIds: parseJsonArray(row.linkedItemIds),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toEvidence(
  row: typeof schema.contractEvidence.$inferSelect,
): Evidence {
  return {
    id: row.id,
    contractId: row.contractId,
    linkedItemIds: parseJsonArray(row.linkedItemIds),
    type: row.type,
    source: row.source,
    trustLevel: row.trustLevel,
    summary: row.summary,
    content: row.content,
    rawOutputPath: row.rawOutputPath,
    cwd: row.cwd,
    command: row.command,
    exitCode: row.exitCode,
    timestamp: row.timestamp,
    redactionStatus: row.redactionStatus,
    attachedBy: row.attachedBy,
    createdAt: row.createdAt,
  };
}

export function toVerification(
  row: typeof schema.contractVerifications.$inferSelect,
): Verification {
  return {
    id: row.id,
    contractId: row.contractId,
    criterionItemId: row.criterionItemId,
    evidenceIds: parseJsonArray(row.evidenceIds),
    status: row.status,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export function toFeedback(
  row: typeof schema.contractFeedback.$inferSelect,
): Feedback {
  return {
    id: row.id,
    contractId: row.contractId,
    targetItemId: row.targetItemId,
    kind: row.kind,
    message: row.message,
    structuredPatch: parseJsonRecord(row.structuredPatch),
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

export function toEvent(
  row: typeof schema.contractEvents.$inferSelect,
): ContractEvent {
  return {
    id: row.id,
    contractId: row.contractId,
    type: row.type,
    message: row.message,
    payload: parseJsonRecord(row.payload),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function writeEvent(input: {
  contractId: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
  createdBy?: string;
}) {
  await getDb()
    .insert(schema.contractEvents)
    .values({
      id: newId("evt"),
      contractId: input.contractId,
      type: input.type,
      message: input.message,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      createdBy: input.createdBy ?? "agent",
      createdAt: nowIso(),
    });
}

export async function assertContractEditor(contractId: string) {
  return assertAccess("contract", contractId, "editor");
}

export async function loadContractBundle(
  contractId: string,
): Promise<ContractBundle> {
  const access = await resolveAccess("contract", contractId);
  if (!access) throw new Error(`Visual plan ${contractId} not found`);
  const contract = access.resource as typeof schema.contracts.$inferSelect;
  const db = getDb();
  const [itemRows, evidenceRows, verificationRows, feedbackRows, eventRows] =
    await Promise.all([
      db
        .select()
        .from(schema.contractItems)
        .where(eq(schema.contractItems.contractId, contractId)),
      db
        .select()
        .from(schema.contractEvidence)
        .where(eq(schema.contractEvidence.contractId, contractId)),
      db
        .select()
        .from(schema.contractVerifications)
        .where(eq(schema.contractVerifications.contractId, contractId)),
      db
        .select()
        .from(schema.contractFeedback)
        .where(eq(schema.contractFeedback.contractId, contractId)),
      db
        .select()
        .from(schema.contractEvents)
        .where(eq(schema.contractEvents.contractId, contractId)),
    ]);

  const items = itemRows.map(toItem);
  const evidence = evidenceRows.map(toEvidence);
  const verifications = verificationRows.map(toVerification);
  const feedback = feedbackRows.map(toFeedback);
  const events = eventRows.map(toEvent);
  const summary = summarizeContract(items, evidence, verifications);
  return {
    contract: {
      id: contract.id,
      title: contract.title,
      goal: contract.goal,
      status: contract.status,
      source: contract.source,
      repoPath: contract.repoPath,
      currentPhase: contract.currentPhase,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      approvedAt: contract.approvedAt,
    },
    items,
    evidence,
    verifications,
    feedback,
    events,
    reviewQueue: buildReviewQueue(items, evidence, verifications),
    summary,
  };
}

export function buildReviewQueue(
  items: ContractItem[],
  _evidence: Evidence[],
  verifications: Verification[],
): ContractItem[] {
  const satisfiedCriteria = new Set(
    verifications
      .filter((v) => v.status === "verified" || v.status === "waived")
      .map((v) => v.criterionItemId),
  );
  return items
    .filter((item) => {
      if (item.type === "acceptance_criterion") {
        return !satisfiedCriteria.has(item.id);
      }
      if (
        item.reviewState === "unreviewed" ||
        item.reviewState === "needs_evidence"
      ) {
        return true;
      }
      if (item.type === "deviation" || item.type === "amendment") {
        return item.reviewState !== "accepted" && item.reviewState !== "waived";
      }
      return false;
    })
    .sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return riskOrder[a.risk] - riskOrder[b.risk];
    });
}

export function summarizeContract(
  items: ContractItem[],
  evidence: Evidence[],
  verifications: Verification[],
) {
  const itemCounts: Record<string, number> = {};
  for (const item of items) {
    itemCounts[item.type] = (itemCounts[item.type] ?? 0) + 1;
  }
  const reviewCount = buildReviewQueue(items, evidence, verifications).length;
  const criterionIds = items
    .filter((item) => item.type === "acceptance_criterion")
    .map((item) => item.id);
  const satisfied = new Set(
    verifications
      .filter((v) => v.status === "verified" || v.status === "waived")
      .map((v) => v.criterionItemId),
  );
  const verified = new Set(
    verifications
      .filter((v) => v.status === "verified")
      .map((v) => v.criterionItemId),
  );
  return {
    itemCounts,
    reviewCount,
    missingEvidenceCount: criterionIds.filter((id) => !satisfied.has(id))
      .length,
    verifiedCount: verified.size,
  };
}

export async function summarizeContracts(
  contracts: Array<typeof schema.contracts.$inferSelect>,
): Promise<ContractSummary[]> {
  if (contracts.length === 0) return [];
  const ids = contracts.map((contract) => contract.id);
  const db = getDb();
  const [itemRows, evidenceRows, verificationRows] = await Promise.all([
    db
      .select()
      .from(schema.contractItems)
      .where(inArray(schema.contractItems.contractId, ids)),
    db
      .select()
      .from(schema.contractEvidence)
      .where(inArray(schema.contractEvidence.contractId, ids)),
    db
      .select()
      .from(schema.contractVerifications)
      .where(inArray(schema.contractVerifications.contractId, ids)),
  ]);
  return contracts.map((contract) => {
    const items = itemRows
      .filter((item) => item.contractId === contract.id)
      .map(toItem);
    const evidence = evidenceRows
      .filter((item) => item.contractId === contract.id)
      .map(toEvidence);
    const verifications = verificationRows
      .filter((item) => item.contractId === contract.id)
      .map(toVerification);
    const summary = summarizeContract(items, evidence, verifications);
    return {
      id: contract.id,
      title: contract.title,
      goal: contract.goal,
      status: contract.status,
      source: contract.source,
      repoPath: contract.repoPath,
      currentPhase: contract.currentPhase,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      approvedAt: contract.approvedAt,
      ...summary,
    };
  });
}

export function redactEvidenceText(input: string | undefined | null): {
  text: string | null;
  redacted: boolean;
} {
  if (!input) return { text: input ?? null, redacted: false };
  let redacted = false;
  let text = input.replace(
    /([A-Za-z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Za-z_]*=)[^\s]+/gi,
    (_match, prefix: string) => {
      redacted = true;
      return `${prefix}[REDACTED]`;
    },
  );
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, (_match, prefix) => {
    redacted = true;
    return `${prefix}[REDACTED]`;
  });
  text = text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, () => {
    redacted = true;
    return "[REDACTED]";
  });
  return { text, redacted };
}
